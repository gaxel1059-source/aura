import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, lt, desc, sql, and, inArray } from "drizzle-orm";
import { db, videosTable, usersTable, likesTable, followsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { CreateVideoBody } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

// Helper: shape a flat row into the Video response object
function shapeVideo(r: {
  id: number;
  userId: number;
  title: string | null;
  description: string | null;
  videoPath: string;
  thumbnailPath: string | null;
  duration: number | null;
  status: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  createdAt: Date;
  authorId: number;
  authorUsername: string;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
}, likedVideoIds: Set<number>) {
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    description: r.description,
    videoPath: r.videoPath,
    thumbnailPath: r.thumbnailPath,
    duration: r.duration,
    status: r.status,
    viewsCount: r.viewsCount,
    likesCount: r.likesCount,
    commentsCount: r.commentsCount,
    isLiked: likedVideoIds.has(r.id),
    createdAt: r.createdAt,
    author: {
      id: r.authorId,
      username: r.authorUsername,
      displayName: r.authorDisplayName,
      avatarUrl: r.authorAvatarUrl,
    },
  };
}

// Helper: resolve viewer ID from Clerk auth
async function resolveViewerId(clerkId: string): Promise<number | null> {
  const [viewer] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  return viewer?.id ?? null;
}

// Helper: batch-fetch liked videoIds for a viewer
async function getLikedVideoIds(viewerId: number, videoIds: number[]): Promise<Set<number>> {
  if (videoIds.length === 0) return new Set();
  const likes = await db
    .select({ videoId: likesTable.videoId })
    .from(likesTable)
    .where(and(eq(likesTable.userId, viewerId), inArray(likesTable.videoId, videoIds)));
  return new Set(likes.map((l) => l.videoId));
}

const VIDEO_SELECT = {
  id: videosTable.id,
  userId: videosTable.userId,
  title: videosTable.title,
  description: videosTable.description,
  videoPath: videosTable.videoPath,
  thumbnailPath: videosTable.thumbnailPath,
  duration: videosTable.duration,
  status: videosTable.status,
  viewsCount: videosTable.viewsCount,
  likesCount: videosTable.likesCount,
  commentsCount: videosTable.commentsCount,
  createdAt: videosTable.createdAt,
  authorId: usersTable.id,
  authorUsername: usersTable.username,
  authorDisplayName: usersTable.displayName,
  authorAvatarUrl: usersTable.avatarUrl,
} as const;

// GET /videos — paginated feed (for_you or following)
router.get("/videos", async (req, res): Promise<void> => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 10;
  const rawCursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  const cursor = rawCursor !== undefined && Number.isFinite(rawCursor) ? rawCursor : undefined;
  const mode = typeof req.query.mode === "string" ? req.query.mode : "for_you";
  if (mode !== "for_you" && mode !== "following") {
    res.status(400).json({ error: "Invalid mode. Must be 'for_you' or 'following'." });
    return;
  }

  // Resolve viewer
  const auth = getAuth(req);
  let viewerId: number | null = null;
  if (auth?.userId) {
    viewerId = await resolveViewerId(auth.userId);
  }

  // "following" mode: only videos from followed users
  if (mode === "following") {
    if (!viewerId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const followed = await db
      .select({ userId: followsTable.followingId })
      .from(followsTable)
      .where(eq(followsTable.followerId, viewerId));

    const followedIds = followed.map((f) => f.userId);

    if (followedIds.length === 0) {
      res.json({ videos: [], nextCursor: null });
      return;
    }

    const rows = await db
      .select(VIDEO_SELECT)
      .from(videosTable)
      .innerJoin(usersTable, eq(videosTable.userId, usersTable.id))
      .where(and(
        inArray(videosTable.userId, followedIds),
        cursor ? lt(videosTable.id, cursor) : undefined,
      ))
      .orderBy(desc(videosTable.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const likedVideoIds = await getLikedVideoIds(viewerId, page.map((r) => r.id));
    res.json({ videos: page.map((r) => shapeVideo(r, likedVideoIds)), nextCursor });
    return;
  }

  // "for_you" mode: global feed
  const rows = await db
    .select(VIDEO_SELECT)
    .from(videosTable)
    .innerJoin(usersTable, eq(videosTable.userId, usersTable.id))
    .where(cursor ? lt(videosTable.id, cursor) : undefined)
    .orderBy(desc(videosTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  const likedVideoIds = viewerId
    ? await getLikedVideoIds(viewerId, page.map((r) => r.id))
    : new Set<number>();

  res.json({ videos: page.map((r) => shapeVideo(r, likedVideoIds)), nextCursor });
});

// POST /videos — create a video record after upload
router.post("/videos", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;

  const parsed = CreateVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const viewerId = await resolveViewerId(clerkId);
  if (!viewerId) {
    res.status(401).json({ error: "User not provisioned. Call /users/me/sync first." });
    return;
  }

  const { videoPath, thumbnailPath, title, description, duration } = parsed.data;

  const [video] = await db
    .insert(videosTable)
    .values({
      userId: viewerId,
      videoPath,
      thumbnailPath: thumbnailPath ?? null,
      title: title ?? null,
      description: description ?? null,
      duration: duration ?? null,
      status: "ready",
    })
    .returning();

  // Set public-read ACL so the storage proxy can serve this video to any authenticated user.
  // Only patch paths that look like server-issued upload paths (/objects/uploads/<uuid>).
  // Fire-and-forget — don't block the response; log failures for ops visibility.
  const UPLOAD_PATH_RE = /^\/objects\/uploads\/[0-9a-f-]{36}$/i;
  const policy = { owner: clerkId, visibility: "public" as const };
  const patchPaths = [videoPath, thumbnailPath].filter(
    (p): p is string => !!p && UPLOAD_PATH_RE.test(p),
  );
  for (const p of patchPaths) {
    objectStorage.trySetObjectEntityAclPolicy(p, policy).catch((err: unknown) => {
      req.log?.warn({ err, path: p }, "ACL patch failed for uploaded object");
    });
  }

  res.status(201).json({ ...video, isLiked: false });
});

// GET /videos/:id — get single video
router.get("/videos/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const [row] = await db
    .select(VIDEO_SELECT)
    .from(videosTable)
    .innerJoin(usersTable, eq(videosTable.userId, usersTable.id))
    .where(eq(videosTable.id, id));

  if (!row) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const auth = getAuth(req);
  const likedVideoIds = auth?.userId
    ? await resolveViewerId(auth.userId).then((vid) =>
        vid ? getLikedVideoIds(vid, [id]) : new Set<number>(),
      )
    : new Set<number>();

  res.json(shapeVideo(row, likedVideoIds));
});

// GET /videos/liked — videos liked by the authenticated user
router.get("/videos/liked", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewerId = await resolveViewerId(auth!.userId!);
  if (!viewerId) { res.status(404).json({ error: "User not found" }); return; }

  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 20;
  const rawCursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  const cursor = rawCursor !== undefined && Number.isFinite(rawCursor) ? rawCursor : undefined;

  const rows = await db
    .select({ likeId: likesTable.id, ...VIDEO_SELECT })
    .from(likesTable)
    .innerJoin(videosTable, eq(likesTable.videoId, videosTable.id))
    .innerJoin(usersTable, eq(videosTable.userId, usersTable.id))
    .where(and(eq(likesTable.userId, viewerId), cursor ? lt(likesTable.id, cursor) : undefined))
    .orderBy(desc(likesTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].likeId : null;
  const videoIds = page.map((r) => r.id);
  const likedVideoIds = videoIds.length > 0 ? await getLikedVideoIds(viewerId, videoIds) : new Set<number>();
  const videos = page.map(({ likeId: _l, ...r }) => shapeVideo(r, likedVideoIds));
  res.json({ videos, nextCursor });
});

// DELETE /videos/:id — delete own video
router.delete("/videos/:id", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;
  const id = Number(req.params.id);

  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const viewerId = await resolveViewerId(clerkId);
  if (!viewerId) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const [video] = await db
    .select({ userId: videosTable.userId })
    .from(videosTable)
    .where(eq(videosTable.id, id));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  if (video.userId !== viewerId) {
    res.status(403).json({ error: "Not your video" });
    return;
  }

  await db.delete(videosTable).where(eq(videosTable.id, id));
  res.status(204).end();
});

// POST /videos/:id/view — record a view
router.post("/videos/:id/view", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!isNaN(id)) {
    await db
      .update(videosTable)
      .set({ viewsCount: sql`${videosTable.viewsCount} + 1` })
      .where(eq(videosTable.id, id))
      .catch(() => {});
  }
  res.status(204).end();
});

export default router;
