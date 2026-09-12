CREATE TABLE `evolution_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` text NOT NULL,
	`kind` text NOT NULL,
	`template_id` text,
	`related_template_id` text,
	`reason` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`task_id` text,
	`vault_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quick_action_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`rendered_payload` text NOT NULL,
	`output` text,
	`exit_code` integer,
	`status` text NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`ts` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quick_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'command' NOT NULL,
	`payload` text NOT NULL,
	`shell` text,
	`icon` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
