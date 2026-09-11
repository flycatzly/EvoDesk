import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { deriveExecutors } from "@/lib/domain/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const selections = body?.selections;
  if (!Array.isArray(selections) || selections.length === 0) {
    return NextResponse.json({ error: "selections 必填(如 [{tier:'opus', role:'planner'}])" }, { status: 400 });
  }
  try {
    const created = deriveExecutors(getDb(), id, selections as { tier: "primary" | "opus" | "sonnet" | "haiku"; role: string }[]);
    return NextResponse.json({ created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 409 });
  }
}
