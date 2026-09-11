import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { deriveExecutors, PROFILE_TIERS } from "@/lib/domain/profiles";
import { EXECUTOR_ROLES } from "@/lib/domain/roles";

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
  // 逐项校验 tier/role 白名单,非法直接 400(而不是进派生逻辑后 409)
  for (const s of selections) {
    const entry = s && typeof s === "object" ? s as Record<string, unknown> : null;
    const tier = entry?.tier, role = entry?.role;
    if (typeof tier !== "string" || !(PROFILE_TIERS as readonly string[]).includes(tier)
      || typeof role !== "string" || !(EXECUTOR_ROLES as readonly string[]).includes(role)) {
      return NextResponse.json({ error: `selections 项须为 { tier: ${PROFILE_TIERS.join("|")}, role: ${EXECUTOR_ROLES.join("|")} }` }, { status: 400 });
    }
  }
  try {
    const created = deriveExecutors(getDb(), id, selections as { tier: "primary" | "opus" | "sonnet" | "haiku"; role: string }[]);
    return NextResponse.json({ created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 409 });
  }
}
