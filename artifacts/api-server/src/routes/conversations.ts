import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, desc, lt, inArray, sql, or } from "drizzle-orm";
import {
  db,
  usersTable,
  conversationsTable,
  conversationParticipantsTable,
  messagesTable,
  stickersTable,
  friendshipsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { broadcast } from "../lib/websocket";

const router: IRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

async function resolveUser(clerkId: string) {
  const [u] = await db
    .select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  return u ?? null;
}

async function assertParticipant(convId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: conversationParticipantsTable.id })
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, convId),
        eq(conversationParticipantsTable.userId, userId),
      ),
    );
  return !!row;
}

// ── GET /conversations ────────────────────────────────────────────────────────
router.get("/conversations", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  // Conversations where I'm a participant
  const myParticipations = await db
    .select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, viewer.id));

  if (myParticipations.length === 0) {
    res.json({ conversations: [] });
    return;
  }

  const convIds = myParticipations.map((p) => p.conversationId);

  // Load all participants for those conversations
  const participants = await db
    .select({
      conversationId: conversationParticipantsTable.conversationId,
      userId: conversationParticipantsTable.userId,
      lastReadAt: conversationParticipantsTable.lastReadAt,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(conversationParticipantsTable)
    .innerJoin(usersTable, eq(conversationParticipantsTable.userId, usersTable.id))
    .where(inArray(conversationParticipantsTable.conversationId, convIds));

  // Last message per conversation
  const lastMessages = await db
    .select({
      conversationId: messagesTable.conversationId,
      id: messagesTable.id,
      type: messagesTable.type,
      content: messagesTable.content,
      stickerUrl: messagesTable.stickerUrl,
      senderId: messagesTable.senderId,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .where(inArray(messagesTable.conversationId, convIds))
    .orderBy(desc(messagesTable.id));

  // Unread count per conversation (messages after my lastReadAt)
  const myLastReads = new Map(
    participants
      .filter((p) => p.userId === viewer.id)
      .map((p) => [p.conversationId, p.lastReadAt]),
  );

  // Group and build response
  const grouped = new Map<number, typeof participants>();
  for (const p of participants) {
    if (!grouped.has(p.conversationId)) grouped.set(p.conversationId, []);
    grouped.get(p.conversationId)!.push(p);
  }

  const lastMsgByConv = new Map<number, (typeof lastMessages)[0]>();
  for (const m of lastMessages) {
    if (!lastMsgByConv.has(m.conversationId)) lastMsgByConv.set(m.conversationId, m);
  }

  // Look up which other participants are friends with viewer
  const otherUserIds = [...new Set(
    participants
      .filter((p) => p.userId !== viewer.id)
      .map((p) => p.userId),
  )];

  const friendships =
    otherUserIds.length > 0
      ? await db
          .select({ requesterId: friendshipsTable.requesterId, addresseeId: friendshipsTable.addresseeId })
          .from(friendshipsTable)
          .where(
            and(
              eq(friendshipsTable.status, "accepted"),
              or(
                and(eq(friendshipsTable.requesterId, viewer.id), inArray(friendshipsTable.addresseeId, otherUserIds)),
                and(eq(friendshipsTable.addresseeId, viewer.id), inArray(friendshipsTable.requesterId, otherUserIds)),
              ),
            ),
          )
      : [];

  const friendIds = new Set(
    friendships.map((f) => (f.requesterId === viewer.id ? f.addresseeId : f.requesterId)),
  );

  const conversations = convIds
    .map((cid) => {
      const parts = grouped.get(cid) ?? [];
      const others = parts.filter((p) => p.userId !== viewer.id);
      const lastMsg = lastMsgByConv.get(cid) ?? null;
      const lastRead = myLastReads.get(cid) ?? null;

      const unreadCount = lastMessages.filter(
        (m) => m.conversationId === cid && m.senderId !== viewer.id &&
          (!lastRead || new Date(m.createdAt) > new Date(lastRead)),
      ).length;

      // "Message request" = at least one other participant is not a friend
      const isRequest = others.some((o) => !friendIds.has(o.userId));

      return {
        id: cid,
        isRequest,
        participants: others.map((p) => ({
          id: p.userId,
          username: p.username,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
        })),
        lastMessage: lastMsg,
        unreadCount,
      };
    })
    .sort((a, b) => {
      const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return bTime - aTime;
    });

  res.json({ conversations });
});

// ── POST /conversations — find or create DM ──────────────────────────────────
router.post("/conversations", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const { userId: otherUserId } = req.body as { userId?: number };
  if (!otherUserId || typeof otherUserId !== "number") {
    res.status(400).json({ error: "userId required" });
    return;
  }
  if (otherUserId === viewer.id) {
    res.status(400).json({ error: "Cannot message yourself" });
    return;
  }

  // Check if the other user exists
  const [other] = await db
    .select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, otherUserId));
  if (!other) { res.status(404).json({ error: "User not found" }); return; }

  // Find existing DM between the two users (exactly 2 participants)
  const myConvs = await db
    .select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, viewer.id));

  const myConvIds = myConvs.map((r) => r.conversationId);

  let existingConvId: number | null = null;
  if (myConvIds.length > 0) {
    const otherParticipations = await db
      .select({ conversationId: conversationParticipantsTable.conversationId })
      .from(conversationParticipantsTable)
      .where(
        and(
          eq(conversationParticipantsTable.userId, otherUserId),
          inArray(conversationParticipantsTable.conversationId, myConvIds),
        ),
      );

    // For each candidate, verify it only has exactly 2 participants
    for (const { conversationId } of otherParticipations) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.conversationId, conversationId));
      if (count === 2) {
        existingConvId = conversationId;
        break;
      }
    }
  }

  if (existingConvId !== null) {
    res.json({
      id: existingConvId,
      participants: [{ id: other.id, username: other.username, displayName: other.displayName, avatarUrl: other.avatarUrl }],
    });
    return;
  }

  // Create new conversation
  const conversation = await db.transaction(async (tx) => {
    const [conv] = await tx.insert(conversationsTable).values({}).returning();
    await tx.insert(conversationParticipantsTable).values([
      { conversationId: conv.id, userId: viewer.id },
      { conversationId: conv.id, userId: otherUserId },
    ]);
    return conv;
  });

  res.status(201).json({
    id: conversation.id,
    participants: [{ id: other.id, username: other.username, displayName: other.displayName, avatarUrl: other.avatarUrl }],
  });
});

// ── GET /conversations/unread-count ──────────────────────────────────────────
router.get("/conversations/unread-count", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const myParticipations = await db
    .select({
      conversationId: conversationParticipantsTable.conversationId,
      lastReadAt: conversationParticipantsTable.lastReadAt,
    })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, viewer.id));

  if (myParticipations.length === 0) {
    res.json({ count: 0 });
    return;
  }

  const convIds = myParticipations.map((p) => p.conversationId);
  const lastReadMap = new Map(myParticipations.map((p) => [p.conversationId, p.lastReadAt]));

  const allMessages = await db
    .select({ conversationId: messagesTable.conversationId, senderId: messagesTable.senderId, createdAt: messagesTable.createdAt })
    .from(messagesTable)
    .where(inArray(messagesTable.conversationId, convIds));

  const count = allMessages.filter((m) => {
    if (m.senderId === viewer.id) return false;
    const lastRead = lastReadMap.get(m.conversationId);
    return !lastRead || new Date(m.createdAt) > new Date(lastRead);
  }).length;

  res.json({ count });
});

// ── GET /conversations/:id/messages ──────────────────────────────────────────
router.get("/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const convId = Number(req.params.id);
  if (isNaN(convId)) { res.status(400).json({ error: "Invalid conversation ID" }); return; }

  const isMember = await assertParticipant(convId, viewer.id);
  if (!isMember) { res.status(403).json({ error: "Not a participant" }); return; }

  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;

  const rows = await db
    .select({
      id: messagesTable.id,
      conversationId: messagesTable.conversationId,
      senderId: messagesTable.senderId,
      type: messagesTable.type,
      content: messagesTable.content,
      stickerUrl: messagesTable.stickerUrl,
      callDuration: messagesTable.callDuration,
      createdAt: messagesTable.createdAt,
      senderUsername: usersTable.username,
      senderDisplayName: usersTable.displayName,
      senderAvatarUrl: usersTable.avatarUrl,
    })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(
      cursor
        ? and(eq(messagesTable.conversationId, convId), lt(messagesTable.id, cursor))
        : eq(messagesTable.conversationId, convId),
    )
    .orderBy(desc(messagesTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  // Mark conversation as read
  await db
    .update(conversationParticipantsTable)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, convId),
        eq(conversationParticipantsTable.userId, viewer.id),
      ),
    );

  const messages = page.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    senderId: r.senderId,
    type: r.type,
    content: r.content,
    stickerUrl: r.stickerUrl,
    callDuration: r.callDuration,
    createdAt: r.createdAt,
    sender: {
      id: r.senderId,
      username: r.senderUsername,
      displayName: r.senderDisplayName,
      avatarUrl: r.senderAvatarUrl,
    },
  }));

  res.json({ messages, nextCursor });
});

// ── POST /conversations/:id/messages ─────────────────────────────────────────
router.post("/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const convId = Number(req.params.id);
  if (isNaN(convId)) { res.status(400).json({ error: "Invalid conversation ID" }); return; }

  const isMember = await assertParticipant(convId, viewer.id);
  if (!isMember) { res.status(403).json({ error: "Not a participant" }); return; }

  const { type = "text", content, stickerUrl, callDuration } = req.body as {
    type?: string;
    content?: string;
    stickerUrl?: string;
    callDuration?: number;
  };

  const validTypes = ["text", "sticker", "call_audio", "call_video"] as const;
  if (!validTypes.includes(type as (typeof validTypes)[number])) {
    res.status(400).json({ error: "Invalid message type" });
    return;
  }

  if (type === "text" && (!content || !content.trim())) {
    res.status(400).json({ error: "Content required for text messages" });
    return;
  }

  if (type === "sticker" && !stickerUrl) {
    res.status(400).json({ error: "stickerUrl required for sticker messages" });
    return;
  }

  const [message] = await db
    .insert(messagesTable)
    .values({
      conversationId: convId,
      senderId: viewer.id,
      type: type as (typeof validTypes)[number],
      content: content?.trim() ?? null,
      stickerUrl: stickerUrl ?? null,
      callDuration: callDuration ?? null,
    })
    .returning();

  // Update conversation updatedAt
  await db
    .update(conversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(conversationsTable.id, convId));

  const response = {
    ...message,
    sender: {
      id: viewer.id,
      username: viewer.username,
      displayName: viewer.displayName,
      avatarUrl: viewer.avatarUrl,
    },
  };

  // Push to other participants via WebSocket
  const others = await db
    .select({ userId: conversationParticipantsTable.userId })
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, convId),
        // exclude sender
      ),
    );

  for (const { userId } of others) {
    if (userId !== viewer.id) {
      broadcast(userId, { type: "message:new", payload: response });
    }
  }

  res.status(201).json(response);
});

// ── GET /stickers ─────────────────────────────────────────────────────────────
router.get("/stickers", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const stickers = await db
    .select()
    .from(stickersTable)
    .where(eq(stickersTable.userId, viewer.id))
    .orderBy(desc(stickersTable.id));

  res.json({ stickers });
});

// ── POST /stickers ────────────────────────────────────────────────────────────
router.post("/stickers", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const { imageUrl, name } = req.body as { imageUrl?: string; name?: string };
  if (!imageUrl || typeof imageUrl !== "string") {
    res.status(400).json({ error: "imageUrl required" });
    return;
  }

  // Validate it's a storage URL (must be from our own storage proxy)
  const STORAGE_RE = /^\/api\/storage\/objects\/uploads\/[0-9a-f-]{36}/i;
  if (!STORAGE_RE.test(imageUrl)) {
    res.status(400).json({ error: "imageUrl must be a storage object path" });
    return;
  }

  const [sticker] = await db
    .insert(stickersTable)
    .values({ userId: viewer.id, imageUrl, name: name ?? null })
    .returning();

  res.status(201).json(sticker);
});

export default router;
