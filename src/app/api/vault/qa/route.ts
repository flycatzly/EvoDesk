import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import { executors } from "@/lib/db/schema";
import { resolveVaultRoot, readNoteFile, writeNoteFile, getVaultRoot } from "@/lib/domain/vault";
import { callLlmWithRetry, executorLlmConfig } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vault QA:对资料库提问 → 关键词检索 top 相关 md → AI 基于检索内容回答(带引用路径)。
// 检索式 RAG(关键词命中计数),不上向量库——本地个人库规模下够用且零依赖。
function pickExecutor(db: ReturnType<typeof getDb>) {
  const list = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.enabled && e.type === "llm");
  const usable = list.filter((e) => !/^YOUR_/.test(e.model ?? ""));
  const pool = usable.length > 0 ? usable : list;
  return pool.find((e) => e.role === "executor") ?? pool.find((e) => e.role === "planner") ?? pool[0] ?? null;
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const db = getDb();
  const rootParam = body && typeof body.root === "string" ? body.root : null;
  // 检索源两级白名单:资料库根(vault_roots)优先;宝典源目录(guide_dirs)其次(问宝典复用本管道)。
  let root = resolveVaultRoot(db, rootParam);
  let sourceKind: "vault" | "guide" = "vault";
  if (!root && rootParam) {
    const { resolveGuideDir } = await import("@/lib/domain/guide");
    const hit = resolveGuideDir(db, rootParam);
    if (hit) { root = hit; sourceKind = "guide"; }
  }
  if (!root) return NextResponse.json({ error: "无可用资料库" }, { status: 400 });
  const question = body && typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length < 2) return NextResponse.json({ error: "question 必填" }, { status: 400 });

  const ex = pickExecutor(db);
  if (!ex) return NextResponse.json({ error: "未配置可用 AI 执行器" }, { status: 400 });

  // 检索:问题分词(粗粒度按空格+2字滑窗),每篇 md 计命中数,top 6
  const { indexLibrary } = await import("@/lib/domain/vault");
  const index = indexLibrary(root, { maxEntries: 500, maxDepth: 6 });
  const terms = question.toLowerCase().replace(/[,,。??! !]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
  const grams = new Set(terms);
  for (const t of terms) for (let i = 0; i + 2 <= t.length; i++) grams.add(t.slice(i, i + 2));
  const scored: { relPath: string; score: number; text: string }[] = [];
  for (const e of index.entries.filter((x) => x.isText)) {
    let text = "";
    try { text = readNoteFile(root, e.relPath); } catch { continue; }
    // frontmatter(title/tags 等)与文件名一并参与命中——很多信息只在属性里
    const nameHit = `${e.name} ${text.slice(0, 500)}`.toLowerCase();
    const low = text.toLowerCase();
    let score = 0;
    for (const g of grams) {
      let idx = low.indexOf(g);
      let count = 0;
      while (idx !== -1 && count < 20) { count++; idx = low.indexOf(g, idx + g.length); }
      score += count * 2;
      // 标题/文件名/frontmatter 头部命中权重更高
      if (nameHit.includes(g)) score += 5;
    }
    if (score > 0) scored.push({ relPath: e.relPath, score, text });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 6);
  if (top.length === 0) {
    return NextResponse.json({ answer: "资料库里没有找到与问题相关的内容。换个说法,或先把相关文档导入资料库。", refs: [] });
  }

  const context = top.map((t, i) => `【片段${i + 1} · ${t.relPath}】\n${t.text.slice(0, 4000)}`).join("\n\n---\n\n");
  try {
    const cfg = executorLlmConfig(ex!);
    const r = await callLlmWithRetry(cfg, [{
      role: "user",
      content: [
        "你是知识库问答助手。仅根据下面的资料片段回答问题;若片段不足以回答,明确说\"资料中没有相关信息\"。",
        "回答末尾用「引用:」列出用到的片段编号(如 引用:片段1、片段3)。",
        `问题:${question}`,
        context.slice(0, 20_000),
      ].join("\n"),
    }]);

    // 记录到知识库:save=true(问宝典)时把问答写入主库「宝典问答」目录(尽力而为,失败不拦截答案)
    let saved: string | null = null;
    if (body?.save === true) {
      try {
        const vaultRoot = getVaultRoot(db);
        if (vaultRoot) {
          const now = new Date();
          const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
          const safeTitle = question.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30) || "问答";
          const relDir = sourceKind === "guide" ? "宝典问答" : "知识库问答";
          const refsList = top.map((t) => `- ${t.relPath}`).join("\n");
          const content = `---\ntitle: ${safeTitle}\nsource: ${sourceKind}-qa\ndate: ${now.toISOString()}\n---\n\n# Q:${question}\n\n${r.text}\n\n## 引用来源\n\n${refsList}\n`;
          let rel = `${relDir}/${stamp}_${safeTitle}.md`;
          let i = 1;
          while (true) {
            try { readNoteFile(vaultRoot, rel); rel = `${relDir}/${stamp}_${safeTitle}(${i++}).md`; } catch { break; }
          }
          writeNoteFile(vaultRoot, rel, content);
          saved = rel;
        }
      } catch { /* 保存失败不影响答案 */ }
    }

    return NextResponse.json({ answer: r.text, refs: top.map((t) => t.relPath), saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `AI 调用失败:${e.message.slice(0, 100)}` : "AI 调用失败" }, { status: 502 });
  }
}
