import type { Db } from "./test-util";
import { eq } from "drizzle-orm";
import { flowTemplates, executors, projects, recurringRules, settings, tasks, chats, quickActions, canvases, links, goals } from "./schema";
import { newWidgetId, type CanvasLayout } from "@/lib/domain/canvas";

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

/**
 * 按表收敛的种子:每张内容表各自按"名单缺失则补"独立判断,任何部分初始化的库
 * (如旧版冒烟留下的单条任务)都会补齐到完整可用,且绝不覆盖用户已有数据。
 * 示例任务例外:仅在任务表完全为空时播种(通用示例,不与用户任务混排)。
 */
export function seedIfEmpty(db: Db): void {
  db.transaction((tx) => {
    // —— 流程模板:按名单补齐 ——
    const tplNames = new Set((tx.select().from(flowTemplates).all() as { name: string }[]).map((t) => t.name));
    const missingTpls = [
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
    ].filter((t) => !tplNames.has(t.name));
    if (missingTpls.length > 0) tx.insert(flowTemplates).values(missingTpls).run();

    // —— 执行器:按名单补齐(模板步骤绑定角色,运行时解析)——
    const exNames = new Set((tx.select().from(executors).all() as { name: string }[]).map((e) => e.name));
    const missingEx = [
      { id: id(), name: "人工", type: "manual", role: "executor", enabled: true, createdAt: now() },
      { id: id(), name: "快速模型", type: "llm", role: "triage", model: "YOUR_FAST_MODEL", apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_FAST_KEY", enabled: false, createdAt: now() },
      { id: id(), name: "强模型", type: "llm", role: "planner", model: "YOUR_STRONG_MODEL", apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_STRONG_KEY", enabled: false, createdAt: now() },
      { id: id(), name: "PowerShell 本地执行", type: "script", role: "executor", shell: "powershell", workingDir: "data/sandbox", timeoutMs: 60000, autoApprove: false, enabled: true, createdAt: now() },
    ].filter((e) => !exNames.has(e.name));
    if (missingEx.length > 0) tx.insert(executors).values(missingEx).run();

    // —— 项目:按名单补齐 ——
    const projRows = tx.select().from(projects).all() as (typeof projects.$inferSelect)[];
    const projNames = new Set(projRows.map((p) => p.name));
    const projSeeds = [
      { id: id(), name: "工作台开发", color: "#6366f1", createdAt: now() },
      { id: id(), name: "个人成长", color: "#8b5cf6", createdAt: now() },
    ].filter((p) => !projNames.has(p.name));
    if (projSeeds.length > 0) tx.insert(projects).values(projSeeds).run();
    const projByName = (name: string) =>
      projSeeds.find((p) => p.name === name)?.id ?? projRows.find((p) => p.name === name)?.id ?? null;

    // —— 周期规则:按名单补齐(项目关联按名解析,项目缺失则挂空)——
    const ruleTitles = new Set((tx.select().from(recurringRules).all() as { title: string }[]).map((r) => r.title));
    const missingRules = [
      { id: id(), title: "英语学习 30 分钟", tags: '["学习"]', complexity: "S", priority: 1, projectId: projByName("个人成长"), freq: "daily", enabled: true, nextRunAt: tomorrow(), createdAt: now() },
      { id: id(), title: "健身 45 分钟", tags: '["健身"]', complexity: "S", priority: 1, projectId: projByName("个人成长"), freq: "weekly", weekday: 1, enabled: true, nextRunAt: tomorrow(), createdAt: now() },
    ].filter((r) => !ruleTitles.has(r.title));
    if (missingRules.length > 0) tx.insert(recurringRules).values(missingRules).run();

    // —— 示例任务:仅任务表完全为空时(通用示例,不与用户任务混排)——
    if ((tx.select().from(tasks).all() as unknown[]).length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const p1 = projByName("工作台开发");
      tx.insert(tasks).values([
        { id: id(), title: "试用 EvoDesk:把一条任务走完分诊流程", tags: '["事务"]', complexity: "S", status: "inbox", createdAt: now(), updatedAt: now() },
        { id: id(), title: "阅读行业周报并摘要", tags: '["研究"]', complexity: "M", status: "inbox", projectId: p1, createdAt: now(), updatedAt: now() },
        { id: id(), title: "整理 Obsidian 笔记目录", tags: '["事务"]', complexity: "M", status: "ready", dueDate: today, projectId: p1, createdAt: now(), updatedAt: now() },
        { id: id(), title: "体检预约", tags: '["生活"]', complexity: "S", status: "ready", dueDate: yesterday, createdAt: now(), updatedAt: now() },
        { id: id(), title: "配置每日站会要点模板", tags: '["事务"]', complexity: "M", status: "done", projectId: p1, createdAt: now(), updatedAt: now() },
      ]).run();
    }

    // —— settings:固定主键,冲突忽略让种子收敛——已有键保留用户值,缺失键补齐。
    tx.insert(settings).values([
      { key: "theme", value: '"dark"' },
      { key: "cost_budget_usd", value: "10" },
      { key: "vault_path", value: '"D:\\\\work\\\\Obsidian\\\\Obsidian"' },
      { key: "known_tags", value: '["写作","研究","事务","开发","生活","学习","健身"]' },
      { key: "waiting_human_timeout_hours", value: "24" },
    ]).onConflictDoNothing().run();
  });

  // —— 幂等补齐(独立于首播种子,老库升级也能拿到)——
  const exRows = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
  if (!exRows.some((e) => e.name === "审查占位模型")) {
    db.insert(executors).values({
      id: id(), name: "审查占位模型", type: "llm", role: "reviewer", model: "YOUR_STRONG_MODEL",
      apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_STRONG_KEY",
      enabled: false, createdAt: now(),
    }).run();
  }
  const chatCount = (db.select().from(chats).all() as unknown[]).length;
  if (chatCount === 0) {
    const nowIso = now();
    db.insert(chats).values({ id: id(), title: "欢迎使用 EvoDesk 对话", createdAt: nowIso, updatedAt: nowIso }).run();
  }
  const qaCount = (db.select().from(quickActions).all() as unknown[]).length;
  if (qaCount === 0) {
    const n = now();
    db.insert(quickActions).values([
      { id: id(), name: "打开 Z.ai 控制台", type: "url", payload: "https://chat.z.ai", sort: 0, enabled: true, createdAt: n },
      { id: id(), name: "查看沙盒目录", type: "command", payload: "Get-ChildItem .", shell: "powershell", sort: 1, enabled: true, createdAt: n },
    ]).run();
  } else {
    // 迁移:早期示例把相对路径写成 data/sandbox,而执行器工作目录本就是沙盒,导致路径翻倍。
    const stale = db.select().from(quickActions).all() as (typeof quickActions.$inferSelect)[];
    for (const a of stale) {
      if (a.name === "查看沙盒目录" && a.payload === "Get-ChildItem data/sandbox") {
        db.update(quickActions).set({ payload: "Get-ChildItem ." }).where(eq(quickActions.id, a.id)).run();
      }
    }
  }

  seedCanvases(db);
  seedLinksAndGoals(db);
}

// —— 画布种子:默认画布(无任何非模板画布时播种一次)+ 3 套模板画布(按名补齐)——
const G = (groupTitle: string, types: string[]): { groupTitle: string; widgets: { id: string; type: string; config: Record<string, unknown> }[] } => ({
  groupTitle,
  widgets: types.map((type) => ({ id: newWidgetId(), type, config: type === "todo" ? { scope: "today" } : {} })),
});

function seedCanvases(db: Db): void {
  const rows = db.select().from(canvases).all() as (typeof canvases.$inferSelect)[];
  const tplNames = new Set(rows.filter((c) => c.isTemplate).map((c) => c.name));
  const missingTpl: (typeof canvases.$inferInsert)[] = [
    { name: "学生工作台", layout: [
        G("今日学习", ["counters", "todo"]),
        G("课程与笔记", ["calendar", "notes"]),
        G("网课与资料", ["links", "vault"]),
        G("学习进度", ["goals"]),
      ] },
    { name: "职场开发者工作台", layout: [
        G("工作焦点", ["counters", "todo", "calendar"]),
        G("项目与笔记", ["notes", "vault"]),
        G("开发工具", ["links"]),
        G("备忘与风险", ["quickactions", "radar"]),
      ] },
    { name: "生活个人工作台", layout: [
        G("今日计划", ["counters", "todo", "calendar"]),
        G("兴趣与清单", ["goals", "notes"]),
        G("常用网站", ["links"]),
      ] },
  ]
    .filter((t) => !tplNames.has(t.name))
    .map((t) => ({ ...t, layout: JSON.stringify(t.layout) as unknown as string, columns: "2", locked: false, isTemplate: true, shareToken: null, id: id(), createdAt: now(), updatedAt: now() }));
  if (missingTpl.length > 0) db.insert(canvases).values(missingTpl).run();

  const hasNormalCanvas = rows.some((c) => !c.isTemplate);
  if (!hasNormalCanvas) {
    const layout: CanvasLayout = [
      G("今日焦点", ["counters", "todo", "calendar"]),
      G("灵感与笔记", ["notes", "vault"]),
      G("链接与目标", ["links", "goals", "radar", "quickactions"]),
    ];
    db.insert(canvases).values({
      id: id(), name: "我的工作台", columns: "2", locked: false,
      layout: JSON.stringify(layout), isTemplate: false, shareToken: null, createdAt: now(), updatedAt: now(),
    }).run();
  }
}

// —— 链接/目标示例:仅空表时播种(与示例任务同一策略,不与用户数据混排)——
function seedLinksAndGoals(db: Db): void {
  if ((db.select().from(links).all() as unknown[]).length === 0) {
    const n = now();
    db.insert(links).values([
      { id: id(), title: "Z.ai 控制台", url: "https://chat.z.ai", category: "开发", sort: 0, createdAt: n },
      { id: id(), title: "GitHub", url: "https://github.com", category: "开发", sort: 1, createdAt: n },
      { id: id(), title: "掘金", url: "https://juejin.cn", category: "开发", sort: 2, createdAt: n },
      { id: id(), title: "MDN 文档", url: "https://developer.mozilla.org", category: "学习", sort: 0, createdAt: n },
    ]).run();
  }
  if ((db.select().from(goals).all() as unknown[]).length === 0) {
    const n = now();
    db.insert(goals).values([
      { id: id(), title: "今年读 12 本书", category: "reading", target: 12, current: 3, unit: "本", deadline: null, color: null, archived: false, createdAt: n, updatedAt: n },
      { id: id(), title: "全年健身 48 次", category: "fitness", target: 48, current: 18, unit: "次", deadline: null, color: null, archived: false, createdAt: n, updatedAt: n },
    ]).run();
  }
}
