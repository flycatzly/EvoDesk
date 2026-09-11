import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { startRun, RunError } from "@/lib/domain/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { runId } = startRun(getDb(), id);
    return NextResponse.json({ runId }, { status: 201 });
  } catch (e) {
    if (e instanceof RunError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
