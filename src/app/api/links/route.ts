import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { links } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isHttpUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\/\S+/.test(v);

export async function GET() {
  const rows = getDb().select().from(links).all();
  // 分组内按 sort 升序,同序按创建先后
  const sorted = [...rows].sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
  return NextResponse.json({ links: sorted });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title 必填" }, { status: 400 });
  }
  if (!isHttpUrl(body.url)) {
    return NextResponse.json({ error: "url 须为 http(s) 链接" }, { status: 400 });
  }
  const link = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    url: (body.url as string).trim(),
    category: typeof body.category === "string" && body.category.trim() ? body.category.trim() : "常用",
    sort: typeof body.sort === "number" && Number.isFinite(body.sort) ? body.sort : 0,
    createdAt: new Date().toISOString(),
  };
  getDb().insert(links).values(link).run();
  const created = getDb().select().from(links).where(eq(links.id, link.id)).all()[0];
  return NextResponse.json({ link: created }, { status: 201 });
}
