CREATE TABLE `canvases` (
	`id` varchar(64),
	`name` varchar(191) NOT NULL,
	`columns` varchar(4) NOT NULL DEFAULT '2',
	`locked` boolean NOT NULL DEFAULT false,
	`layout` text NOT NULL DEFAULT ('[]'),
	`is_template` boolean NOT NULL DEFAULT false,
	`share_token` varchar(64),
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` varchar(64),
	`chat_id` text NOT NULL,
	`role` varchar(16) NOT NULL,
	`content` text NOT NULL,
	`executor_id` text,
	`model` text,
	`tokens_in` int NOT NULL DEFAULT 0,
	`tokens_out` int NOT NULL DEFAULT 0,
	`cost_usd` real NOT NULL DEFAULT 0,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chats` (
	`id` varchar(64),
	`title` text NOT NULL,
	`mode` varchar(16) NOT NULL DEFAULT 'chat',
	`workdir` text,
	`default_executor_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evolution_events` (
	`id` varchar(64),
	`ts` text NOT NULL,
	`kind` varchar(24) NOT NULL,
	`template_id` text,
	`related_template_id` text,
	`reason` text NOT NULL DEFAULT (''),
	`detail` text NOT NULL DEFAULT ('{}')
);
--> statement-breakpoint
CREATE TABLE `executors` (
	`id` varchar(64),
	`name` text NOT NULL,
	`type` varchar(16) NOT NULL DEFAULT 'llm',
	`role` varchar(16) NOT NULL DEFAULT 'executor',
	`model` text,
	`provider_profile_id` text,
	`api_base` text,
	`protocol` varchar(16) NOT NULL DEFAULT 'openai',
	`api_key_ref` text,
	`cost_per_1k_input` real NOT NULL DEFAULT 0,
	`cost_per_1k_output` real NOT NULL DEFAULT 0,
	`shell` text,
	`command_template` text,
	`working_dir` text,
	`timeout_ms` int NOT NULL DEFAULT 60000,
	`auto_approve` boolean NOT NULL DEFAULT false,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `flow_runs` (
	`id` varchar(64),
	`task_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version` int NOT NULL DEFAULT 1,
	`status` varchar(24) NOT NULL DEFAULT 'running',
	`started_at` text NOT NULL,
	`finished_at` text,
	`total_cost_usd` real NOT NULL DEFAULT 0,
	`total_duration_ms` int NOT NULL DEFAULT 0,
	`satisfaction` int,
	`outcome_note` text
);
--> statement-breakpoint
CREATE TABLE `flow_templates` (
	`id` varchar(64),
	`name` text NOT NULL,
	`description` text NOT NULL DEFAULT (''),
	`tags` text NOT NULL DEFAULT ('[]'),
	`complexity` varchar(4) NOT NULL DEFAULT 'M',
	`version` int NOT NULL DEFAULT 1,
	`lineage_id` text NOT NULL,
	`parent_id` text,
	`origin` varchar(16) NOT NULL DEFAULT 'seed',
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`steps` text NOT NULL DEFAULT ('[]'),
	`stat_runs` int NOT NULL DEFAULT 0,
	`stat_success_rate` real NOT NULL DEFAULT 0,
	`stat_avg_cost_usd` real NOT NULL DEFAULT 0,
	`stat_avg_duration_ms` int NOT NULL DEFAULT 0,
	`stat_avg_satisfaction` real NOT NULL DEFAULT 0,
	`stat_last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` varchar(64),
	`title` text NOT NULL,
	`category` varchar(16) NOT NULL DEFAULT 'custom',
	`target` int NOT NULL,
	`current` int NOT NULL DEFAULT 0,
	`unit` varchar(32) NOT NULL DEFAULT '',
	`deadline` text,
	`color` text,
	`archived` boolean NOT NULL DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` varchar(64),
	`source` varchar(16) NOT NULL,
	`source_id` varchar(64) NOT NULL,
	`source_label` varchar(191) NOT NULL DEFAULT '',
	`error_text` text NOT NULL DEFAULT (''),
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`cause` text NOT NULL DEFAULT (''),
	`fix_kind` varchar(16) NOT NULL DEFAULT 'none',
	`fix_status` varchar(16) NOT NULL DEFAULT 'pending',
	`fix_attempts` int NOT NULL DEFAULT 0,
	`fix_result` text NOT NULL DEFAULT (''),
	`ai_analysis` text NOT NULL DEFAULT (''),
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` varchar(64),
	`job_id` text NOT NULL,
	`title` text NOT NULL,
	`salary_desc` text NOT NULL DEFAULT (''),
	`city` varchar(64) NOT NULL DEFAULT '',
	`area` varchar(64) NOT NULL DEFAULT '',
	`brand` varchar(128) NOT NULL DEFAULT '',
	`scale` varchar(64) NOT NULL DEFAULT '',
	`experience` varchar(64) NOT NULL DEFAULT '',
	`degree` varchar(64) NOT NULL DEFAULT '',
	`labels` text NOT NULL DEFAULT ('[]'),
	`jd` text NOT NULL DEFAULT (''),
	`url` text NOT NULL DEFAULT (''),
	`security_id` text,
	`lid` text,
	`search_meta` text NOT NULL DEFAULT ('{}'),
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs_runs` (
	`id` varchar(64),
	`kind` varchar(16) NOT NULL DEFAULT 'scrape',
	`params` text NOT NULL DEFAULT ('{}'),
	`status` varchar(16) NOT NULL DEFAULT 'running',
	`output` text NOT NULL DEFAULT (''),
	`job_count` int NOT NULL DEFAULT 0,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` varchar(64),
	`title` text NOT NULL,
	`url` text NOT NULL,
	`category` varchar(191) NOT NULL DEFAULT '常用',
	`sort` int NOT NULL DEFAULT 0,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` varchar(64),
	`content` text NOT NULL,
	`source_chat_id` text,
	`pinned` boolean NOT NULL DEFAULT false,
	`hits` int NOT NULL DEFAULT 0,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` varchar(64),
	`title` text NOT NULL,
	`body` text NOT NULL DEFAULT (''),
	`tags` text NOT NULL DEFAULT ('[]'),
	`pinned` boolean NOT NULL DEFAULT false,
	`source` varchar(16) NOT NULL DEFAULT 'manual',
	`task_id` text,
	`vault_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(64),
	`name` text NOT NULL,
	`color` text,
	`archived` boolean NOT NULL DEFAULT false,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_profiles` (
	`id` varchar(64),
	`name` text NOT NULL,
	`protocol` varchar(16) NOT NULL DEFAULT 'anthropic',
	`api_base` text NOT NULL,
	`api_key_ref` text NOT NULL,
	`candidates` text NOT NULL DEFAULT ('[]'),
	`source` varchar(16) NOT NULL DEFAULT 'import',
	`import_path` text,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quick_action_runs` (
	`id` varchar(64),
	`action_id` text NOT NULL,
	`rendered_payload` text NOT NULL,
	`output` text,
	`exit_code` int,
	`status` varchar(16) NOT NULL,
	`duration_ms` int NOT NULL DEFAULT 0,
	`ts` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quick_actions` (
	`id` varchar(64),
	`name` text NOT NULL,
	`type` varchar(16) NOT NULL DEFAULT 'command',
	`payload` text NOT NULL,
	`shell` text,
	`icon` text,
	`sort` int NOT NULL DEFAULT 0,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_rules` (
	`id` varchar(64),
	`title` text NOT NULL,
	`description` text NOT NULL DEFAULT (''),
	`tags` text NOT NULL DEFAULT ('[]'),
	`complexity` varchar(4) NOT NULL DEFAULT 'S',
	`priority` int NOT NULL DEFAULT 1,
	`project_id` text,
	`freq` varchar(16) NOT NULL,
	`weekday` int,
	`enabled` boolean NOT NULL DEFAULT true,
	`next_run_at` text NOT NULL,
	`last_task_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `step_runs` (
	`id` varchar(64),
	`run_id` text NOT NULL,
	`step_index` int NOT NULL,
	`step_name` text NOT NULL,
	`executor_type` varchar(16) NOT NULL,
	`model` text,
	`status` varchar(24) NOT NULL DEFAULT 'pending',
	`input` text,
	`output` text,
	`error` text,
	`cost_usd` real NOT NULL DEFAULT 0,
	`tokens_in` int NOT NULL DEFAULT 0,
	`tokens_out` int NOT NULL DEFAULT 0,
	`duration_ms` int NOT NULL DEFAULT 0,
	`attempt` int NOT NULL DEFAULT 1,
	`rejected` int NOT NULL DEFAULT 0,
	`feedback` text,
	`feedback_note` text,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` varchar(64),
	`title` text NOT NULL,
	`description` text NOT NULL DEFAULT (''),
	`tags` text NOT NULL DEFAULT ('[]'),
	`complexity` varchar(4) NOT NULL DEFAULT 'M',
	`priority` int NOT NULL DEFAULT 1,
	`due_date` text,
	`project_id` text,
	`recurring_rule_id` text,
	`status` varchar(24) NOT NULL DEFAULT 'inbox',
	`flow_template_id` text,
	`outcome_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_chat` ON `chat_messages` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_flow_runs_task` ON `flow_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_flow_runs_template` ON `flow_runs` (`template_id`);--> statement-breakpoint
CREATE INDEX `idx_flow_runs_status` ON `flow_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_issues_status` ON `issues` (`status`);--> statement-breakpoint
CREATE INDEX `idx_issues_source` ON `issues` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_runs_status` ON `jobs_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_links_category` ON `links` (`category`);--> statement-breakpoint
CREATE INDEX `idx_projects_archived` ON `projects` (`archived`);--> statement-breakpoint
CREATE INDEX `idx_quick_action_runs_status` ON `quick_action_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_step_runs_run` ON `step_runs` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_step_runs_status` ON `step_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_due` ON `tasks` (`due_date`);