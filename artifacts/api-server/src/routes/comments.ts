import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, lt, desc, and, sql } from "drizzle-orm";
import { db, videosTable, usersTable, commentsTable, notificationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { AddCommentBody } from "@workspace/api-zod";
import { broadcast } from "../lib/websocket";

const router: IRouter = Router();

// GET /videos/:id/comments — list comments paginated (newest first)
router.get("/videos/:id/comments", async (req, res): Promise<void> => {
  const videoId = Number(req.params.id);
  if (isNaN(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;

  const rows = await db
    .select({
      id: commentsTable.id,
      videoId: commentsTable.videoId,
      userId: commentsTable.userId,
      text: commentsTable.text,
      createdAt: commentsTable.createdAt,
      authorId: usersTable.id,
      authorUsername: usersTable.username,
      authorDisplayName: usersTable.displayName,
      authorAvatarUrl: usersTable.avatarUrl,
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(commentsTable.userId, usersTable.id))
    .where(
      cursor
        ? and(eq(commentsTable.videoId, videoId), lt(commentsTable.id, cursor))
        : eq(commentsTable.videoId, videoId),
    )
    .orderBy(desc(commentsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  const comments = page.map((r) => ({
    id: r.id,
    videoId: r.videoId,
    userId: r.userId,
    text: r.text,
    createdAt: r.createdAt,
    author: {
      id: r.authorId,
      username: r.authorUsername,
      displayName: r.authorDisplayName,
      avatarUrl: r.authorAvatarUrl,
    },
  }));

  res.json({ comments, nextCursor });
});

// POST /videos/:id/comments — add a comment (atomic via transaction)
router.post("/videos/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;
  const videoId = Number(req.params.id);

  if (isNaN(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const parsed = AddCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [viewer] = await db
    .select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));

  if (!viewer) {
    res.status(401).json({ error: "User not provisioned" });
    return;
  }

  const [video] = await db
    .select({ id: videosTable.id, userId: videosTable.userId, title: videosTable.title })
    .from(videosTable)
    .where(eq(videosTable.id, videoId));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // Transaction: insert comment + increment count atomically
  const comment = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(commentsTable)
      .values({ videoId, userId: viewer.id, text: parsed.data.text })
      .returning();
    await tx
      .update(videosTable)
      .set({ commentsCount: sql`${videosTable.commentsCount} + 1` })
      .where(eq(videosTable.id, videoId));
    return c;
  });

  // Notify video owner — fire-and-forget outside transaction
  if (video.userId !== viewer.id) {
    db.insert(notificationsTable).values({
      userId: video.userId,
      actorId: viewer.id,
      type: "comment",
      videoId,
      commentId: comment.id,
    }).catch(() => {});

    broadcast(video.userId, {
      type: "notification:new",
      payload: {
        type: "comment",
        actor: { id: viewer.id, username: viewer.username, displayName: viewer.displayName, avatarUrl: viewer.avatarUrl },
        videoId,
        videoTitle: video.title,
      },
    });
  }

  res.status(201).json({
    ...comment,
    author: {
      id: viewer.id,
      username: viewer.username,
      displayName: viewer.displayName,
      avatarUrl: viewer.avatarUrl,
    },
  });
});

// DELETE /videos/:id/comments/:commentId — delete own comment (atomic via transaction)
router.delete("/videos/:id/comments/:commentId", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;
  const videoId = Number(req.params.id);
  const commentId = Number(req.params.commentId);

  if (isNaN(videoId) || isNaN(commentId)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [viewer] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));

  if (!viewer) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  // Verify comment exists, belongs to this video, and is owned by viewer
  const [comment] = await db
    .select({ userId: commentsTable.userId, videoId: commentsTable.videoId })
    .from(commentsTable)
    .where(and(eq(commentsTable.id, commentId), eq(commentsTable.videoId, videoId)));

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  if (comment.userId !== viewer.id) {
    res.status(403).json({ error: "Not your comment" });
    return;
  }

  // Transaction: delete comment + decrement count atomically
  await db.transaction(async (tx) => {
    await tx.delete(commentsTable).where(eq(commentsTable.id, commentId));
    await tx
      .update(videosTable)
      .set({ commentsCount: sql`GREATEST(${videosTable.commentsCount} - 1, 0)` })
      .where(eq(videosTable.id, videoId));
  });

  res.status(204).end();
});

export default router;
