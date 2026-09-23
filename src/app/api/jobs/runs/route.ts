import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobsRuns } from "@/lib/db/schema";
import { MAX_PAGES, spawnJobsScript } from "@/lib/domain/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 启动脚本运行(kind=scrape|check|setup|smoke);scrape 参数守门:页数 ≤10
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = body.kind === "check" || body.kind === "setup" || body.kind === "smoke" ? body.kind : "scrape";

  let args: string[];
  let params: Record<string, unknown> = {};
  if (kind === "scrape") {
    const keyword = typeof body.keyword === "string" && body.keyword.trim() ? body.keyword.trim() : "";
    if (!keyword) return NextResponse.json({ error: "keyword 必填" }, { status: 400 });
    const city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : "";
    const pages = Math.max(1, Math.min(MAX_PAGES, typeof body.pages === "number" && Number.isFinite(body.pages) ? Math.round(body.pages) : 1));
    const noDetail = body.no_detail === true;
    args = ["--keyword", keyword, "--pages", String(pages), "--format", "json"];
    if (city) args.push("--city", city);
    if (noDetail) args.push("--no-detail");
    params = { keyword, city, pages, no_detail: noDetail };
  } else {
    args = [kind === "check" ? "--check" : kind === "setup" ? "--setup-chrome" : "--smoke-test"];
    params = { action: kind };
  }

  const out = await spawnJobsScript({ kind, args, db: getDb(), params });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 409 });
  return NextResponse.json({ ok: true, runId: out.runId });
}

// 运行记录列表/详情:GET ?id= 查单个(含输出增量),否则最近 20 条
export async function GET(req: NextRequest) {
  const db = getDb();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const row = db.select().from(jobsRuns).where(eq(jobsRuns.id, id)).all()[0];
    if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    return NextResponse.json({ run: row });
  }
  const rows = (db.select().from(jobsRuns).all() as (typeof jobsRuns.$inferSelect)[])
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20);
  return NextResponse.json({ runs: rows });
}
