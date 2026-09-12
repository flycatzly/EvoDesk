import type { Db } from "@/lib/db/test-util";
import { settings } from "@/lib/db/schema";

/** 读全量 settings 为 KV:value 统一 JSON 序列化写入,此处统一反序列化;解析失败回退原始字符串。
 * 仪表盘/日历/设置三页共用同一 inline 循环,抽此处避免多份实现漂移(2026-09 M5 审查记录)。 */
export function readSettingsKv(db: Db): Record<string, unknown> {
  const rows = db.select().from(settings).all() as { key: string; value: string }[];
  const kv: Record<string, unknown> = {};
  for (const r of rows) { try { kv[r.key] = JSON.parse(r.value); } catch { kv[r.key] = r.value; } }
  return kv;
}
