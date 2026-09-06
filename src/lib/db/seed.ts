import type { Db } from "./test-util";
import { flowTemplates, executors, projects, recurringRules, settings, tasks } from "./schema";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const tomorrow = () => {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString();
};

const T = (name: string, complexity: string, tags: string[], steps: unknown[]) => ({
  id: id(), name, description: "", tags: JSON.stringify(tags), complexity, version: 1,
  lineageId: id(), origin: "seed", status: "active", steps: JSON.stringify(steps),
  createdAt: now(), updatedAt: now(),
});

export function seedIfEmpty(db: Db): void {
  const has = (db.select().from(tasks).all() as unknown[]).length > 0
    || (db.select().from(flowTemplates).all() as unknown[]).length > 0;
  if (has) return;

  // 整体包在事务里:中途失败回滚,避免留下"非空但残缺"的种子数据使幂等守卫永远跳过补种。
  db.transaction((tx) => {
  // 模板步骤绑定的是角色(executorRole),运行时由执行引擎按角色解析到该角色下已启用的执行器 —— 种子里的模型执行器默认未启用。
  tx.insert(flowTemplates).values([
    T("S 轻量通道", "S", [], [
      { name: "快速执行", type: "llm", executorRole: "executor", prompt: "直接完成任务:{{task.title}}\n{{task.description}}", optional: false },
      { name: "交付确认", type: "checkpoint", instruction: "确认产出满足预期", optional: false },
    ]),
    T("M 标准流程", "M", [], [
      { name: "任务澄清", type: "llm", executorRole: "planner", prompt: "澄清任务目标与边界:{{task.title}}\n{{task.description}}", optional: false },
      { name: "执行", type: "llm", executorRole: "executor", prompt: "完成任务:{{task.title}}\n{{task.description}}\n参考上一步:\n{{prev_output}}", optional: false },
      { name: "自检", type: "llm", executorRole: "reviewer", prompt: "检查产出是否完整可用:\n{{prev_output}}", optional: false },
      { name: "交付审核", type: "checkpoint", instruction: "对照完成标准检查", optional: false },
    ]),
    T("L 深度流程", "L", [], [
      { name: "规划", type: "llm", executorRole: "planner", prompt: "制定分步计划:{{task.title}}\n{{task.description}}", optional: false },
      { name: "收集素材", type: "manual", instruction: "手动整理参考资料并粘贴到下方", optional: true },
      { name: "执行", type: "llm", executorRole: "executor", prompt: "按计划执行:{{task.title}}\n{{task.description}}\n计划:\n{{prev_output}}", optional: false },
      { name: "审查", type: "llm", executorRole: "reviewer", prompt: "严格审查:\n{{prev_output}}", optional: false },
      { name: "修订", type: "llm", executorRole: "executor", prompt: "按审查意见修订:\n{{prev_output}}", optional: false },
      { name: "交付审核", type: "checkpoint", instruction: "最终确认", optional: false },
    ]),
    T("资讯摘要", "M", ["研究"], [
      { name: "要点提取", type: "llm", executorRole: "executor", prompt: "从以下资讯中提取 5 条要点:\n{{task.description}}", optional: false },
      { name: "摘要卡生成", type: "llm", executorRole: "executor", prompt: "把要点整理成 200 字内摘要卡:\n{{prev_output}}", optional: false },
      { name: "归档确认", type: "checkpoint", instruction: "确认摘要准确后归档到笔记", optional: false },
    ]),
  ]).run();

  tx.insert(executors).values([
    { id: id(), name: "人工", type: "manual", role: "executor", enabled: true, createdAt: now() },
    { id: id(), name: "快速模型", type: "llm", role: "triage", model: "YOUR_FAST_MODEL", apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_FAST_KEY", enabled: false, createdAt: now() },
    { id: id(), name: "强模型", type: "llm", role: "planner", model: "YOUR_STRONG_MODEL", apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_STRONG_KEY", enabled: false, createdAt: now() },
    { id: id(), name: "PowerShell 本地执行", type: "script", role: "executor", shell: "powershell", workingDir: "data/sandbox", timeoutMs: 60000, autoApprove: false, enabled: true, createdAt: now() },
  ]).run();

  const p1 = id(), p2 = id();
  tx.insert(projects).values([
    { id: p1, name: "工作台开发", color: "#6366f1", createdAt: now() },
    { id: p2, name: "个人成长", color: "#8b5cf6", createdAt: now() },
  ]).run();

  tx.insert(recurringRules).values([
    { id: id(), title: "英语学习 30 分钟", tags: '["学习"]', complexity: "S", priority: 1, projectId: p2, freq: "daily", enabled: true, nextRunAt: tomorrow(), createdAt: now() },
    { id: id(), title: "健身 45 分钟", tags: '["健身"]', complexity: "S", priority: 1, projectId: p2, freq: "weekly", weekday: 1, enabled: true, nextRunAt: tomorrow(), createdAt: now() },
  ]).run();

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  tx.insert(tasks).values([
    { id: id(), title: "试用 EvoDesk:把一条任务走完分诊流程", tags: '["事务"]', complexity: "S", status: "inbox", createdAt: now(), updatedAt: now() },
    { id: id(), title: "阅读行业周报并摘要", tags: '["研究"]', complexity: "M", status: "inbox", projectId: p1, createdAt: now(), updatedAt: now() },
    { id: id(), title: "整理 Obsidian 笔记目录", tags: '["事务"]', complexity: "M", status: "ready", dueDate: today, projectId: p1, createdAt: now(), updatedAt: now() },
    { id: id(), title: "体检预约", tags: '["生活"]', complexity: "S", status: "ready", dueDate: yesterday, createdAt: now(), updatedAt: now() },
    { id: id(), title: "配置每日站会要点模板", tags: '["事务"]', complexity: "M", status: "done", projectId: p1, createdAt: now(), updatedAt: now() },
  ]).run();

  // settings 是唯一有固定主键的种子表:库可能处于"内容为空但 settings 已有键"的部分状态
  // (如旧版冒烟或用户改过设置),冲突忽略让种子收敛——已有键保留用户值,缺失键补齐。
  tx.insert(settings).values([
    { key: "theme", value: '"dark"' },
    { key: "cost_budget_usd", value: "10" },
    { key: "vault_path", value: '"D:\\\\work\\\\Obsidian\\\\Obsidian"' },
    { key: "known_tags", value: '["写作","研究","事务","开发","生活","学习","健身"]' },
    { key: "waiting_human_timeout_hours", value: "24" },
  ]).onConflictDoNothing().run();
  });
}
