import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sendNotify } from "@/lib/domain/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 通知测试(POST):发送一条测试消息验证渠道配置;也供内部钩子调用真实事件。
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const title = body && typeof body.title === "string" && body.title.trim() ? body.title.trim() : "EvoDesk 通知测试";
  const text = body && typeof body.body === "string" ? body.body : "如果你看到这条消息,说明通知渠道配置成功 🎉";
  const dedupeKey = body && typeof body.dedupeKey === "string" ? body.dedupeKey : `test-${Date.now()}`;
  const result = await sendNotify(getDb(), { dedupeKey, title, body: text });
  if (result.sent === 0 && result.errors.length > 0) {
    return NextResponse.json({ ok: false, error: result.errors.join(";") }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: result.sent });
}
