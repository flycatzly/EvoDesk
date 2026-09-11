import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importProfilesFromDir } from "@/lib/domain/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!body || typeof body.dir !== "string" || !body.dir.trim()) {
    return NextResponse.json({ error: "dir 必填" }, { status: 400 });
  }
  try {
    const report = importProfilesFromDir(getDb(), body.dir.trim());
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 400 });
  }
}
