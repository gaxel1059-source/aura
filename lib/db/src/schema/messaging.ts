import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "sticker",
  "call_audio",
  "call_video",
]);

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const conversationParticipantsTable = pgTable(
  "conversation_participants",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
    lastReadAt: timestamp("last_read_at"),
  },
  (t) => ({
    uniqueParticipant: unique().on(t.conversationId, t.userId),
  }),
);

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderId: integer("sender_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: messageTypeEnum("type").notNull().default("text"),
  content: text("content"),
  stickerUrl: text("sticker_url"),
  callDuration: integer("call_duration"), // seconds, null = missed/rejected
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const stickersTable = pgTable("stickers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Conversation = typeof conversationsTable.$inferSelect;
export type ConversationParticipant =
  typeof conversationParticipantsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type Sticker = typeof stickersTable.$inferSelect;
