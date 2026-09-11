import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getRun, getSteps, getCurrentStep, getStepDefsForRun, syncRunStatus, RunError } from "@/lib/domain/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    syncRunStatus(db, id);
    const run = getRun(db, id);
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    const steps = getSteps(db, id);
    const cur = getCurrentStep(db, id);
    return NextResponse.json({ run, steps, currentStepIndex: cur?.stepIndex ?? null, stepDefs: getStepDefsForRun(db, id) });
  } catch (e) {
    if (e instanceof RunError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
