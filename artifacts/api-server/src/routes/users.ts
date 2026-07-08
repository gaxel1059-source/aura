import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc, lt, or, ilike, inArray } from "drizzle-orm";
import { db, usersTable, followsTable, videosTable, likesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { UpdateMeBody, GetUserByUsernameParams } from "@workspace/api-zod";

const router: IRouter = Router();

// ─── /users/me ────────────────────────────────────────────────────────────────

router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (!user) { res.status(404).json({ error: "User not found. Please sync first." }); return; }
  res.json(user);
});

router.post("/users/me/sync", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (existing) { res.json(existing); return; }
  const baseUsername = `user_${clerkId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12)}`;
  const username = `${baseUsername}_${Date.now().toString(36).slice(-4)}`;
  const [user] = await db.insert(usersTable).values({ clerkId, username, displayName: "New User", bio: null, avatarUrl: null }).returning();
  res.json(user);
});

router.put("/users/me", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const clerkId = auth!.userId!;
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { username, displayName, bio, avatarUrl, note } = parsed.data;

  if (username) {
    const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username));
    const [current] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId));
    if (taken && taken.id !== current?.id) { res.status(400).json({ error: "Username already taken" }); return; }
  }

  const updates: Record<string, unknown> = {};
  if (username !== undefined) updates.username = username;
  if (displayName !== undefined) updates.displayName = displayName;
  if (bio !== undefined) updates.bio = bio;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
  if (note !== undefined) updates.note = note;

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.clerkId, clerkId)).returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json(updated);
});

// ─── /users/search — MUST be before /:username ───────────────────────────────

router.get("/users/search", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 20)) : 10;
  if (!q) { res.json({ users: [], nextCursor: null }); return; }
  const term = `%${q.toLowerCase()}%`;
  const users = await db.select().from(usersTable)
    .where(or(ilike(usersTable.username, term), ilike(usersTable.displayName, term)))
    .orderBy(desc(usersTable.followersCount)).limit(limit);
  res.json({ users, nextCursor: null });
});

// ─── /users/:username ─────────────────────────────────────────────────────────

router.get("/users/:username", async (req, res): Promise<void> => {
  const parsed = GetUserByUsernameParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, parsed.data.username));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  let isFollowing = false;
  const auth = getAuth(req);
  if (auth?.userId) {
    const [viewer] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth.userId));
    if (viewer && viewer.id !== user.id) {
      const [follow] = await db.select({ id: followsTable.id }).from(followsTable)
        .where(and(eq(followsTable.followerId, viewer.id), eq(followsTable.followingId, user.id)));
      isFollowing = !!follow;
    }
  }
  res.json({ ...user, isFollowing });
});

// ─── /users/:username/followers ───────────────────────────────────────────────

router.get("/users/:username/followers", async (req, res): Promise<void> => {
  const username = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 20;
  const rawCursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  const cursor = rawCursor !== undefined && Number.isFinite(rawCursor) ? rawCursor : undefined;

  const [target] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  // followsTable.followingId = target.id → people who follow this user
  const rows = await db
    .select({
      followId: followsTable.id,
      id: usersTable.id, clerkId: usersTable.clerkId, username: usersTable.username,
      displayName: usersTable.displayName, bio: usersTable.bio, avatarUrl: usersTable.avatarUrl,
      followersCount: usersTable.followersCount, followingCount: usersTable.followingCount,
      likesCount: usersTable.likesCount, createdAt: usersTable.createdAt,
    })
    .from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followerId, usersTable.id))
    .where(and(eq(followsTable.followingId, target.id), cursor ? lt(followsTable.id, cursor) : undefined))
    .orderBy(desc(followsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].followId : null;
  const users = page.map(({ followId: _f, ...u }) => u);
  res.json({ users, nextCursor });
});

// ─── /users/:username/following ───────────────────────────────────────────────

router.get("/users/:username/following", async (req, res): Promise<void> => {
  const username = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 20;
  const rawCursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  const cursor = rawCursor !== undefined && Number.isFinite(rawCursor) ? rawCursor : undefined;

  const [target] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  // followsTable.followerId = target.id → people this user follows
  const rows = await db
    .select({
      followId: followsTable.id,
      id: usersTable.id, clerkId: usersTable.clerkId, username: usersTable.username,
      displayName: usersTable.displayName, bio: usersTable.bio, avatarUrl: usersTable.avatarUrl,
      followersCount: usersTable.followersCount, followingCount: usersTable.followingCount,
      likesCount: usersTable.likesCount, createdAt: usersTable.createdAt,
    })
    .from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followingId, usersTable.id))
    .where(and(eq(followsTable.followerId, target.id), cursor ? lt(followsTable.id, cursor) : undefined))
    .orderBy(desc(followsTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].followId : null;
  const users = page.map(({ followId: _f, ...u }) => u);
  res.json({ users, nextCursor });
});

// ─── /users/:username/videos ──────────────────────────────────────────────────

router.get("/users/:username/videos", async (req, res): Promise<void> => {
  const username = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 12;
  const rawCursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  const cursor = rawCursor !== undefined && Number.isFinite(rawCursor) ? rawCursor : undefined;

  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db
    .select({
      id: videosTable.id, userId: videosTable.userId, title: videosTable.title,
      description: videosTable.description, videoPath: videosTable.videoPath,
      thumbnailPath: videosTable.thumbnailPath, duration: videosTable.duration,
      status: videosTable.status, viewsCount: videosTable.viewsCount,
      likesCount: videosTable.likesCount, commentsCount: videosTable.commentsCount,
      createdAt: videosTable.createdAt,
      authorId: usersTable.id, authorUsername: usersTable.username,
      authorDisplayName: usersTable.displayName, authorAvatarUrl: usersTable.avatarUrl,
    })
    .from(videosTable)
    .innerJoin(usersTable, eq(videosTable.userId, usersTable.id))
    .where(and(eq(videosTable.userId, user.id), cursor ? lt(videosTable.id, cursor) : undefined))
    .orderBy(desc(videosTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  let likedVideoIds = new Set<number>();
  const auth = getAuth(req);
  if (auth?.userId && page.length > 0) {
    const [viewer] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth.userId));
    if (viewer) {
      const videoIds = page.map((r) => r.id);
      const likes = await db.select({ videoId: likesTable.videoId }).from(likesTable)
        .where(and(eq(likesTable.userId, viewer.id), inArray(likesTable.videoId, videoIds)));
      likedVideoIds = new Set(likes.map((l) => l.videoId));
    }
  }

  const videos = page.map((r) => ({
    id: r.id, userId: r.userId, title: r.title, description: r.description,
    videoPath: r.videoPath, thumbnailPath: r.thumbnailPath, duration: r.duration,
    status: r.status, viewsCount: r.viewsCount, likesCount: r.likesCount,
    commentsCount: r.commentsCount, isLiked: likedVideoIds.has(r.id), createdAt: r.createdAt,
    author: { id: r.authorId, username: r.authorUsername, displayName: r.authorDisplayName, avatarUrl: r.authorAvatarUrl },
  }));

  res.json({ videos, nextCursor });
});

export default router;
