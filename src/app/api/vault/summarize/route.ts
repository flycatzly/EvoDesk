import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { settings, executors } from "@/lib/db/schema";
import { resolveVaultRoot, resolveVaultPath, readNoteFile } from "@/lib/domain/vault";
import type { Db } from "@/lib/db/test-util";
import { callLlmWithRetry, executorLlmConfig, type LlmMessage } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type VaultMeta = Record<string, { summary: string; tags: string[]; at: string }>;

const readMeta = (db: Db): VaultMeta => {
  const row = db.select().from(settings).where(eq(settings.key, "vault_meta")).all()[0];
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as VaultMeta) : {};
  } catch {
    return {};
  }
};

// AI 内容补充(POST {root, path, executor_id?}):读取文本 → LLM 生成摘要与标签 → 存 settings.vault_meta
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const db = await getAnyDb();
  const root = resolveVaultRoot(db, body && typeof body.root === "string" ? body.root : null);
  if (!root) return NextResponse.json({ error: "无可用资料库" }, { status: 400 });
  const rel = body && typeof body.path === "string" ? body.path : "";
  let text: string;
  try {
    text = readNoteFile(root, rel).slice(0, 16_000);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "文件读取失败" }, { status: 400 });
  }
  const enabledLlm = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.enabled && e.type === "llm");
  const requested = body && typeof body.executor_id === "string" ? enabledLlm.find((e) => e.id === body!.executor_id) : undefined;
  const ex = requested ?? enabledLlm.find((e) => e.role === "executor") ?? enabledLlm[0];
  if (!ex) return NextResponse.json({ error: "未配置 AI 执行器:请到「执行器」页配置" }, { status: 400 });
  let cfg;
  try {
    cfg = executorLlmConfig(ex);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "执行器配置无效" }, { status: 400 });
  }
  const messages: LlmMessage[] = [
    { role: "system", content: "你是资料库助手:为给定文档输出一行 JSON:{\"summary\":\"50字内中文摘要\",\"tags\":[\"标签1\",\"标签2\",\"标签3\"]},只输出 JSON。" },
    { role: "user", content: text },
  ];
  try {
    const result = await callLlmWithRetry(cfg, messages);
    const m = /\{[\s\S]*\}/.exec(result.text);
    const parsed = m ? (JSON.parse(m[0]) as { summary?: unknown; tags?: unknown }) : null;
    const summary = typeof parsed?.summary === "string" ? parsed.summary : result.text.slice(0, 120);
    const tags = Array.isArray(parsed?.tags) ? parsed!.tags.filter((t): t is string => typeof t === "string").slice(0, 5) : [];
    const absPath = resolveVaultPath(root, rel);
    const meta = readMeta(db);
    meta[absPath] = { summary, tags, at: new Date().toISOString() };
    const ups = db.update(settings).set({ value: JSON.stringify(meta) }).where(eq(settings.key, "vault_meta")).run();
    if (ups.changes === 0) db.insert(settings).values({ key: "vault_meta", value: JSON.stringify(meta) }).run();
    return NextResponse.json({ ok: true, meta: meta[absPath] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `AI 调用失败:${e.message}` : "AI 调用失败" }, { status: 502 });
  }
}

// 元数据读取(GET):全部 vault_meta
export async function GET() {
  return NextResponse.json({ meta: readMeta(await getAnyDb()) });
}
