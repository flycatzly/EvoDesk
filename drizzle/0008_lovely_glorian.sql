CREATE INDEX `idx_chat_messages_chat` ON `chat_messages` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_flow_runs_task` ON `flow_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_flow_runs_template` ON `flow_runs` (`template_id`);--> statement-breakpoint
CREATE INDEX `idx_flow_runs_status` ON `flow_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_issues_status` ON `issues` (`status`);--> statement-breakpoint
CREATE INDEX `idx_issues_source` ON `issues` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_runs_status` ON `jobs_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_links_category` ON `links` (`category`);--> statement-breakpoint
CREATE INDEX `idx_quick_action_runs_status` ON `quick_action_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_step_runs_run` ON `step_runs` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_step_runs_status` ON `step_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_due` ON `tasks` (`due_date`);