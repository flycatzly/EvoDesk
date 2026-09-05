CREATE TABLE `executors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'llm' NOT NULL,
	`role` text DEFAULT 'executor' NOT NULL,
	`model` text,
	`provider_profile_id` text,
	`api_base` text,
	`protocol` text DEFAULT 'openai' NOT NULL,
	`api_key_ref` text,
	`cost_per_1k_input` real DEFAULT 0 NOT NULL,
	`cost_per_1k_output` real DEFAULT 0 NOT NULL,
	`shell` text,
	`command_template` text,
	`working_dir` text,
	`timeout_ms` integer DEFAULT 60000 NOT NULL,
	`auto_approve` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flow_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`complexity` text DEFAULT 'M' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`lineage_id` text NOT NULL,
	`parent_id` text,
	`origin` text DEFAULT 'seed' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`stat_runs` integer DEFAULT 0 NOT NULL,
	`stat_success_rate` real DEFAULT 0 NOT NULL,
	`stat_avg_cost_usd` real DEFAULT 0 NOT NULL,
	`stat_avg_duration_ms` integer DEFAULT 0 NOT NULL,
	`stat_avg_satisfaction` real DEFAULT 0 NOT NULL,
	`stat_last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`complexity` text DEFAULT 'S' NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`project_id` text,
	`freq` text NOT NULL,
	`weekday` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` text NOT NULL,
	`last_task_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`complexity` text DEFAULT 'M' NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`due_date` text,
	`project_id` text,
	`recurring_rule_id` text,
	`status` text DEFAULT 'inbox' NOT NULL,
	`flow_template_id` text,
	`outcome_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
