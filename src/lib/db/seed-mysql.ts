// MySQL 数据源的种子:与 seed.ts(SQLite)同名同义同名单。
// 两处文件需保持数据同步:改任何一侧的种子内容,必须同步另一侧。
// 策略与 SQLite 一致:按"名单缺失则补"幂等收敛,绝不覆盖用户已有数据;
// 任何一条种子失败只警告不阻断(空库仍可正常使用,下次启动重试)。
import type { MysqlDb } from "./mysql";
import * as t from "./schema-mysql";
import { newWidgetId, type CanvasLayout, type WidgetType } from "@/lib/domain/canvas";

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

const G = (groupTitle: string, types: WidgetType[]) => ({
  groupTitle,
  widgets: types.map((type) => ({ id: newWidgetId(), type, config: type === "todo" ? { scope: "today" } : {} })),
});

export async function seedMysqlIfEmpty(db: MysqlDb): Promise<void> {
  try {
    // —— 流程模板 ——
    const tplNames = new Set(((await db.select().from(t.flowTemplates)) as { name: string }[]).map((x) => x.name));
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
    ].filter((x) => !tplNames.has(x.name));
    if (missingTpls.length > 0) await db.insert(t.flowTemplates).values(missingTpls);

    // —— 执行器 ——
    const exNames = new Set(((await db.select().from(t.executors)) as { name: string }[]).map((x) => x.name));
    const missingEx = [
      { id: id(), name: "人工", type: "manual", role: "executor", enabled: true, createdAt: now() },
      { id: id(), name: "快速模型", type: "llm", role: "triage", model: "YOUR_FAST_MODEL", apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_FAST_KEY", enabled: false, createdAt: now() },
      { id: id(), name: "强模型", type: "llm", role: "planner", model: "YOUR_STRONG_MODEL", apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_STRONG_KEY", enabled: false, createdAt: now() },
      { id: id(), name: "PowerShell 本地执行", type: "script", role: "executor", shell: "powershell", workingDir: "data/sandbox", timeoutMs: 60000, autoApprove: false, enabled: true, createdAt: now() },
      { id: id(), name: "审查占位模型", type: "llm", role: "reviewer", model: "YOUR_STRONG_MODEL", apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_STRONG_KEY", enabled: false, createdAt: now() },
    ].filter((x) => !exNames.has(x.name));
    if (missingEx.length > 0) await db.insert(t.executors).values(missingEx);

    // —— 项目 ——
    const projRows = (await db.select().from(t.projects)) as (typeof t.projects.$inferSelect)[];
    const projNames = new Set(projRows.map((x) => x.name));
    const projSeeds = [
      { id: id(), name: "工作台开发", color: "#6366f1", createdAt: now() },
      { id: id(), name: "个人成长", color: "#8b5cf6", createdAt: now() },
    ].filter((x) => !projNames.has(x.name));
    if (projSeeds.length > 0) await db.insert(t.projects).values(projSeeds);
    const projByName = (name: string) =>
      projSeeds.find((x) => x.name === name)?.id ?? projRows.find((x) => x.name === name)?.id ?? null;

    // —— 周期规则 ——
    const ruleTitles = new Set(((await db.select().from(t.recurringRules)) as { title: string }[]).map((x) => x.title));
    const missingRules = [
      { id: id(), title: "英语学习 30 分钟", tags: '["学习"]', complexity: "S", priority: 1, projectId: projByName("个人成长"), freq: "daily", enabled: true, nextRunAt: tomorrow(), createdAt: now() },
      { id: id(), title: "健身 45 分钟", tags: '["健身"]', complexity: "S", priority: 1, projectId: projByName("个人成长"), freq: "weekly", weekday: 1, enabled: true, nextRunAt: tomorrow(), createdAt: now() },
    ].filter((x) => !ruleTitles.has(x.title));
    if (missingRules.length > 0) await db.insert(t.recurringRules).values(missingRules);

    // —— 示例任务:仅任务表完全为空时 ——
    if (((await db.select().from(t.tasks)) as unknown[]).length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const p1 = projByName("工作台开发");
      await db.insert(t.tasks).values([
        { id: id(), title: "试用 EvoDesk:把一条任务走完分诊流程", tags: '["事务"]', complexity: "S", status: "inbox", createdAt: now(), updatedAt: now() },
        { id: id(), title: "阅读行业周报并摘要", tags: '["研究"]', complexity: "M", status: "inbox", projectId: p1, createdAt: now(), updatedAt: now() },
        { id: id(), title: "整理 Obsidian 笔记目录", tags: '["事务"]', complexity: "M", status: "ready", dueDate: today, projectId: p1, createdAt: now(), updatedAt: now() },
        { id: id(), title: "体检预约", tags: '["生活"]', complexity: "S", status: "ready", dueDate: yesterday, createdAt: now(), updatedAt: now() },
        { id: id(), title: "配置每日站会要点模板", tags: '["事务"]', complexity: "M", status: "done", projectId: p1, createdAt: now(), updatedAt: now() },
      ]);
    }

    // —— settings:先查已有键,缺失键补齐(保留用户值)——
    const settingKeys = new Set(((await db.select().from(t.settings)) as { key: string }[]).map((x) => x.key));
    const missingSettings = [
      { key: "theme", value: '"dark"' },
      { key: "cost_budget_usd", value: "10" },
      { key: "vault_path", value: '"D:\\\\work\\\\Obsidian\\\\Obsidian"' },
      { key: "known_tags", value: '["写作","研究","事务","开发","生活","学习","健身"]' },
      { key: "waiting_human_timeout_hours", value: "24" },
    ].filter((x) => !settingKeys.has(x.key));
    if (missingSettings.length > 0) await db.insert(t.settings).values(missingSettings);

    // —— 默认对话 ——
    if (((await db.select().from(t.chats)) as unknown[]).length === 0) {
      const n = now();
      await db.insert(t.chats).values({ id: id(), title: "欢迎使用 EvoDesk 对话", createdAt: n, updatedAt: n });
    }

    // —— 快捷操作 ——
    if (((await db.select().from(t.quickActions)) as unknown[]).length === 0) {
      const n = now();
      await db.insert(t.quickActions).values([
        { id: id(), name: "打开 Z.ai 控制台", type: "url", payload: "https://chat.z.ai", sort: 0, enabled: true, createdAt: n },
        { id: id(), name: "查看沙盒目录", type: "command", payload: "Get-ChildItem .", shell: "powershell", sort: 1, enabled: true, createdAt: n },
      ]);
    }

    // —— 画布:3 套模板画布(按名补齐)+ 默认画布(无非模板画布时一次)——
    const canvasRows = (await db.select().from(t.canvases)) as (typeof t.canvases.$inferSelect)[];
    const tplCanvasNames = new Set(canvasRows.filter((c) => c.isTemplate).map((c) => c.name));
    const missingTplCanvas = [
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
      .filter((x) => !tplCanvasNames.has(x.name))
      .map((x) => ({ ...x, layout: JSON.stringify(x.layout) as unknown as string, columns: "2", locked: false, isTemplate: true, shareToken: null, id: id(), createdAt: now(), updatedAt: now() }));
    if (missingTplCanvas.length > 0) await db.insert(t.canvases).values(missingTplCanvas);
    if (!canvasRows.some((c) => !c.isTemplate)) {
      const layout: CanvasLayout = [
        G("今日焦点", ["counters", "todo", "calendar"]),
        G("灵感与笔记", ["notes", "vault"]),
        G("链接与目标", ["links", "goals", "radar", "quickactions"]),
      ];
      await db.insert(t.canvases).values({
        id: id(), name: "我的工作台", columns: "2", locked: false,
        layout: JSON.stringify(layout), isTemplate: false, shareToken: null, createdAt: now(), updatedAt: now(),
      });
    }

    // —— 链接/目标示例:仅空表时 ——
    if (((await db.select().from(t.links)) as unknown[]).length === 0) {
      const n = now();
      await db.insert(t.links).values([
        { id: id(), title: "Z.ai 控制台", url: "https://chat.z.ai", category: "开发", sort: 0, createdAt: n },
        { id: id(), title: "GitHub", url: "https://github.com", category: "开发", sort: 1, createdAt: n },
        { id: id(), title: "掘金", url: "https://juejin.cn", category: "开发", sort: 2, createdAt: n },
        { id: id(), title: "MDN 文档", url: "https://developer.mozilla.org", category: "学习", sort: 0, createdAt: n },
      ]);
    }
    if (((await db.select().from(t.goals)) as unknown[]).length === 0) {
      const n = now();
      await db.insert(t.goals).values([
        { id: id(), title: "今年读 12 本书", category: "reading", target: 12, current: 3, unit: "本", deadline: null, color: null, archived: false, createdAt: n, updatedAt: n },
        { id: id(), title: "全年健身 48 次", category: "fitness", target: 48, current: 18, unit: "次", deadline: null, color: null, archived: false, createdAt: n, updatedAt: n },
      ]);
    }
  } catch (err) {
    console.warn("[db] MySQL 种子数据写入失败,跳过(下次连接重试):", err);
  }
}
