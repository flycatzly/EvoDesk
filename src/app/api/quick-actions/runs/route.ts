import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { quickActionRuns } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const runs = getDb().select().from(quickActionRuns).orderBy(desc(quickActionRuns.ts)).limit(20).all();
  return NextResponse.json({ runs });
}
