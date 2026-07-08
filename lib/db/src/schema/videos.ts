import { pgTable, serial, integer, text, varchar, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const videoStatusEnum = pgEnum("video_status", ["processing", "ready", "failed"]);

export const videosTable = pgTable("videos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }),
  description: text("description"),
  videoPath: text("video_path").notNull(),       // objectPath in storage e.g. /objects/uploads/uuid
  thumbnailPath: text("thumbnail_path"),          // objectPath for thumbnail
  duration: integer("duration"),                  // seconds
  status: videoStatusEnum("status").notNull().default("ready"),
  viewsCount: integer("views_count").notNull().default(0),
  likesCount: integer("likes_count").notNull().default(0),
  commentsCount: integer("comments_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
