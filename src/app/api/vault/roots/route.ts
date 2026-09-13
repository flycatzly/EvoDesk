import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { vaultRoots } from "@/lib/domain/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 资料库根目录列表(GET):服务端统一去重后的唯一事实来源
// (vault_path 主库 + settings.vault_roots,按 path.resolve 归一化去重),
// 客户端直接消费,避免前端自行拼装产生重复项(React key 冲突)。
export async function GET() {
  return NextResponse.json({ roots: vaultRoots(getDb()) });
}
