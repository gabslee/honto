CREATE TABLE IF NOT EXISTS `deck_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`card_number` integer NOT NULL,
	`type` text NOT NULL,
	`actor_id` text NOT NULL,
	`target_id` text NOT NULL,
	`status` text DEFAULT 'hidden' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`secret` text DEFAULT '{}' NOT NULL,
	`result` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_deck_cards_room_number` ON `deck_cards` (`room_id`,`card_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_deck_cards_room_status` ON `deck_cards` (`room_id`,`status`,`card_number`);
--> statement-breakpoint
PRAGMA optimize;
