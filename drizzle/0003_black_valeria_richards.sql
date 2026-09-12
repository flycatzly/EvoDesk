CREATE TABLE `canvases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`columns` text DEFAULT '2' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`layout` text DEFAULT '[]' NOT NULL,
	`is_template` integer DEFAULT false NOT NULL,
	`share_token` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT 'custom' NOT NULL,
	`target` integer NOT NULL,
	`current` integer DEFAULT 0 NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`deadline` text,
	`color` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`category` text DEFAULT '常用' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
