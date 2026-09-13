import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { resolveVaultRoot, indexLibrary } from "@/lib/domain/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 资料库索引(GET ?root=&cat=):多根白名单校验,按扩展智能分类统计 + 文件清单(容量截断)
export async function GET(req: NextRequest) {
  const db = getDb();
  const url = new URL(req.url);
  const root = resolveVaultRoot(db, url.searchParams.get("root"));
  if (!root) return NextResponse.json({ error: "无可用资料库:先在设置配置 Obsidian vault 或资料库目录" }, { status: 400 });
  const cat = url.searchParams.get("cat") ?? "";
  const index = indexLibrary(root);
  const entries = cat ? index.entries.filter((e) => e.category === cat) : index.entries;
  return NextResponse.json({ root, stats: index.stats, total: index.entries.length, truncated: index.truncated, entries });
}
