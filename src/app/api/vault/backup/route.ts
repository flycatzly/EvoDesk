import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { resolveVaultRoot, libraryManifest } from "@/lib/domain/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 资料库备份清单(GET ?root=):全部文件元数据 + 文本内容内联(≤256KB),JSON 附件下载。
// 二进制(如 myBase .nyf)与大文件只记元数据,并附说明字段。
export async function GET(req: NextRequest) {
  const db = getDb();
  const url = new URL(req.url);
  const root = resolveVaultRoot(db, url.searchParams.get("root"));
  if (!root) return NextResponse.json({ error: "无可用资料库" }, { status: 400 });
  const manifest = libraryManifest(root);
  const file = {
    kind: "evodesk-vault-backup",
    version: 1,
    ...manifest,
    note: "文本内容已内联(≤256KB);二进制与大文件仅含元数据,请用磁盘备份工具完整备份。",
  };
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="vault-backup-${ts}.json"`,
    },
  });
}
