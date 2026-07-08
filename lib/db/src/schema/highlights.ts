import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const highlightsTable = pgTable("highlights", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Destacada"),
  coverPath: text("cover_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const highlightItemsTable = pgTable("highlight_items", {
  id: serial("id").primaryKey(),
  highlightId: integer("highlight_id").notNull().references(() => highlightsTable.id, { onDelete: "cascade" }),
  mediaPath: text("media_path").notNull(),
  mediaType: text("media_type").notNull().default("image"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Highlight = typeof highlightsTable.$inferSelect;
export type HighlightItem = typeof highlightItemsTable.$inferSelect;
