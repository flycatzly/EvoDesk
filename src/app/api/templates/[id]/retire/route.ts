import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { flowTemplates } from "@/lib/db/schema";
import { retireTemplate, EvolutionError } from "@/lib/domain/evolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const reason = String(body.reason ?? "手动退役");
  const db = getDb();
  try {
    retireTemplate(db, id, reason);
  } catch (e) {
    if (e instanceof EvolutionError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ template: db.select().from(flowTemplates).where(eq(flowTemplates.id, id)).all()[0] });
}
