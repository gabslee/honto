import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  status: text("status").notNull().default("lobby"),
  roundCount: integer("round_count").notNull().default(10),
  currentRound: integer("current_round").notNull().default(1),
  groupSipEvery: integer("group_sip_every"),
  timerMinutes: integer("timer_minutes"),
  startedAt: text("started_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  token: text("token").notNull().unique(),
  isHost: integer("is_host", { mode: "boolean" }).notNull().default(false),
  sips: integer("sips").notNull().default(0),
  joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_players_room_joined").on(table.roomId, table.joinedAt)]);

export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  authorId: text("author_id").notNull().references(() => players.id),
  prompt: text("prompt").notNull(),
  statementOne: text("statement_one").notNull(),
  statementTwo: text("statement_two").notNull(),
  statementThree: text("statement_three").notNull(),
  truthIndex: integer("truth_index").notNull(),
  guessedIndex: integer("guessed_index"),
  guesserId: text("guesser_id").references(() => players.id),
  result: text("result"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revealedAt: text("revealed_at"),
}, (table) => [uniqueIndex("idx_rounds_room_number").on(table.roomId, table.roundNumber)]);
