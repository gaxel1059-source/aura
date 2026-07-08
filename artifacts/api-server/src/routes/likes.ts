import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, sql } from "drizzle-orm";
import { db, videosTable, usersTable, likesTable, notificationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// POST /videos/:id/like — toggle like (atomic via transaction)
router.post("/videos/:id/like", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;
  const videoId = Number(req.params.id);

  if (isNaN(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const [viewer] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));

  if (!viewer) {
    res.status(401).json({ error: "User not provisioned" });
    return;
  }

  const [video] = await db
    .select({ id: videosTable.id, userId: videosTable.userId, likesCount: videosTable.likesCount })
    .from(videosTable)
    .where(eq(videosTable.id, videoId));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const [existing] = await db
    .select({ id: likesTable.id })
    .from(likesTable)
    .where(and(eq(likesTable.userId, viewer.id), eq(likesTable.videoId, videoId)));

  if (existing) {
    // Unlike — transaction: delete like + decrement both counters atomically
    const updated = await db.transaction(async (tx) => {
      await tx.delete(likesTable).where(eq(likesTable.id, existing.id));
      const [v] = await tx
        .update(videosTable)
        .set({ likesCount: sql`GREATEST(${videosTable.likesCount} - 1, 0)` })
        .where(eq(videosTable.id, videoId))
        .returning({ likesCount: videosTable.likesCount });
      await tx
        .update(usersTable)
        .set({ likesCount: sql`GREATEST(${usersTable.likesCount} - 1, 0)` })
        .where(eq(usersTable.id, video.userId));
      return v;
    });

    res.json({ liked: false, likesCount: updated?.likesCount ?? 0 });
  } else {
    // Like — transaction: insert like + increment both counters atomically
    const updated = await db.transaction(async (tx) => {
      // INSERT OR IGNORE equivalent: if unique violation, return current state
      await tx.insert(likesTable).values({ userId: viewer.id, videoId }).onConflictDoNothing();
      const [v] = await tx
        .update(videosTable)
        .set({ likesCount: sql`${videosTable.likesCount} + 1` })
        .where(eq(videosTable.id, videoId))
        .returning({ likesCount: videosTable.likesCount });
      await tx
        .update(usersTable)
        .set({ likesCount: sql`${usersTable.likesCount} + 1` })
        .where(eq(usersTable.id, video.userId));
      return v;
    });

    // Notify video owner — fire-and-forget outside transaction
    if (video.userId !== viewer.id) {
      db.insert(notificationsTable).values({
        userId: video.userId,
        actorId: viewer.id,
        type: "like",
        videoId,
      }).catch(() => {});
    }

    res.json({ liked: true, likesCount: updated?.likesCount ?? 0 });
  }
});

export default router;
