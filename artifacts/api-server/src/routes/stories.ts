import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, gt, desc, inArray } from "drizzle-orm";
import { db, usersTable, storiesTable, storyViewsTable, followsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

/** Return active stories for a given userId, with viewed-by-me flag */
async function getStoriesForUser(userId: number, viewerId: number | null) {
  const now = new Date();
  const stories = await db
    .select()
    .from(storiesTable)
    .where(and(eq(storiesTable.userId, userId), gt(storiesTable.expiresAt, now)))
    .orderBy(desc(storiesTable.createdAt));

  if (!viewerId || stories.length === 0) return stories.map((s) => ({ ...s, viewed: false }));

  const viewedIds = new Set(
    (await db
      .select({ storyId: storyViewsTable.storyId })
      .from(storyViewsTable)
      .where(
        and(
          eq(storyViewsTable.viewerId, viewerId),
          inArray(storyViewsTable.storyId, stories.map((s) => s.id)),
        ),
      )).map((r) => r.storyId),
  );

  return stories.map((s) => ({ ...s, viewed: viewedIds.has(s.id) }));
}

// GET /stories/feed — stories from people I follow + my own
router.get("/stories/feed", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth!.userId!));
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  // Get followed users
  const followed = await db
    .select({ followingId: followsTable.followingId })
    .from(followsTable)
    .where(eq(followsTable.followerId, me.id));

  const userIds = [me.id, ...followed.map((f) => f.followingId)];
  const now = new Date();

  // Get users who have active stories
  const activeStoryUsers = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .innerJoin(storiesTable, and(
      eq(storiesTable.userId, usersTable.id),
      gt(storiesTable.expiresAt, now),
    ))
    .where(inArray(usersTable.id, userIds))
    .groupBy(usersTable.id, usersTable.username, usersTable.displayName, usersTable.avatarUrl);

  // For each user check if all stories are viewed; also fetch their note
  const result = await Promise.all(
    activeStoryUsers.map(async (u) => {
      const stories = await getStoriesForUser(u.id, me.id);
      const allViewed = stories.length > 0 && stories.every((s) => s.viewed);
      // Fetch note field for the user
      const [full] = await db.select({ note: usersTable.note }).from(usersTable).where(eq(usersTable.id, u.id));
      return { user: { ...u, note: full?.note ?? null }, storyCount: stories.length, allViewed, isOwn: u.id === me.id };
    }),
  );

  // Own story first, then unviewed, then viewed
  result.sort((a, b) => {
    if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
    if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
    return 0;
  });

  res.json({ storyUsers: result });
});

// GET /stories/user/:userId — stories for a specific user
router.get("/stories/user/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId as string, 10);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  const auth = getAuth(req);
  let viewerId: number | null = null;
  if (auth?.userId) {
    const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth.userId));
    viewerId = me?.id ?? null;
  }

  const stories = await getStoriesForUser(userId, viewerId);
  res.json({ stories });
});

// POST /stories — upload a new story
router.post("/stories", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth!.userId!));
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const { mediaPath, mediaType = "image" } = req.body as { mediaPath?: string; mediaType?: string };
  if (!mediaPath) { res.status(400).json({ error: "mediaPath is required" }); return; }
  if (!["image", "video"].includes(mediaType)) { res.status(400).json({ error: "mediaType must be image or video" }); return; }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const [story] = await db
    .insert(storiesTable)
    .values({ userId: me.id, mediaPath, mediaType, expiresAt })
    .returning();

  res.status(201).json({ story });
});

// POST /stories/:id/view — mark a story as viewed
router.post("/stories/:id/view", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const storyId = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(storyId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth!.userId!));
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  // Idempotent — ignore if already viewed
  await db
    .insert(storyViewsTable)
    .values({ storyId, viewerId: me.id })
    .onConflictDoNothing();

  res.status(204).end();
});

export default router;
