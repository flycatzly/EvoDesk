CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`source_chat_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
