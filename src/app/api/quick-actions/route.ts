import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { quickActions, quickActionRuns } from "@/lib/db/schema";
import { sweepStaleSettings } from "@/lib/domain/launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["command", "url", "launch"] as const;
const SHELLS = ["powershell", "cmd", "bash", "python"] as const;

export async function GET(_req: NextRequest) {
  sweepStaleSettings(); // 崩溃残留兜底:fire-and-forget,不阻塞列表返回
  const db = getDb();
  const rows = db.select().from(quickActions).all();
  // enabled 排前 → sort asc → createdAt asc
  const actions = [...rows].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.sort !== b.sort) return a.sort - b.sort;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const runs = db.select().from(quickActionRuns).orderBy(desc(quickActionRuns.ts)).limit(20).all();
  return NextResponse.json({ actions, runs });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.type !== "string" || !TYPES.includes(body.type as (typeof TYPES)[number]) || typeof body.payload !== "string" || !body.payload.trim()) {
    return NextResponse.json({ error: "name / type(command|url|launch) / payload 必填" }, { status: 400 });
  }
  const type = body.type;
  if (type === "launch") {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body.payload);
    } catch {
      parsed = null;
    }
    const profileId = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).profile_id : undefined;
    if (typeof profileId !== "string" || !profileId.trim()) {
      return NextResponse.json({ error: "launch 型 payload 须为 JSON 且含 profile_id" }, { status: 400 });
    }
  }
  let shell: string | null = null;
  if (type === "command") {
    shell = typeof body.shell === "string" && body.shell ? body.shell : "powershell";
    if (!SHELLS.includes(shell as (typeof SHELLS)[number])) {
      return NextResponse.json({ error: "shell 须为 powershell|cmd|bash|python" }, { status: 400 });
    }
  }
  const action = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    type,
    payload: body.payload,
    shell,
    icon: typeof body.icon === "string" ? body.icon : null,
    sort: Number.isInteger(body.sort) ? (body.sort as number) : 0,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    createdAt: new Date().toISOString(),
  };
  getDb().insert(quickActions).values(action).run();
  return NextResponse.json({ action }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id 必填" }, { status: 400 });
  }
  const db = getDb();
  const current = db.select().from(quickActions).where(eq(quickActions.id, body.id)).all()[0];
  if (!current) return NextResponse.json({ error: "快捷指令不存在" }, { status: 404 });

  const patch: Partial<typeof quickActions.$inferInsert> = {};
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "name 须为非空字符串" }, { status: 400 });
    patch.name = body.name.trim();
  }
  if ("payload" in body) {
    if (typeof body.payload !== "string" || !body.payload.trim()) return NextResponse.json({ error: "payload 须为非空字符串" }, { status: 400 });
    patch.payload = body.payload;
  }
  if ("shell" in body) {
    if (body.shell !== null && (typeof body.shell !== "string" || !SHELLS.includes(body.shell as (typeof SHELLS)[number]))) {
      return NextResponse.json({ error: "shell 须为 powershell|cmd|bash|python" }, { status: 400 });
    }
    patch.shell = body.shell as string | null;
  }
  if ("icon" in body) {
    if (body.icon !== null && typeof body.icon !== "string") return NextResponse.json({ error: "icon 须为字符串或 null" }, { status: 400 });
    patch.icon = body.icon as string | null;
  }
  if ("sort" in body) {
    if (!Number.isInteger(body.sort)) return NextResponse.json({ error: "sort 须为整数" }, { status: 400 });
    patch.sort = body.sort as number;
  }
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled 须为布尔值" }, { status: 400 });
    patch.enabled = body.enabled;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  }
  db.update(quickActions).set(patch).where(eq(quickActions.id, body.id)).run();
  const updated = db.select().from(quickActions).where(eq(quickActions.id, body.id)).all()[0];
  return NextResponse.json({ action: updated });
}
