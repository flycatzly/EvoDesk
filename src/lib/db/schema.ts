// 设计决策:
// 1. 外键/索引:本期不加 REFERENCES 约束 —— SQLite 不支持事后 ADD CONSTRAINT,补外键需要整表重建迁移(已评估、有意推迟);
//    索引也推迟到查询模式(status/project_id/due_date)明确后,随下一次迁移一并添加。
// 2. 时间戳:所有时间/到期列统一存 UTC ISO 字符串(toISOString(),如 2026-09-07T00:00:00.000Z);
//    领域代码依赖其字典序比较,禁止写入带时区偏移的混合格式。
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"), // JSON 数组
  complexity: text("complexity").notNull().default("M"), // S|M|L
  priority: integer("priority").notNull().default(1), // 0低 3紧急
  dueDate: text("due_date"), // ISO 日期 yyyy-mm-dd
  projectId: text("project_id"),
  recurringRuleId: text("recurring_rule_id"),
  status: text("status").notNull().default("inbox"),
  flowTemplateId: text("flow_template_id"),
  outcomeNote: text("outcome_note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const flowTemplates = sqliteTable("flow_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"), // 适用标签 niche
  complexity: text("complexity").notNull().default("M"),
  version: integer("version").notNull().default(1),
  lineageId: text("lineage_id").notNull(),
  parentId: text("parent_id"),
  origin: text("origin").notNull().default("seed"), // seed|manual|evolution
  status: text("status").notNull().default("active"), // active|experimental|retired
  steps: text("steps").notNull().default("[]"), // JSON,见规格 §5.2
  statRuns: integer("stat_runs").notNull().default(0),
  statSuccessRate: real("stat_success_rate").notNull().default(0),
  statAvgCostUsd: real("stat_avg_cost_usd").notNull().default(0),
  statAvgDurationMs: integer("stat_avg_duration_ms").notNull().default(0),
  statAvgSatisfaction: real("stat_avg_satisfaction").notNull().default(0),
  statLastUsedAt: text("stat_last_used_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const executors = sqliteTable("executors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("llm"), // llm|manual|script
  role: text("role").notNull().default("executor"), // triage|planner|executor|reviewer|evolution
  model: text("model"),
  providerProfileId: text("provider_profile_id"),
  apiBase: text("api_base"),
  protocol: text("protocol").notNull().default("openai"), // openai|anthropic
  apiKeyRef: text("api_key_ref"), // env:NAME | plain:xxx
  costPer1kInput: real("cost_per_1k_input").notNull().default(0),
  costPer1kOutput: real("cost_per_1k_output").notNull().default(0),
  shell: text("shell"), // powershell|cmd|bash|python(script 用)
  commandTemplate: text("command_template"),
  workingDir: text("working_dir"),
  timeoutMs: integer("timeout_ms").notNull().default(60000),
  autoApprove: integer("auto_approve", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const recurringRules = sqliteTable("recurring_rules", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  complexity: text("complexity").notNull().default("S"),
  priority: integer("priority").notNull().default(1),
  projectId: text("project_id"),
  freq: text("freq").notNull(), // daily|weekdays|weekly
  weekday: integer("weekday"), // weekly 用 0-6(周日=0)
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  nextRunAt: text("next_run_at").notNull(), // ISO
  lastTaskId: text("last_task_id"),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
});

export const flowRuns = sqliteTable("flow_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  templateId: text("template_id").notNull(),
  templateVersion: integer("template_version").notNull().default(1),
  status: text("status").notNull().default("running"), // running|waiting_human|done|failed|canceled(review 是任务态)
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  totalCostUsd: real("total_cost_usd").notNull().default(0),
  totalDurationMs: integer("total_duration_ms").notNull().default(0),
  satisfaction: integer("satisfaction"),
  outcomeNote: text("outcome_note"),
});

export const stepRuns = sqliteTable("step_runs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  stepIndex: integer("step_index").notNull(),
  stepName: text("step_name").notNull(),
  executorType: text("executor_type").notNull(), // llm|manual|checkpoint|script
  model: text("model"),
  status: text("status").notNull().default("pending"), // pending|awaiting_confirmation|running|done|skipped|failed
  input: text("input"),
  output: text("output"),
  error: text("error"),
  costUsd: real("cost_usd").notNull().default(0),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  attempt: integer("attempt").notNull().default(1),
  rejected: integer("rejected").notNull().default(0),
  feedback: text("feedback"),
  feedbackNote: text("feedback_note"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const providerProfiles = sqliteTable("provider_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  protocol: text("protocol").notNull().default("anthropic"), // anthropic|openai
  apiBase: text("api_base").notNull(),
  apiKeyRef: text("api_key_ref").notNull(),
  candidates: text("candidates").notNull().default("[]"), // [{model, alias, tier}]
  source: text("source").notNull().default("import"), // import|manual
  importPath: text("import_path"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const chats = sqliteTable("chats", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  mode: text("mode").notNull().default("chat"), // chat|coach(需求教练)
  workdir: text("workdir"), // 绑定的本地工作目录(绝对路径,可空)
  defaultExecutorId: text("default_executor_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  role: text("role").notNull(), // user|assistant
  content: text("content").notNull(),
  executorId: text("executor_id"),
  model: text("model"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const quickActions = sqliteTable("quick_actions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("command"), // command|url|launch
  payload: text("payload").notNull(), // command 模板 / url / JSON {profile_id, model?, workdir?}
  shell: text("shell"),
  icon: text("icon"),
  sort: integer("sort").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const quickActionRuns = sqliteTable("quick_action_runs", {
  id: text("id").primaryKey(),
  actionId: text("action_id").notNull(),
  renderedPayload: text("rendered_payload").notNull(),
  output: text("output"),
  exitCode: integer("exit_code"),
  status: text("status").notNull(), // ok|failed|timeout|canceled
  durationMs: integer("duration_ms").notNull().default(0),
  ts: text("ts").notNull(),
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull().default("manual"), // manual|chat|task|news_digest
  taskId: text("task_id"),
  vaultPath: text("vault_path"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const evolutionEvents = sqliteTable("evolution_events", {
  id: text("id").primaryKey(),
  ts: text("ts").notNull(),
  kind: text("kind").notNull(), // variant_created|promoted|retired|analysis_run
  templateId: text("template_id"),
  relatedTemplateId: text("related_template_id"),
  reason: text("reason").notNull().default(""),
  detail: text("detail").notNull().default("{}"),
});

export const links = sqliteTable("links", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  category: text("category").notNull().default("常用"),
  sort: integer("sort").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("custom"), // reading|fitness|project|custom
  target: integer("target").notNull(),
  current: integer("current").notNull().default(0),
  unit: text("unit").notNull().default(""),
  deadline: text("deadline"),
  color: text("color"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const canvases = sqliteTable("canvases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  columns: text("columns").notNull().default("2"), // "2"|"3"
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  layout: text("layout").notNull().default("[]"),
  isTemplate: integer("is_template", { mode: "boolean" }).notNull().default(false),
  shareToken: text("share_token"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(), // BOSS encryptJobId,按其去重
  title: text("title").notNull(),
  salaryDesc: text("salary_desc").notNull().default(""),
  city: text("city").notNull().default(""),
  area: text("area").notNull().default(""),
  brand: text("brand").notNull().default(""),
  scale: text("scale").notNull().default(""),
  experience: text("experience").notNull().default(""),
  degree: text("degree").notNull().default(""),
  labels: text("labels").notNull().default("[]"),
  jd: text("jd").notNull().default(""),
  url: text("url").notNull().default(""),
  securityId: text("security_id"),
  lid: text("lid"),
  searchMeta: text("search_meta").notNull().default("{}"), // 抓取来源(关键词/城市/时间)
  fetchedAt: text("fetched_at").notNull(),
});

export const jobsRuns = sqliteTable("jobs_runs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull().default("scrape"), // scrape|check|setup|smoke
  params: text("params").notNull().default("{}"),
  status: text("status").notNull().default("running"), // running|ok|failed|timeout
  output: text("output").notNull().default(""),
  jobCount: integer("job_count").notNull().default(0),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});
