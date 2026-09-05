import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 接口统一接收 NextRequest(即使当前不用):与 Next 实际调用约定一致,也方便测试以统一形态调用
export async function GET(_req: NextRequest) {
  return NextResponse.json({ projects: getDb().select().from(projects).all() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 必填" }, { status: 400 });
  }
  const project = {
    id: crypto.randomUUID(),
    name: body.name.trim(),
    color: typeof body.color === "string" ? body.color : "#6366f1",
    createdAt: new Date().toISOString(),
  };
  getDb().insert(projects).values(project).run();
  // 回读补全 DB 默认列(archived 等),与 POST /api/tasks 的回读模式一致
  const created = getDb().select().from(projects).where(eq(projects.id, project.id)).all()[0];
  return NextResponse.json({ project: created }, { status: 201 });
}
