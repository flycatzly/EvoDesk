import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { executors } from "@/lib/db/schema";
import { resolveVaultRoot, indexLibrary, readNoteFile } from "@/lib/domain/vault";
import { callLlmWithRetry, executorLlmConfig } from "@/lib/llm/client";
import {
  findSimilarGroups, sanitizePlan, applyCategories, readDoc, writeDocWithBackup,
  archiveFiles, importToVault, type AiPlan,
} from "@/lib/domain/library-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_MERGE_PER_APPLY = 10;
const MAX_ENRICH_PER_APPLY = 10;

function pickExecutor(db: DbT, executorId?: string) {
  const list = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.enabled && e.type === "llm");
  // 优先真实配置的模型(跳过 YOUR_* 种子占位符),其次角色匹配,最后才用任意启用的
  const usable = list.filter((e) => !/^YOUR_/.test(e.model ?? ""));
  const pool = usable.length > 0 ? usable : list;
  return (executorId ? pool.find((e) => e.id === executorId) : undefined) ?? pool.find((e) => e.role === "executor") ?? pool.find((e) => e.role === "planner") ?? pool[0] ?? null;
}

type DbT = ReturnType<typeof getDb>;

async function callJsonPlan(db: DbT, executorId: string | undefined, prompt: string): Promise<AiPlan> {
  const ex = pickExecutor(db, executorId);
  if (!ex) throw new Error("未配置可用 AI 执行器:请到「执行器」页导入并启用");
  const cfg = executorLlmConfig(ex);
  const r = await callLlmWithRetry(cfg, [{ role: "user", content: prompt }]);
  const m = /\{[\s\S]*\}/.exec(r.text);
  if (!m) throw new Error("AI 未返回结构化计划,请换个指令重试");
  return JSON.parse(m[0]) as AiPlan;
}

// POST /api/vault/ai-organize
//   {action:"plan",   root, instruction?}                    → 相似分组(离线) + AI 分类/合并/完善计划
//   {action:"apply",  root, plan}                          → 分类移动 + 合并重生成(有界)+ 完善重写(带备份)
//   {action:"import", root, paths[], folder?}             → 复制到 Obsidian 主库子目录
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const action = body && typeof body.action === "string" ? body.action : "";
  const db = getDb();
  const root = resolveVaultRoot(db, body && typeof body.root === "string" ? body.root : null);
  if (!root) return NextResponse.json({ error: "无可用资料库" }, { status: 400 });

  if (action === "plan") {
    const index = indexLibrary(root, { maxEntries: 500, maxDepth: 6 });
    const docs = index.entries.filter((e) => e.isText);
    // 离线相似分组(内容哈希 + 标题/Jaccard)
    const withContent = docs.map((d) => ({ relPath: d.relPath, name: d.name, content: readNoteFile(root, d.relPath).slice(0, 16384) }));
    const similar = findSimilarGroups(withContent);
    // AI 计划(自然语言指令)
    const instruction = typeof body?.instruction === "string" ? body.instruction.slice(0, 500) : "";
    // 编号短名清单:F1..Fn(basename),AI 输出编号引用,提示词与输出都大幅缩小
    const numbered = docs.slice(0, 250);
    const fileList = numbered.map((d, i) => `F${i + 1}: ${d.name}`).join("\n");
    const prompt = [
      "你是资料库整理助手。下面是 markdown 资料库的编号文件清单(短名)。用户指令:",
      `「${instruction || "智能分类:按内容主题划分成不同的中文分类;找出内容相同或明显重复应合并的文章"}」`,
      "",
      "文件清单:",
      fileList,
      "",
      '请只输出 JSON(不要多余文本):{"categories":[{"name":"中文分类名","files":["F3","F17"...]}],"merges":[{"target":"合并后的文件名.md","sources":["F2","F9"...]}],"enrich":["F12"...]}',
      "规则:files/sources/enrich 只能引用清单编号(F数字);categories 尽量覆盖全部文件且互不重叠;分类名长期可用(如 接口文档/AI 工具/部署运维);merges 只收内容相同或明显重复的(≤8 篇/组);enrich 选明显不完整可补充的;不确定就少给,不要编造编号。",
    ].join("\n");
    let plan: AiPlan = { categories: [], merges: [], enrich: [] };
    let aiError: string | undefined;
    try {
      const raw = await callJsonPlan(db, typeof body?.executor_id === "string" ? body.executor_id : undefined, prompt);
      // F 编号 → 相对路径
      const numToPath = new Map(numbered.map((d, i) => [`F${i + 1}`, d.relPath]));
      const translate = (refs: string[]) => refs.map((r) => numToPath.get(r)).filter((x): x is string => !!x);
      plan = sanitizePlan(
        { categories: raw.categories.map((c) => ({ name: c.name, files: translate(c.files) })), merges: raw.merges.map((m) => ({ target: m.target, sources: translate(m.sources) })), enrich: translate(raw.enrich) },
        new Set(docs.map((d) => d.relPath))
      );
    } catch (e) {
      aiError = e instanceof Error ? e.message : "AI 计划失败";
    }
    return NextResponse.json({
      root,
      total: docs.length,
      similar,
      plan,
      aiError,
      note: "计划仅是提案;应用时分类会移动文件、合并会重生成并归档原件(_已合并)、完善会备份原件(_原始备份)。",
    });
  }

  if (action === "apply") {
    const planRaw = body?.plan;
    if (!planRaw || typeof planRaw !== "object") return NextResponse.json({ error: "plan 必填" }, { status: 400 });
    const index = indexLibrary(root, { maxEntries: 500, maxDepth: 6 });
    const known = new Set(index.entries.map((e) => e.relPath));
    const plan = sanitizePlan(planRaw, known);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const ex = pickExecutor(db, typeof body?.executor_id === "string" ? body.executor_id : undefined);
    const mergeResults: { target: string; ok: boolean; note: string }[] = [];
    // 执行顺序:合并(归档原件)→ 完善(覆盖前备份)→ 分类移动(最后,把生成物也归位)。
    // 计划里的路径都是移动前的;先移动会让后续步骤找不到文件。
    const merges = plan.merges.slice(0, MAX_MERGE_PER_APPLY);
    for (const m of merges) {
      try {
        if (!ex) throw new Error("无可用 AI 执行器");
        const ex2 = ex;
        const cfg = executorLlmConfig(ex2);
        const parts = m.sources.map((s) => `【来源:${s}】\n${readDoc(root, s) ?? "(读取失败)"}`).join("\n\n---\n\n");
        const r = await callLlmWithRetry(cfg, [{
          role: "user",
          content: `把下面 ${m.sources.length} 篇同类文档合并重生成一篇完整、结构化、去重的 markdown 文档《${m.target.replace(/\.md$/, "")}》。保留所有有效信息,消除重复,补充缺失的小节,输出完整文档正文(markdown),不要输出解释。\n\n${parts.slice(0, 12000)}`,
        }]);
        writeDocWithBackup(root, m.target, r.text, stamp);
        archiveFiles(root, m.sources, stamp);
        mergeResults.push({ target: m.target, ok: true, note: `已生成并归档 ${m.sources.length} 篇原件` });
      } catch (e) {
        mergeResults.push({ target: m.target, ok: false, note: e instanceof Error ? e.message : "合并失败" });
      }
    }
    const enrichResults: { file: string; ok: boolean; note: string; after?: string; before?: string }[] = [];
    for (const f of plan.enrich.slice(0, MAX_ENRICH_PER_APPLY)) {
      try {
        if (!ex) throw new Error("无可用 AI 执行器");
        const ex2 = ex;
        const cfg = executorLlmConfig(ex2);
        const content = readDoc(root, f);
        if (content === null) { enrichResults.push({ file: f, ok: false, note: "读取失败" }); continue; }
        const r = await callLlmWithRetry(cfg, [{
          role: "user",
          content: `完善下面这篇文档:保留全部原有有效信息,修正结构、补充缺失小节与说明,输出完整 markdown 正文,不要输出解释。\n\n${content.slice(0, 12000)}`,
        }]);
        writeDocWithBackup(root, f, r.text, stamp);
        enrichResults.push({ file: f, ok: true, note: "已完善(原件已备份)" });
      } catch (e) {
        enrichResults.push({ file: f, ok: false, note: e instanceof Error ? e.message : "完善失败" });
      }
    }
    const catResult = applyCategories(root, plan.categories);
    return NextResponse.json({
      ok: true,
      categories: catResult,
      merges: mergeResults,
      enrich: enrichResults,
      backupDir: `_原始备份/${stamp}`,
    });
  }

  if (action === "apply_enrich") {
    // 确认制的最后一步:写入用户已确认的推荐稿(写前备份原件)
    if (!body) return NextResponse.json({ error: "需要请求体" }, { status: 400 });
    const root2 = resolveVaultRoot(db, typeof body.root === "string" ? body.root : null);
    if (!root2) return NextResponse.json({ error: "无可用资料库" }, { status: 400 });
    const rel = typeof body.path === "string" ? body.path : "";
    const content = typeof body.content === "string" ? body.content : null;
    if (content === null) return NextResponse.json({ error: "content 必填" }, { status: 400 });
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const { writeDocWithBackup } = await import("@/lib/domain/library-ai");
      writeDocWithBackup(root2, rel, content, stamp);
      return NextResponse.json({ ok: true, backup: `_原始备份/${stamp}` });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "写入失败" }, { status: 500 });
    }
  }

  if (action === "import") {
    if (!body) return NextResponse.json({ error: "需要请求体" }, { status: 400 });
    return importHandler(db, body);
  }

  return NextResponse.json({ error: "未知 action(plan|apply|import)" }, { status: 400 });
}

async function importHandler(db: DbT, body: Record<string, unknown>) {
  const { getVaultRoot } = await import("@/lib/domain/vault");
  const vaultRoot = getVaultRoot(db);
  if (!vaultRoot) return NextResponse.json({ error: "未配置 Obsidian vault 路径(设置页)" }, { status: 400 });
  const root = resolveVaultRoot(db, typeof body.root === "string" ? body.root : null);
  if (!root) return NextResponse.json({ error: "无可用资料库" }, { status: 400 });
  const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];
  if (paths.length === 0) return NextResponse.json({ error: "paths 必填(要导入的文件)" }, { status: 400 });
  const folder = typeof body.folder === "string" ? body.folder : "Apifox导入";
  const result = importToVault(vaultRoot, root, paths.slice(0, 500), folder);
  return NextResponse.json({ ok: true, ...result });
}
