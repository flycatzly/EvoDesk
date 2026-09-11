import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { executors } from "@/lib/db/schema";
import { EXECUTOR_ROLES } from "@/lib/domain/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 白名单字段更新:只接受显式声明的键,避免批量赋值把 shell/commandTemplate 等脚本字段从请求体带入
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const patch: Partial<typeof executors.$inferInsert> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.model === "string" || body.model === null) patch.model = body.model as string | null;
  if (typeof body.api_base === "string" || body.api_base === null) patch.apiBase = body.api_base as string | null;
  if (body.protocol === "openai" || body.protocol === "anthropic") patch.protocol = body.protocol;
  if (typeof body.role === "string") {
    if (!(EXECUTOR_ROLES as readonly string[]).includes(body.role)) {
      return NextResponse.json({ error: `role 须为 ${EXECUTOR_ROLES.join("|")}` }, { status: 400 });
    }
    patch.role = body.role;
  }
  if (typeof body.timeout_ms === "number") patch.timeoutMs = body.timeout_ms;
  if (typeof body.working_dir === "string" || body.working_dir === null) patch.workingDir = body.working_dir as string | null;
  if (typeof body.auto_approve === "boolean") patch.autoApprove = body.auto_approve;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  getDb().update(executors).set(patch).where(eq(executors.id, id)).run();
  const row = getDb().select().from(executors).where(eq(executors.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ executor: row });
}
