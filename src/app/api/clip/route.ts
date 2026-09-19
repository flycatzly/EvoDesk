import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { executors, notes } from "@/lib/db/schema";
import { callLlmWithRetry, executorLlmConfig } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 抓取正文:剥 <script>/<style>/标签,压空白;失败抛错。仅文本优先,~50KB 截断。 */
export function extractReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50_000);
}

function pickExecutor(db: ReturnType<typeof getDb>) {
  const list = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.enabled && e.type === "llm");
  const usable = list.filter((e) => !/^YOUR_/.test(e.model ?? ""));
  const pool = usable.length > 0 ? usable : list;
  return pool.find((e) => e.role === "executor") ?? pool.find((e) => e.role === "planner") ?? pool[0] ?? null;
}

// 网页 AI 摘要收藏(POST {url}):抓正文 → AI 摘要+标签 → 存为笔记(标题带来源)。
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const url = body && typeof body.url === "string" ? body.url.trim() : "";
  if (!/^https?:\/\/\S+/.test(url)) return NextResponse.json({ error: "url 须为 http(s) 链接" }, { status: 400 });

  // 1) 抓取(仅本地个人工具;10s 超时;UA 伪装减少反爬拦截)
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EvoDesk/1.0", accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) return NextResponse.json({ error: `抓取失败:HTTP ${res.status}` }, { status: 502 });
    html = await res.text();
  } catch (e) {
    return NextResponse.json({ error: `抓取失败:${e instanceof Error ? e.message.slice(0, 80) : "网络异常"}` }, { status: 502 });
  }
  const text = extractReadableText(html);
  if (text.length < 50) return NextResponse.json({ error: "页面无可提取正文(可能需要登录或是纯脚本渲染)" }, { status: 422 });

  // 2) AI 摘要
  const db = getDb();
  const ex = pickExecutor(db);
  if (!ex) return NextResponse.json({ error: "未配置可用 AI 执行器(仍可直接收藏原文链接)" }, { status: 400 });
  let summary: string;
  let tags: string[] = [];
  try {
    const cfg = executorLlmConfig(ex);
    const r = await callLlmWithRetry(cfg, [{
      role: "user",
      content: [
        "根据下面的网页正文,输出一行 JSON:{\"summary\":\"150字内的中文摘要,说清这篇文章讲了什么、核心结论是什么\",\"tags\":[\"2-4个中文标签\"]},只输出 JSON。",
        `来源:${url}`,
        text.slice(0, 12_000),
      ].join("\n"),
    }]);
    const m = /\{[\s\S]*\}/.exec(r.text);
    const parsed = m ? (JSON.parse(m[0]) as { summary?: unknown; tags?: unknown }) : null;
    summary = typeof parsed?.summary === "string" ? parsed.summary : r.text.slice(0, 200);
    tags = Array.isArray(parsed?.tags) ? parsed!.tags.filter((t): t is string => typeof t === "string").slice(0, 4) : [];
  } catch (e) {
    return NextResponse.json({ error: `AI 摘要失败:${e instanceof Error ? e.message.slice(0, 80) : ""}` }, { status: 502 });
  }

  // 3) 存为笔记(title = <title> 标签或 URL;body = 摘要 + 原文链接)
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(html);
  const pageTitle = (titleMatch?.[1] ?? url).trim().slice(0, 100) || url;
  const nowIso = new Date().toISOString();
  const noteBody = `${summary}\n\n🔗 来源:${url}\n🏷️ 标签:${tags.join(" / ") || "未分类"}`;
  const id = crypto.randomUUID();
  db.insert(notes).values({
    id, title: pageTitle, body: noteBody, tags: JSON.stringify(tags),
    pinned: false, source: "manual", createdAt: nowIso, updatedAt: nowIso,
  }).run();
  return NextResponse.json({ ok: true, id, title: pageTitle, summary, tags });
}
