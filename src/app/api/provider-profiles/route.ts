import { NextRequest, NextResponse } from "next/server";
import { getAnyDb } from "@/lib/db/data-source";
import { providerProfiles } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  return NextResponse.json({ profiles: (await (await getAnyDb()).select().from(providerProfiles)) });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.api_base !== "string" || !body.api_base.trim() || typeof body.api_key !== "string" || !body.api_key.trim()) {
    return NextResponse.json({ error: "name / api_base / api_key 必填" }, { status: 400 });
  }
  const protocol = body.protocol === "openai" ? "openai" : "anthropic";
  const profile = {
    id: crypto.randomUUID(), name: body.name.trim(), protocol, apiBase: body.api_base.trim(),
    apiKeyRef: `plain:${(body.api_key as string).trim()}`,
    candidates: JSON.stringify(Array.isArray(body.candidates) ? body.candidates : []),
    source: "manual", createdAt: new Date().toISOString(),
  };
  await (await getAnyDb()).insert(providerProfiles).values(profile);
  return NextResponse.json({ profile }, { status: 201 });
}
