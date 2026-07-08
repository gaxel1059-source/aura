import { pgTable, serial, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { videosTable } from "./videos";
import { commentsTable } from "./comments";

export const notificationTypeEnum = pgEnum("notification_type", ["like", "follow", "comment", "friend_request", "friend_accept"]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }), // recipient
  actorId: integer("actor_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }), // who triggered the notification
  type: notificationTypeEnum("type").notNull(),
  videoId: integer("video_id").references(() => videosTable.id, { onDelete: "cascade" }),
  commentId: integer("comment_id").references(() => commentsTable.id, { onDelete: "cascade" }),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
