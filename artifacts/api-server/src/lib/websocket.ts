import { IncomingMessage, Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { verifyToken } from "@clerk/express";
import { db, usersTable, conversationParticipantsTable, friendshipsTable } from "@workspace/db";
import { eq, and, inArray, or } from "drizzle-orm";
import { logger } from "./logger";

// Map userId → Set of open sockets
const connections = new Map<number, Set<WebSocket>>();

// Track active calls: callerUserId → calleeUserId (bidirectional)
const activeCalls = new Map<number, number>();

// Plain types — no browser DOM dependency
interface RtcSdp { type: string; sdp?: string }
interface RtcIceCandidate { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null }

export type WsEvent =
  | { type: "message:new"; payload: Record<string, unknown> }
  | { type: "call:offer"; payload: { to: number; offer: RtcSdp; callType: "audio" | "video"; from: number; fromUsername: string } }
  | { type: "call:answer"; payload: { to: number; answer: RtcSdp } }
  | { type: "call:ice-candidate"; payload: { to: number; candidate: RtcIceCandidate } }
  | { type: "call:end"; payload: { to: number } }
  | { type: "call:reject"; payload: { to: number } };

function send(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function broadcast(userId: number, event: unknown) {
  const sockets = connections.get(userId);
  if (!sockets) return;
  for (const ws of sockets) send(ws, event);
}

async function authenticateToken(token: string): Promise<number | null> {
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    const clerkId = payload.sub;
    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));
    return user?.id ?? null;
  } catch (err) {
    logger.warn({ err: String(err) }, "WS token verification error");
    return null;
  }
}

/** Verify two users are friends OR share a conversation */
async function canCall(userA: number, userB: number): Promise<boolean> {
  // Check friendship
  const [friendship] = await db
    .select({ id: friendshipsTable.id })
    .from(friendshipsTable)
    .where(
      and(
        eq(friendshipsTable.status, "accepted"),
        or(
          and(eq(friendshipsTable.requesterId, userA), eq(friendshipsTable.addresseeId, userB)),
          and(eq(friendshipsTable.requesterId, userB), eq(friendshipsTable.addresseeId, userA)),
        ),
      ),
    );
  if (friendship) return true;

  // Check shared conversation
  const aConvs = await db
    .select({ convId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userA));
  if (aConvs.length === 0) return false;

  const shared = await db
    .select({ convId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.userId, userB),
        inArray(conversationParticipantsTable.conversationId, aConvs.map((r) => r.convId)),
      ),
    );
  return shared.length > 0;
}

/** Check that sender is in the registered active call with recipient */
function inActiveCallWith(a: number, b: number): boolean {
  return activeCalls.get(a) === b || activeCalls.get(b) === a;
}

export function createWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    logger.info({ pathname: url.pathname }, "WS upgrade received");
    // Accept /api/ws regardless of any path prefix the proxy may keep
    if (!url.pathname.endsWith("/api/ws")) {
      logger.warn({ pathname: url.pathname }, "WS upgrade rejected — path mismatch");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      logger.warn("WS connection rejected — missing token");
      ws.close(4001, "Missing token");
      return;
    }

    logger.info("WS authenticating token...");
    const userId = await authenticateToken(token);
    if (!userId) {
      logger.warn("WS connection rejected — token invalid or user not found");
      ws.close(4003, "Unauthorized");
      return;
    }

    if (!connections.has(userId)) connections.set(userId, new Set());
    connections.get(userId)!.add(ws);
    logger.info({ userId }, "WebSocket connected");

    ws.on("message", async (raw) => {
      let event: WsEvent;
      try { event = JSON.parse(raw.toString()) as WsEvent; }
      catch { return; }

      switch (event.type) {
        case "call:offer": {
          const { to, offer, callType } = event.payload;
          const allowed = await canCall(userId, to);
          if (!allowed) return;
          if (activeCalls.has(userId) || activeCalls.has(to)) return;

          activeCalls.set(userId, to);
          activeCalls.set(to, userId);

          const [caller] = await db
            .select({ username: usersTable.username })
            .from(usersTable)
            .where(eq(usersTable.id, userId));

          broadcast(to, {
            type: "call:offer",
            payload: { to, offer, callType, from: userId, fromUsername: caller?.username ?? "User" },
          });
          break;
        }

        case "call:answer": {
          const { to, answer } = event.payload;
          if (!inActiveCallWith(userId, to)) return;
          broadcast(to, { type: "call:answer", payload: { to: userId, answer } });
          break;
        }

        case "call:ice-candidate": {
          const { to, candidate } = event.payload;
          if (!inActiveCallWith(userId, to)) return;
          broadcast(to, { type: "call:ice-candidate", payload: { to: userId, candidate } });
          break;
        }

        case "call:end":
        case "call:reject": {
          const { to } = event.payload;
          if (!inActiveCallWith(userId, to)) return;
          activeCalls.delete(userId);
          activeCalls.delete(to);
          broadcast(to, { type: event.type, payload: { to: userId } });
          break;
        }
      }
    });

    ws.on("close", () => {
      const sockets = connections.get(userId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) connections.delete(userId);
      }
      const partner = activeCalls.get(userId);
      if (partner !== undefined) {
        activeCalls.delete(userId);
        activeCalls.delete(partner);
        broadcast(partner, { type: "call:end", payload: { to: userId } });
      }
      logger.info({ userId }, "WebSocket disconnected");
    });

    ws.on("error", (err) => logger.warn({ err, userId }, "WebSocket error"));

    send(ws, { type: "connected", payload: { userId } });
  });

  return wss;
}
