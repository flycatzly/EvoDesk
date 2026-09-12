import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { flowTemplates } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 克隆:脱离原血统的新副本(新 lineageId、parentId 置空),可对 retired 模板克隆重启
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, id)).all()[0];
  if (!tpl) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  const copyId = crypto.randomUUID();
  db.insert(flowTemplates).values({
    id: copyId, name: `${tpl.name} 副本`.slice(0, 60), description: tpl.description, tags: tpl.tags,
    complexity: tpl.complexity, version: 1, lineageId: crypto.randomUUID(), parentId: null, origin: "manual",
    status: "active", steps: tpl.steps, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }).run();
  return NextResponse.json({ template: db.select().from(flowTemplates).where(eq(flowTemplates.id, copyId)).all()[0] }, { status: 201 });
}
