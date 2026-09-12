import { getDb } from "@/lib/db/client";
import { buildStats } from "@/lib/domain/stats";
import { StatsView } from "@/components/StatsView";
import { readSettingsKv } from "@/lib/db/read-settings";

export const dynamic = "force-dynamic";

// 与 /api/stats 同源:直接调 buildStats,页面与端点口径天然一致(不走 HTTP 自fetch)
export default async function StatsPage() {
  const db = getDb();
  const kv = readSettingsKv(db);
  const stats = buildStats(db, new Date(), typeof kv.timezone === "string" ? kv.timezone : "");
  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-4">统计</h1>
      <StatsView data={stats} />
    </div>
  );
}
