CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`source_label` text DEFAULT '' NOT NULL,
	`error_text` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`cause` text DEFAULT '' NOT NULL,
	`fix_kind` text DEFAULT 'none' NOT NULL,
	`fix_status` text DEFAULT 'pending' NOT NULL,
	`fix_attempts` integer DEFAULT 0 NOT NULL,
	`fix_result` text DEFAULT '' NOT NULL,
	`ai_analysis` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
