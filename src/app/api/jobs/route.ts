import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { jobs, jobsRuns } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim().toLowerCase() ?? "";
  const city = params.get("city")?.trim() ?? "";
  let rows = db.select().from(jobs).all() as (typeof jobs.$inferSelect)[];
  if (city) rows = rows.filter((r) => r.city.includes(city));
  if (q) {
    rows = rows.filter((r) => `${r.title} ${r.brand} ${r.salaryDesc} ${r.labels}`.toLowerCase().includes(q));
  }
  rows.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  const runs = (db.select().from(jobsRuns).all() as (typeof jobsRuns.$inferSelect)[])
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20);
  return NextResponse.json({ jobs: rows, runs });
}
