import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { jobsToCsv } from "@/lib/domain/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSV 导出(UTF-8 BOM);?city= 可选过滤,其余导出全量
export async function GET(req: NextRequest) {
  const city = new URL(req.url).searchParams.get("city")?.trim() ?? "";
  let rows = getDb().select().from(jobs).all() as (typeof jobs.$inferSelect)[];
  if (city) rows = rows.filter((r) => r.city.includes(city));
  rows.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(jobsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="boss-jobs-${stamp}.csv"`,
    },
  });
}
