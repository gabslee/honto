CREATE INDEX IF NOT EXISTS `idx_players_room_joined` ON `players` (`room_id`,`joined_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_rounds_room_number` ON `rounds` (`room_id`,`round_number`);--> statement-breakpoint
PRAGMA optimize;
