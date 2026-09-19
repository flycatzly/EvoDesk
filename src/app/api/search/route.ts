import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tasks, notes, links, canvases, flowTemplates } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export type SearchHit = { type: string; id: string; title: string; sub: string; href: string };

// ⌘K 命令面板搜索聚合:任务/笔记/链接/工作台/模板 + 内置页面与动作。
// 本地单用户,LIKE 足够;各表 LIMIT 防大库拖慢。
export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  const db = getDb();
  const hits: SearchHit[] = [];
  const match = (...fields: (string | null | undefined)[]) => !q || fields.some((f) => f && f.toLowerCase().includes(q));

  if (q) {
    for (const t of db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]) {
      if (match(t.title, t.description) && hits.length < 8) hits.push({ type: "任务", id: t.id, title: t.title, sub: t.status, href: `/tasks/${t.id}` });
    }
    for (const n of db.select().from(notes).all() as (typeof notes.$inferSelect)[]) {
      if (match(n.title, n.body) && hits.length < 14) hits.push({ type: "笔记", id: n.id, title: n.title, sub: "内容灵感", href: `/notes` });
    }
    for (const l of db.select().from(links).all() as (typeof links.$inferSelect)[]) {
      if (match(l.title, l.url, l.category) && hits.length < 20) hits.push({ type: "链接", id: l.id, title: l.title, sub: l.category, href: `/links` });
    }
    for (const c of db.select().from(canvases).all() as (typeof canvases.$inferSelect)[]) {
      if (!c.isTemplate && match(c.name) && hits.length < 24) hits.push({ type: "工作台", id: c.id, title: c.name, sub: "画布", href: `/?c=${c.id}` });
    }
    for (const t of db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]) {
      if (t.status === "active" && match(t.name, t.description) && hits.length < 27) hits.push({ type: "流程", id: t.id, title: t.name, sub: `模板 · ${t.complexity}`, href: `/flows` });
    }
  }

  // 页面与动作(始终提供,q 过滤)
  const pages: SearchHit[] = [
    { type: "页面", id: "p-home", title: "工作台", sub: "画布首页", href: "/" },
    { type: "页面", id: "p-inbox", title: "收件箱", sub: "快速录入与分诊", href: "/inbox" },
    { type: "页面", id: "p-tasks", title: "任务看板", sub: "", href: "/tasks" },
    { type: "页面", id: "p-calendar", title: "日历", sub: "", href: "/calendar" },
    { type: "页面", id: "p-links", title: "常用链接", sub: "", href: "/links" },
    { type: "页面", id: "p-goals", title: "目标进度", sub: "", href: "/goals" },
    { type: "页面", id: "p-stats", title: "本周复盘", sub: "", href: "/stats" },
    { type: "页面", id: "p-chat", title: "AI 对话台", sub: "", href: "/chat" },
    { type: "页面", id: "p-vault", title: "知识库", sub: "", href: "/vault" },
    { type: "页面", id: "p-jobs", title: "求职雷达", sub: "", href: "/jobs" },
    { type: "页面", id: "p-self-heal", title: "自我进化", sub: "自愈中心", href: "/self-heal" },
    { type: "页面", id: "p-skills", title: "技能地图", sub: "", href: "/skills" },
    { type: "页面", id: "p-settings", title: "设置", sub: "", href: "/settings" },
  ].filter((p) => !q || p.title.toLowerCase().includes(q));

  return NextResponse.json({ hits: [...hits, ...pages].slice(0, 20) });
}
