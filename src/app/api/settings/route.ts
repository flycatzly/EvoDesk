import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { q } from "@/lib/db/q";
import { settings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SettingRow = { key: string; value: string };

// settings 是 KV 表,value 统一 JSON 序列化;GET 还原为解析后的对象(解析失败按原始字符串透出)
export async function GET(_req: NextRequest) {
  const db = await getAnyDb();
  const rows = await q.all<SettingRow>(db.select().from(settings));
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return NextResponse.json({ settings: out });
}

export async function PUT(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "需要键值对象" }, { status: 400 });
  const db = await getAnyDb();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const value = JSON.stringify(v);
    const existing = await q.one<SettingRow>(db.select().from(settings).where(eq(settings.key, k)));
    if (existing) {
      await q.run(db.update(settings).set({ value }).where(eq(settings.key, k)));
    } else {
      await q.run(db.insert(settings).values({ key: k, value }));
    }
  }
  return GET(req); // 直接回读最新状态作为响应(GET 忽略请求对象)
}
