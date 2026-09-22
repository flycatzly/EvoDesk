import { NextRequest } from "next/server";
import { getAnyDb } from "@/lib/db/data-source";
import { exportData } from "@/lib/domain/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// JSON 全量导出:?include_secrets=1 显式携带密钥(默认剥离,导入后需重新配置模型密钥)
export async function GET(req: NextRequest) {
  const includeSecrets = new URL(req.url).searchParams.get("include_secrets") === "1";
  const file = await exportData(await getAnyDb(), { includeSecrets });
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="evodesk-backup-${stamp}.json"`,
    },
  });
}
