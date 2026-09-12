import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { flowTemplates } from "@/lib/db/schema";
import { promoteTemplate, EvolutionError } from "@/lib/domain/evolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  try {
    promoteTemplate(db, id);
  } catch (e) {
    if (e instanceof EvolutionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ template: db.select().from(flowTemplates).where(eq(flowTemplates.id, id)).all()[0] });
}
