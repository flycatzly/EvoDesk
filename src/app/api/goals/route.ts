import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { goals } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = ["reading", "fitness", "project", "custom"] as const;

export async function GET(req: NextRequest) {
  const showArchived = new URL(req.url).searchParams.get("archived") === "1";
  const rows = getDb().select().from(goals).all();
  const filtered = rows.filter((g) => showArchived || !g.archived);
  const sorted = [...filtered].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return NextResponse.json({ goals: sorted });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title 必填" }, { status: 400 });
  }
  if (typeof body.target !== "number" || !Number.isFinite(body.target) || body.target <= 0) {
    return NextResponse.json({ error: "target 须为正数" }, { status: 400 });
  }
  const nowIso = new Date().toISOString();
  const goal = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    category: CATEGORIES.includes(body.category as (typeof CATEGORIES)[number]) ? (body.category as string) : "custom",
    target: Math.round(body.target),
    current: typeof body.current === "number" && Number.isFinite(body.current) && body.current >= 0 ? Math.round(body.current) : 0,
    unit: typeof body.unit === "string" ? body.unit : "",
    deadline: typeof body.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.deadline) ? body.deadline : null,
    color: typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : null,
    archived: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  getDb().insert(goals).values(goal).run();
  const created = getDb().select().from(goals).where(eq(goals.id, goal.id)).all()[0];
  return NextResponse.json({ goal: created }, { status: 201 });
}
