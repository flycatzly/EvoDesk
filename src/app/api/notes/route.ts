import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { q } from "@/lib/db/q";
import { notes } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES = ["manual", "chat", "task", "news_digest"] as const;

// tags 契约沿用 tasks POST(数组 → JSON、截断 5 个)并补元素过滤:非字符串元素一律丢弃
const normalizeTags = (v: unknown): string =>
  JSON.stringify(Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").slice(0, 5) : []);

export async function GET(_req: NextRequest) {
  const db = await getAnyDb();
  type NoteRow = typeof notes.$inferSelect;
  const rows = await q.all<NoteRow>(db.select().from(notes));
  // pinned 置顶 → updatedAt desc(UTC-ISO 字典序)
  const sorted = [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return NextResponse.json({ notes: sorted });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title 必填" }, { status: 400 });
  }
  const nowIso = new Date().toISOString();
  const note = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    body: typeof body.body === "string" ? body.body : "",
    tags: normalizeTags(body.tags),
    pinned: typeof body.pinned === "boolean" ? body.pinned : false,
    source: SOURCES.includes(body.source as (typeof SOURCES)[number]) ? (body.source as string) : "manual",
    taskId: null,
    vaultPath: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  (await getAnyDb()).insert(notes).values(note).run();
  // 回读补全 DB 默认列,保证响应与库内行一致
  const created = (await getAnyDb()).select().from(notes).where(eq(notes.id, note.id)).all()[0];
  return NextResponse.json({ note: created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id 必填" }, { status: 400 });
  }
  const db = await getAnyDb();
  const current = await q.one(db.select().from(notes).where(eq(notes.id, body.id)));
  if (!current) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  const patch: Partial<typeof notes.$inferInsert> = {};
  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim()) return NextResponse.json({ error: "title 须为非空字符串" }, { status: 400 });
    patch.title = body.title.trim();
  }
  if ("body" in body) {
    if (typeof body.body !== "string") return NextResponse.json({ error: "body 须为字符串" }, { status: 400 });
    patch.body = body.body;
  }
  if ("tags" in body) {
    if (!Array.isArray(body.tags)) return NextResponse.json({ error: "tags 须为字符串数组" }, { status: 400 });
    patch.tags = normalizeTags(body.tags);
  }
  if ("pinned" in body) {
    if (typeof body.pinned !== "boolean") return NextResponse.json({ error: "pinned 须为布尔值" }, { status: 400 });
    patch.pinned = body.pinned;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }
  patch.updatedAt = new Date().toISOString();
  db.update(notes).set(patch).where(eq(notes.id, body.id)).run();
  const updated = db.select().from(notes).where(eq(notes.id, body.id)).all()[0];
  return NextResponse.json({ note: updated });
}
