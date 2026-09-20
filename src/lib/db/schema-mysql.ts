// MySQL 方言 schema:与 schema.ts(SQLite)表/列一一对应。
// 映射规则:int({mode:"boolean"}) → boolean("…");其余 text/integer/real 同名;
// 时间戳保持 text 列(UTC-ISO 字符串,字典序=时间序,跨库行为一致)。
// 由 drizzle-mysql.config.ts(dialect:"mysql")生成 MySQL 迁移。
import { mysqlTable, text, int, real, boolean, index, varchar } from "drizzle-orm/mysql-core";

// varchar 长度约定:主键/枚举/短字段 191(MySQL 索引长度安全);正文/长文本 text。
const PK = () => varchar("id", { length: 64 });

export const projects = mysqlTable("projects", {
  id: PK(),
  name: text("name").notNull(),
  color: text("color"),
  archived: boolean("archived").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => [index("idx_projects_archived").on(t.archived)]);

export const tasks = mysqlTable("tasks", {
  id: PK(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  complexity: varchar("complexity", { length: 4 }).notNull().default("M"),
  priority: int("priority").notNull().default(1),
  dueDate: text("due_date"),
  projectId: text("project_id"),
  recurringRuleId: text("recurring_rule_id"),
  status: varchar("status", { length: 24 }).notNull().default("inbox"),
  flowTemplateId: text("flow_template_id"),
  outcomeNote: text("outcome_note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  index("idx_tasks_status").on(t.status),
  index("idx_tasks_due").on(t.dueDate),
]);

export const flowTemplates = mysqlTable("flow_templates", {
  id: PK(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  complexity: varchar("complexity", { length: 4 }).notNull().default("M"),
  version: int("version").notNull().default(1),
  lineageId: text("lineage_id").notNull(),
  parentId: text("parent_id"),
  origin: varchar("origin", { length: 16 }).notNull().default("seed"),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  steps: text("steps").notNull().default("[]"),
  statRuns: int("stat_runs").notNull().default(0),
  statSuccessRate: real("stat_success_rate").notNull().default(0),
  statAvgCostUsd: real("stat_avg_cost_usd").notNull().default(0),
  statAvgDurationMs: int("stat_avg_duration_ms").notNull().default(0),
  statAvgSatisfaction: real("stat_avg_satisfaction").notNull().default(0),
  statLastUsedAt: text("stat_last_used_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const executors = mysqlTable("executors", {
  id: PK(),
  name: text("name").notNull(),
  type: varchar("type", { length: 16 }).notNull().default("llm"),
  role: varchar("role", { length: 16 }).notNull().default("executor"),
  model: text("model"),
  providerProfileId: text("provider_profile_id"),
  apiBase: text("api_base"),
  protocol: varchar("protocol", { length: 16 }).notNull().default("openai"),
  apiKeyRef: text("api_key_ref"),
  costPer1kInput: real("cost_per_1k_input").notNull().default(0),
  costPer1kOutput: real("cost_per_1k_output").notNull().default(0),
  shell: text("shell"),
  commandTemplate: text("command_template"),
  workingDir: text("working_dir"),
  timeoutMs: int("timeout_ms").notNull().default(60000),
  autoApprove: boolean("auto_approve").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const recurringRules = mysqlTable("recurring_rules", {
  id: PK(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  complexity: varchar("complexity", { length: 4 }).notNull().default("S"),
  priority: int("priority").notNull().default(1),
  projectId: text("project_id"),
  freq: varchar("freq", { length: 16 }).notNull(),
  weekday: int("weekday"),
  enabled: boolean("enabled").notNull().default(true),
  nextRunAt: text("next_run_at").notNull(),
  lastTaskId: text("last_task_id"),
  createdAt: text("created_at").notNull(),
});

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
});

export const flowRuns = mysqlTable("flow_runs", {
  id: PK(),
  taskId: text("task_id").notNull(),
  templateId: text("template_id").notNull(),
  templateVersion: int("template_version").notNull().default(1),
  status: varchar("status", { length: 24 }).notNull().default("running"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  totalCostUsd: real("total_cost_usd").notNull().default(0),
  totalDurationMs: int("total_duration_ms").notNull().default(0),
  satisfaction: int("satisfaction"),
  outcomeNote: text("outcome_note"),
}, (t) => [
  index("idx_flow_runs_task").on(t.taskId),
  index("idx_flow_runs_template").on(t.templateId),
  index("idx_flow_runs_status").on(t.status),
]);

export const stepRuns = mysqlTable("step_runs", {
  id: PK(),
  runId: text("run_id").notNull(),
  stepIndex: int("step_index").notNull(),
  stepName: text("step_name").notNull(),
  executorType: varchar("executor_type", { length: 16 }).notNull(),
  model: text("model"),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  input: text("input"),
  output: text("output"),
  error: text("error"),
  costUsd: real("cost_usd").notNull().default(0),
  tokensIn: int("tokens_in").notNull().default(0),
  tokensOut: int("tokens_out").notNull().default(0),
  durationMs: int("duration_ms").notNull().default(0),
  attempt: int("attempt").notNull().default(1),
  rejected: int("rejected").notNull().default(0),
  feedback: text("feedback"),
  feedbackNote: text("feedback_note"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
}, (t) => [
  index("idx_step_runs_run").on(t.runId),
  index("idx_step_runs_status").on(t.status),
]);

export const providerProfiles = mysqlTable("provider_profiles", {
  id: PK(),
  name: text("name").notNull(),
  protocol: varchar("protocol", { length: 16 }).notNull().default("anthropic"),
  apiBase: text("api_base").notNull(),
  apiKeyRef: text("api_key_ref").notNull(),
  candidates: text("candidates").notNull().default("[]"),
  source: varchar("source", { length: 16 }).notNull().default("import"),
  importPath: text("import_path"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const chats = mysqlTable("chats", {
  id: PK(),
  title: text("title").notNull(),
  mode: varchar("mode", { length: 16 }).notNull().default("chat"),
  workdir: text("workdir"),
  defaultExecutorId: text("default_executor_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chatMessages = mysqlTable("chat_messages", {
  id: PK(),
  chatId: text("chat_id").notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  content: text("content").notNull(),
  executorId: text("executor_id"),
  model: text("model"),
  tokensIn: int("tokens_in").notNull().default(0),
  tokensOut: int("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => [index("idx_chat_messages_chat").on(t.chatId)]);

export const quickActions = mysqlTable("quick_actions", {
  id: PK(),
  name: text("name").notNull(),
  type: varchar("type", { length: 16 }).notNull().default("command"),
  payload: text("payload").notNull(),
  shell: text("shell"),
  icon: text("icon"),
  sort: int("sort").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const quickActionRuns = mysqlTable("quick_action_runs", {
  id: PK(),
  actionId: text("action_id").notNull(),
  renderedPayload: text("rendered_payload").notNull(),
  output: text("output"),
  exitCode: int("exit_code"),
  status: varchar("status", { length: 16 }).notNull(),
  durationMs: int("duration_ms").notNull().default(0),
  ts: text("ts").notNull(),
}, (t) => [index("idx_quick_action_runs_status").on(t.status)]);

export const notes = mysqlTable("notes", {
  id: PK(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  pinned: boolean("pinned").notNull().default(false),
  source: varchar("source", { length: 16 }).notNull().default("manual"),
  taskId: text("task_id"),
  vaultPath: text("vault_path"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const evolutionEvents = mysqlTable("evolution_events", {
  id: PK(),
  ts: text("ts").notNull(),
  kind: varchar("kind", { length: 24 }).notNull(),
  templateId: text("template_id"),
  relatedTemplateId: text("related_template_id"),
  reason: text("reason").notNull().default(""),
  detail: text("detail").notNull().default("{}"),
});

export const links = mysqlTable("links", {
  id: PK(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  category: varchar("category", { length: 191 }).notNull().default("常用"),
  sort: int("sort").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => [index("idx_links_category").on(t.category)]);

export const goals = mysqlTable("goals", {
  id: PK(),
  title: text("title").notNull(),
  category: varchar("category", { length: 16 }).notNull().default("custom"),
  target: int("target").notNull(),
  current: int("current").notNull().default(0),
  unit: varchar("unit", { length: 32 }).notNull().default(""),
  deadline: text("deadline"),
  color: text("color"),
  archived: boolean("archived").notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const canvases = mysqlTable("canvases", {
  id: PK(),
  name: varchar("name", { length: 191 }).notNull(),
  columns: varchar("columns", { length: 4 }).notNull().default("2"),
  locked: boolean("locked").notNull().default(false),
  layout: text("layout").notNull().default("[]"),
  isTemplate: boolean("is_template").notNull().default(false),
  shareToken: varchar("share_token", { length: 64 }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const jobs = mysqlTable("jobs", {
  id: PK(),
  jobId: text("job_id").notNull(),
  title: text("title").notNull(),
  salaryDesc: text("salary_desc").notNull().default(""),
  city: varchar("city", { length: 64 }).notNull().default(""),
  area: varchar("area", { length: 64 }).notNull().default(""),
  brand: varchar("brand", { length: 128 }).notNull().default(""),
  scale: varchar("scale", { length: 64 }).notNull().default(""),
  experience: varchar("experience", { length: 64 }).notNull().default(""),
  degree: varchar("degree", { length: 64 }).notNull().default(""),
  labels: text("labels").notNull().default("[]"),
  jd: text("jd").notNull().default(""),
  url: text("url").notNull().default(""),
  securityId: text("security_id"),
  lid: text("lid"),
  searchMeta: text("search_meta").notNull().default("{}"),
  fetchedAt: text("fetched_at").notNull(),
});

export const jobsRuns = mysqlTable("jobs_runs", {
  id: PK(),
  kind: varchar("kind", { length: 16 }).notNull().default("scrape"),
  params: text("params").notNull().default("{}"),
  status: varchar("status", { length: 16 }).notNull().default("running"),
  output: text("output").notNull().default(""),
  jobCount: int("job_count").notNull().default(0),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
}, (t) => [index("idx_jobs_runs_status").on(t.status)]);

export const issues = mysqlTable("issues", {
  id: PK(),
  source: varchar("source", { length: 16 }).notNull(),
  sourceId: varchar("source_id", { length: 64 }).notNull(),
  sourceLabel: varchar("source_label", { length: 191 }).notNull().default(""),
  errorText: text("error_text").notNull().default(""),
  status: varchar("status", { length: 16 }).notNull().default("open"),
  cause: text("cause").notNull().default(""),
  fixKind: varchar("fix_kind", { length: 16 }).notNull().default("none"),
  fixStatus: varchar("fix_status", { length: 16 }).notNull().default("pending"),
  fixAttempts: int("fix_attempts").notNull().default(0),
  fixResult: text("fix_result").notNull().default(""),
  aiAnalysis: text("ai_analysis").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  index("idx_issues_status").on(t.status),
  index("idx_issues_source").on(t.source, t.sourceId),
]);

export const memories = mysqlTable("memories", {
  id: PK(),
  content: text("content").notNull(),
  sourceChatId: text("source_chat_id"),
  pinned: boolean("pinned").notNull().default(false),
  hits: int("hits").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
