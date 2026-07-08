import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc } from "drizzle-orm";
import { db, usersTable, highlightsTable, highlightItemsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// GET /highlights/user/:userId — all highlights with items for a user
router.get("/highlights/user/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId as string, 10);
  if (!Number.isFinite(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  const highlights = await db
    .select()
    .from(highlightsTable)
    .where(eq(highlightsTable.userId, userId))
    .orderBy(desc(highlightsTable.createdAt));

  const withItems = await Promise.all(
    highlights.map(async (h) => {
      const items = await db
        .select()
        .from(highlightItemsTable)
        .where(eq(highlightItemsTable.highlightId, h.id))
        .orderBy(highlightItemsTable.addedAt);
      return { ...h, items };
    }),
  );

  res.json({ highlights: withItems });
});

// POST /highlights — create a new highlight
router.post("/highlights", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth!.userId!));
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const { title = "Destacada", mediaPath, mediaType = "image" } = req.body as {
    title?: string; mediaPath?: string; mediaType?: string;
  };
  if (!mediaPath) { res.status(400).json({ error: "mediaPath is required" }); return; }

  const [highlight] = await db
    .insert(highlightsTable)
    .values({ userId: me.id, title, coverPath: mediaPath })
    .returning();

  const [item] = await db
    .insert(highlightItemsTable)
    .values({ highlightId: highlight.id, mediaPath, mediaType })
    .returning();

  res.status(201).json({ highlight: { ...highlight, items: [item] } });
});

// POST /highlights/:id/items — add an item to an existing highlight
router.post("/highlights/:id/items", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const highlightId = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(highlightId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth!.userId!));
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const [highlight] = await db.select().from(highlightsTable).where(
    and(eq(highlightsTable.id, highlightId), eq(highlightsTable.userId, me.id)),
  );
  if (!highlight) { res.status(404).json({ error: "Highlight not found" }); return; }

  const { mediaPath, mediaType = "image" } = req.body as { mediaPath?: string; mediaType?: string };
  if (!mediaPath) { res.status(400).json({ error: "mediaPath is required" }); return; }

  const [item] = await db
    .insert(highlightItemsTable)
    .values({ highlightId, mediaPath, mediaType })
    .returning();

  // Update cover to latest if none set
  if (!highlight.coverPath) {
    await db.update(highlightsTable).set({ coverPath: mediaPath }).where(eq(highlightsTable.id, highlightId));
  }

  res.status(201).json({ item });
});

// PATCH /highlights/:id — rename a highlight
router.patch("/highlights/:id", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const highlightId = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(highlightId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth!.userId!));
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  const { title } = req.body as { title?: string };
  if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }

  const [updated] = await db
    .update(highlightsTable)
    .set({ title: title.trim() })
    .where(and(eq(highlightsTable.id, highlightId), eq(highlightsTable.userId, me.id)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ highlight: updated });
});

// DELETE /highlights/:id — delete a highlight
router.delete("/highlights/:id", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const highlightId = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(highlightId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth!.userId!));
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  await db.delete(highlightsTable).where(
    and(eq(highlightsTable.id, highlightId), eq(highlightsTable.userId, me.id)),
  );
  res.status(204).end();
});

// DELETE /highlights/:id/items/:itemId — remove a single item from a highlight
router.delete("/highlights/:id/items/:itemId", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const highlightId = parseInt(req.params.id as string, 10);
  const itemId = parseInt(req.params.itemId as string, 10);

  const [me] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, auth!.userId!));
  if (!me) { res.status(404).json({ error: "User not found" }); return; }

  // Verify ownership via highlight
  const [highlight] = await db.select({ id: highlightsTable.id }).from(highlightsTable).where(
    and(eq(highlightsTable.id, highlightId), eq(highlightsTable.userId, me.id)),
  );
  if (!highlight) { res.status(404).json({ error: "Highlight not found" }); return; }

  await db.delete(highlightItemsTable).where(
    and(eq(highlightItemsTable.id, itemId), eq(highlightItemsTable.highlightId, highlightId)),
  );
  res.status(204).end();
});

export default router;
