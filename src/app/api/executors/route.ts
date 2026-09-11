import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { executors } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = ["triage", "planner", "executor", "reviewer", "evolution"];

export async function GET(_req: NextRequest) {
  return NextResponse.json({ executors: getDb().select().from(executors).all() });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 必填" }, { status: 400 });
  }
  if (typeof body.role === "string" && !ROLES.includes(body.role)) {
    return NextResponse.json({ error: `role 须为 ${ROLES.join("|")}` }, { status: 400 });
  }
  const role = typeof body.role === "string" ? body.role : "executor";
  // 密钥二选一:明文 api_key 包装为 plain: 引用,或直接给 env 风格的 api_key_ref;都不传则留空(测试时明确报"未配置")
  const apiKeyRef = typeof body.api_key === "string" && body.api_key.trim()
    ? `plain:${body.api_key.trim()}`
    : typeof body.api_key_ref === "string" && body.api_key_ref.trim() ? body.api_key_ref.trim() : null;
  const executor = {
    id: crypto.randomUUID(), name: body.name.trim(), type: "llm", role,
    model: typeof body.model === "string" && body.model.trim() ? body.model.trim() : null,
    apiBase: typeof body.api_base === "string" && body.api_base.trim() ? body.api_base.trim() : null,
    protocol: body.protocol === "anthropic" ? "anthropic" : "openai",
    apiKeyRef, enabled: false, createdAt: new Date().toISOString(),
  };
  getDb().insert(executors).values(executor).run();
  return NextResponse.json({ executor }, { status: 201 });
}
