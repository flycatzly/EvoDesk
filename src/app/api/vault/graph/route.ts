import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { resolveVaultRoot, readNoteFile } from "@/lib/domain/vault";
import { buildGraph, buildTagIndex } from "@/lib/domain/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 知识图谱数据(GET ?root=&tag=):md 文件 → 节点([[双链]] → 边,悬空链接占位);
// tag 参数 = 只看含该标签的文件及其一跳邻居。
export async function GET(req: NextRequest) {
  const db = getDb();
  const url = new URL(req.url);
  const root = resolveVaultRoot(db, url.searchParams.get("root"));
  if (!root) return NextResponse.json({ error: "无可用资料库" }, { status: 400 });
  const tag = url.searchParams.get("tag") ?? "";

  const { indexLibrary } = await import("@/lib/domain/vault");
  const index = indexLibrary(root, { maxEntries: 800, maxDepth: 6 });
  const mdEntries = index.entries.filter((e) => e.name.toLowerCase().endsWith(".md"));
  const files = mdEntries.map((e) => ({ relPath: e.relPath, name: e.name, content: readNoteFile(root, e.relPath).slice(0, 32_768) }));

  const tagIndex = buildTagIndex(files);
  let scope = files;
  if (tag) {
    const inTag = new Set(tagIndex.get(tag) ?? []);
    scope = files.filter((f) => inTag.has(f.relPath));
  }
  const graph = buildGraph(scope);
  return NextResponse.json({
    root,
    tag,
    tags: [...tagIndex.keys()].sort((a, b) => (tagIndex.get(b)!.length - tagIndex.get(a)!.length)),
    total: mdEntries.length,
    ...graph,
  });
}
