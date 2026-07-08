import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, and, or, desc } from "drizzle-orm";
import {
  db,
  usersTable,
  friendshipsTable,
  notificationsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { broadcast } from "../lib/websocket";

const router: IRouter = Router();

async function resolveUser(clerkId: string) {
  const [u] = await db
    .select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  return u ?? null;
}

// ── GET /friends ──────────────────────────────────────────────────────────────
router.get("/friends", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const rows = await db
    .select({
      id: friendshipsTable.id,
      requesterId: friendshipsTable.requesterId,
      addresseeId: friendshipsTable.addresseeId,
      createdAt: friendshipsTable.createdAt,
      otherUsername: usersTable.username,
      otherDisplayName: usersTable.displayName,
      otherAvatarUrl: usersTable.avatarUrl,
      otherId: usersTable.id,
    })
    .from(friendshipsTable)
    .innerJoin(
      usersTable,
      or(
        and(eq(friendshipsTable.requesterId, viewer.id), eq(usersTable.id, friendshipsTable.addresseeId)),
        and(eq(friendshipsTable.addresseeId, viewer.id), eq(usersTable.id, friendshipsTable.requesterId)),
      ),
    )
    .where(
      and(
        eq(friendshipsTable.status, "accepted"),
        or(
          eq(friendshipsTable.requesterId, viewer.id),
          eq(friendshipsTable.addresseeId, viewer.id),
        ),
      ),
    );

  const friends = rows
    .filter((r) => r.otherId !== viewer.id)
    .map((r) => ({
      friendshipId: r.id,
      user: {
        id: r.otherId,
        username: r.otherUsername,
        displayName: r.otherDisplayName,
        avatarUrl: r.otherAvatarUrl,
      },
    }));

  res.json({ friends });
});

// ── GET /friends/requests — incoming pending requests ─────────────────────────
router.get("/friends/requests", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const rows = await db
    .select({
      id: friendshipsTable.id,
      requesterId: friendshipsTable.requesterId,
      createdAt: friendshipsTable.createdAt,
      requesterUsername: usersTable.username,
      requesterDisplayName: usersTable.displayName,
      requesterAvatarUrl: usersTable.avatarUrl,
    })
    .from(friendshipsTable)
    .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.requesterId))
    .where(
      and(
        eq(friendshipsTable.addresseeId, viewer.id),
        eq(friendshipsTable.status, "pending"),
      ),
    )
    .orderBy(desc(friendshipsTable.createdAt));

  res.json({
    requests: rows.map((r) => ({
      id: r.id,
      requester: {
        id: r.requesterId,
        username: r.requesterUsername,
        displayName: r.requesterDisplayName,
        avatarUrl: r.requesterAvatarUrl,
      },
      createdAt: r.createdAt,
    })),
  });
});

// ── GET /friends/status/:userId — friendship status with a specific user ──────
router.get("/friends/status/:userId", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const otherId = Number(req.params.userId);
  if (isNaN(otherId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  const [row] = await db
    .select()
    .from(friendshipsTable)
    .where(
      or(
        and(eq(friendshipsTable.requesterId, viewer.id), eq(friendshipsTable.addresseeId, otherId)),
        and(eq(friendshipsTable.requesterId, otherId), eq(friendshipsTable.addresseeId, viewer.id)),
      ),
    );

  if (!row) {
    res.json({ status: "none" });
    return;
  }

  // Determine perspective
  const iAmRequester = row.requesterId === viewer.id;
  res.json({
    status: row.status,         // "pending" | "accepted" | "rejected"
    direction: iAmRequester ? "sent" : "received", // who sent the request
    friendshipId: row.id,
  });
});

// ── POST /friends/request — send a friend request ────────────────────────────
router.post("/friends/request", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const { userId: addresseeId } = req.body as { userId?: number };
  if (!addresseeId || typeof addresseeId !== "number") {
    res.status(400).json({ error: "userId required" }); return;
  }
  if (addresseeId === viewer.id) {
    res.status(400).json({ error: "Cannot send friend request to yourself" }); return;
  }

  const [addressee] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, addresseeId));
  if (!addressee) { res.status(404).json({ error: "User not found" }); return; }

  // Check for existing friendship record in either direction
  const [existing] = await db
    .select()
    .from(friendshipsTable)
    .where(
      or(
        and(eq(friendshipsTable.requesterId, viewer.id), eq(friendshipsTable.addresseeId, addresseeId)),
        and(eq(friendshipsTable.requesterId, addresseeId), eq(friendshipsTable.addresseeId, viewer.id)),
      ),
    );

  if (existing) {
    res.status(409).json({ error: "Friendship record already exists", status: existing.status });
    return;
  }

  const [friendship] = await db
    .insert(friendshipsTable)
    .values({ requesterId: viewer.id, addresseeId, status: "pending" })
    .returning();

  // Create notification for addressee
  await db.insert(notificationsTable).values({
    userId: addresseeId,
    actorId: viewer.id,
    type: "friend_request",
    read: false,
  });

  broadcast(addresseeId, {
    type: "notification:new",
    payload: {
      type: "friend_request",
      actor: { id: viewer.id, username: viewer.username, displayName: viewer.displayName, avatarUrl: viewer.avatarUrl },
    },
  });

  res.status(201).json({ friendship });
});

// ── POST /friends/requests/:id/accept ─────────────────────────────────────────
router.post("/friends/requests/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const friendshipId = Number(req.params.id);
  if (isNaN(friendshipId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select()
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.id, friendshipId),
        eq(friendshipsTable.addresseeId, viewer.id),  // only addressee can accept
        eq(friendshipsTable.status, "pending"),
      ),
    );

  if (!row) { res.status(404).json({ error: "Request not found" }); return; }

  const [updated] = await db
    .update(friendshipsTable)
    .set({ status: "accepted", updatedAt: new Date() })
    .where(eq(friendshipsTable.id, friendshipId))
    .returning();

  // Notify the original requester
  await db.insert(notificationsTable).values({
    userId: row.requesterId,
    actorId: viewer.id,
    type: "friend_accept",
    read: false,
  });

  broadcast(row.requesterId, {
    type: "notification:new",
    payload: {
      type: "friend_accept",
      actor: { id: viewer.id, username: viewer.username, displayName: viewer.displayName, avatarUrl: viewer.avatarUrl },
    },
  });

  res.json({ friendship: updated });
});

// ── POST /friends/requests/:id/reject ─────────────────────────────────────────
router.post("/friends/requests/:id/reject", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const friendshipId = Number(req.params.id);
  if (isNaN(friendshipId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select()
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.id, friendshipId),
        eq(friendshipsTable.addresseeId, viewer.id),
        eq(friendshipsTable.status, "pending"),
      ),
    );

  if (!row) { res.status(404).json({ error: "Request not found" }); return; }

  const [updated] = await db
    .update(friendshipsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(friendshipsTable.id, friendshipId))
    .returning();

  res.json({ friendship: updated });
});

// ── DELETE /friends/:userId — remove friend ───────────────────────────────────
router.delete("/friends/:userId", requireAuth, async (req, res): Promise<void> => {
  const auth = getAuth(req);
  const viewer = await resolveUser(auth!.userId!);
  if (!viewer) { res.status(401).json({ error: "User not provisioned" }); return; }

  const otherId = Number(req.params.userId);
  if (isNaN(otherId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  await db
    .delete(friendshipsTable)
    .where(
      or(
        and(eq(friendshipsTable.requesterId, viewer.id), eq(friendshipsTable.addresseeId, otherId)),
        and(eq(friendshipsTable.requesterId, otherId), eq(friendshipsTable.addresseeId, viewer.id)),
      ),
    );

  res.status(204).end();
});

export default router;
