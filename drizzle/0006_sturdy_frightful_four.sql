CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`title` text NOT NULL,
	`salary_desc` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`area` text DEFAULT '' NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`scale` text DEFAULT '' NOT NULL,
	`experience` text DEFAULT '' NOT NULL,
	`degree` text DEFAULT '' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`jd` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`security_id` text,
	`lid` text,
	`search_meta` text DEFAULT '{}' NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'scrape' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	`job_count` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text
);
