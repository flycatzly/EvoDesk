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

/** 抓取页面:直连(重试 2 次)失败后走 r.jina.ai 阅读代理兜底(应对 GitHub 等被网络重置的站点)。
 *  返回正文文本与可选标题;全部失败抛错(消息含最后一次原因)。 */
async function fetchPageText(url: string): Promise<{ text: string; title: string }> {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EvoDesk/1.0";
  const attempts: { run: () => Promise<{ text: string; title: string }>; label: string }[] = [
    {
      label: "直连",
      run: async () => {
        const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        return { text: extractReadableText(html), title: (/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim() };
      },
    },
    {
      label: "直连重试",
      run: async () => {
        const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        return { text: extractReadableText(html), title: (/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim() };
      },
    },
    {
      label: "阅读代理",
      run: async () => {
        const res = await fetch(`https://r.jina.ai/${url}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`代理 HTTP ${res.status}`);
        const md = await res.text();
        // jina 输出首行常为 "Title: xxx"
        const title = (/^Title:\s*(.+)$/m.exec(md)?.[1] ?? "").trim();
        return { text: md, title };
      },
    },
  ];
  let lastErr = "";
  for (const att of attempts) {
    try {
      const r = await att.run();
      if (r.text.length >= 50) return r;
      lastErr = "页面无可提取正文";
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 80) : "网络异常";
    }
  }
  throw new Error(lastErr || "网络异常");
}

// 网页 AI 摘要收藏(POST {url}):抓正文 → AI 摘要+标签 → 存为笔记(标题带来源)。
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const url = body && typeof body.url === "string" ? body.url.trim() : "";
  if (!/^https?:\/\/\S+/.test(url)) return NextResponse.json({ error: "url 须为 http(s) 链接" }, { status: 400 });

  // 1) 抓取(多级兜底)
  let text: string;
  let pageTitle = "";
  try {
    const page = await fetchPageText(url);
    text = page.text;
    pageTitle = page.title;
  } catch (e) {
    return NextResponse.json({ error: `抓取失败:${e instanceof Error ? e.message.slice(0, 80) : "网络异常"}` }, { status: 502 });
  }

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
  const nowIso = new Date().toISOString();
  const pageTitleFinal = (pageTitle || url).trim().slice(0, 100) || url;
  const noteBody = `${summary}\n\n🔗 来源:${url}\n🏷️ 标签:${tags.join(" / ") || "未分类"}`;
  const id = crypto.randomUUID();
  db.insert(notes).values({
    id, title: pageTitleFinal, body: noteBody, tags: JSON.stringify(tags),
    pinned: false, source: "manual", createdAt: nowIso, updatedAt: nowIso,
  }).run();
  return NextResponse.json({ ok: true, id, title: pageTitleFinal, summary, tags });
}
