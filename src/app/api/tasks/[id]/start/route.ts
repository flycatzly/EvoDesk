import { NextRequest, NextResponse } from "next/server";
import { getAnyDb } from "@/lib/db/data-source";
import { startRun, RunError } from "@/lib/domain/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { runId } = await startRun(await getAnyDb(), id);
    return NextResponse.json({ runId }, { status: 201 });
  } catch (e) {
    if (e instanceof RunError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
