import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, sql } from "drizzle-orm";
import { db, usersTable, followsTable, notificationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// POST /users/:username/follow — toggle follow (atomic via transaction)
router.post("/users/:username/follow", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;
  // Normalise Express param (typed as string | string[] in some TS configs)
  const username = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;

  if (!username) {
    res.status(400).json({ error: "Missing username" });
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

  const [target] = await db
    .select({ id: usersTable.id, followersCount: usersTable.followersCount })
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (target.id === viewer.id) {
    res.status(400).json({ error: "You cannot follow yourself" });
    return;
  }

  const [existing] = await db
    .select({ id: followsTable.id })
    .from(followsTable)
    .where(and(eq(followsTable.followerId, viewer.id), eq(followsTable.followingId, target.id)));

  if (existing) {
    // Unfollow — transaction
    const updated = await db.transaction(async (tx) => {
      await tx.delete(followsTable).where(eq(followsTable.id, existing.id));
      await tx
        .update(usersTable)
        .set({ followingCount: sql`GREATEST(${usersTable.followingCount} - 1, 0)` })
        .where(eq(usersTable.id, viewer.id));
      const [u] = await tx
        .update(usersTable)
        .set({ followersCount: sql`GREATEST(${usersTable.followersCount} - 1, 0)` })
        .where(eq(usersTable.id, target.id))
        .returning({ followersCount: usersTable.followersCount });
      return u;
    });

    res.json({ following: false, followersCount: updated?.followersCount ?? 0 });
  } else {
    // Follow — transaction
    const updated = await db.transaction(async (tx) => {
      await tx.insert(followsTable).values({ followerId: viewer.id, followingId: target.id }).onConflictDoNothing();
      await tx
        .update(usersTable)
        .set({ followingCount: sql`${usersTable.followingCount} + 1` })
        .where(eq(usersTable.id, viewer.id));
      const [u] = await tx
        .update(usersTable)
        .set({ followersCount: sql`${usersTable.followersCount} + 1` })
        .where(eq(usersTable.id, target.id))
        .returning({ followersCount: usersTable.followersCount });
      return u;
    });

    // Notify target — fire-and-forget outside transaction
    db.insert(notificationsTable).values({
      userId: target.id,
      actorId: viewer.id,
      type: "follow",
    }).catch(() => {});

    res.json({ following: true, followersCount: updated?.followersCount ?? 0 });
  }
});

export default router;
