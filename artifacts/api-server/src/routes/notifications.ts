import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, lt, desc, and, sql } from "drizzle-orm";
import { db, usersTable, notificationsTable, videosTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// GET /notifications/unread-count — must be before /notifications to avoid param clash
router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;

  const [viewer] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));

  if (!viewer) {
    res.json({ count: 0 });
    return;
  }

  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(notificationsTable)
    .where(and(
      eq(notificationsTable.userId, viewer.id),
      eq(notificationsTable.read, false),
    ));

  res.json({ count: result[0]?.count ?? 0 });
});

// POST /notifications/read-all — mark all read
router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;

  const [viewer] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));

  if (!viewer) {
    res.status(204).end();
    return;
  }

  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(and(
      eq(notificationsTable.userId, viewer.id),
      eq(notificationsTable.read, false),
    ));

  res.status(204).end();
});

// GET /notifications — paginated list
router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;

  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;

  const [viewer] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));

  if (!viewer) {
    res.json({ notifications: [], nextCursor: null });
    return;
  }

  // Alias tables for actor join
  const actorTable = usersTable;

  const rows = await db
    .select({
      id: notificationsTable.id,
      type: notificationsTable.type,
      read: notificationsTable.read,
      createdAt: notificationsTable.createdAt,
      videoId: notificationsTable.videoId,
      commentId: notificationsTable.commentId,
      actorId: actorTable.id,
      actorUsername: actorTable.username,
      actorDisplayName: actorTable.displayName,
      actorAvatarUrl: actorTable.avatarUrl,
    })
    .from(notificationsTable)
    .innerJoin(actorTable, eq(notificationsTable.actorId, actorTable.id))
    .where(
      cursor
        ? and(eq(notificationsTable.userId, viewer.id), lt(notificationsTable.id, cursor))
        : eq(notificationsTable.userId, viewer.id),
    )
    .orderBy(desc(notificationsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  // Optionally enrich with video title
  const videoIds = [...new Set(page.map(r => r.videoId).filter((id): id is number => id !== null))];
  const videoTitles = new Map<number, string | null>();
  if (videoIds.length > 0) {
    const videos = await db
      .select({ id: videosTable.id, title: videosTable.title })
      .from(videosTable)
      .where(sql`${videosTable.id} = ANY(${videoIds})`);
    for (const v of videos) videoTitles.set(v.id, v.title ?? null);
  }

  const notifications = page.map((r) => ({
    id: r.id,
    type: r.type,
    read: r.read,
    createdAt: r.createdAt,
    videoId: r.videoId ?? null,
    commentId: r.commentId ?? null,
    videoTitle: r.videoId ? (videoTitles.get(r.videoId) ?? null) : null,
    actor: {
      id: r.actorId,
      username: r.actorUsername,
      displayName: r.actorDisplayName,
      avatarUrl: r.actorAvatarUrl,
    },
  }));

  res.json({ notifications, nextCursor });
});

export default router;
