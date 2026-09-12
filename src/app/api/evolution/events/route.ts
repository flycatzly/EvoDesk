import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { evolutionEvents } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const events = getDb().select().from(evolutionEvents).orderBy(desc(evolutionEvents.ts)).all().slice(0, 100);
  return NextResponse.json({ events });
}
