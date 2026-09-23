// IM 通知桥:任务逾期 / 自愈修复失败 / 流程待审核 时推送提醒。
// 渠道:Server酱(微信,sc_key)与 Telegram(bot token + chat_id),settings.notify 配置。
// 推送失败静默(通知是尽力而为,绝不影响主流程);频率限制:同类消息 10 分钟内不重复。
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/db/test-util";
import { readSettingsKv } from "@/lib/db/read-settings";

export type NotifyChannel = "serverchan" | "telegram";
export type NotifyConfig = {
  channels: { kind: NotifyChannel; scKey?: string; botToken?: string; chatId?: string }[];
  /** 最小间隔(分钟),同 dedupeKey 不重复推送;0 = 不去重 */
  dedupeMinutes: number;
};
export type NotifyEvent = { dedupeKey: string; title: string; body: string };

export function notifyConfigFromKv(raw: unknown): NotifyConfig {
  const def: NotifyConfig = { channels: [], dedupeMinutes: 10 };
  if (!raw || typeof raw !== "object") return def;
  const o = raw as Record<string, unknown>;
  const channels = Array.isArray(o.channels)
    ? o.channels
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          kind: c.kind === "telegram" ? "telegram" as const : "serverchan" as const,
          scKey: typeof c.scKey === "string" ? c.scKey : undefined,
          botToken: typeof c.botToken === "string" ? c.botToken : undefined,
          chatId: typeof c.chatId === "string" ? c.chatId : undefined,
        }))
        .filter((c) => (c.kind === "serverchan" ? !!c.scKey : !!c.botToken && !!c.chatId))
    : [];
  return { channels, dedupeMinutes: typeof o.dedupeMinutes === "number" && o.dedupeMinutes >= 0 ? o.dedupeMinutes : 10 };
}

const DEDUPE_FILE = path.join("data", "notify-last.json");

/** 进程内+文件两级去重:同 key 在窗口内只推一次(本地单用户,文件已足够) */
function shouldSend(cfg: NotifyConfig, key: string): boolean {
  if (cfg.dedupeMinutes === 0) return true;
  let last: Record<string, number> = {};
  try {
    last = JSON.parse(fs.readFileSync(DEDUPE_FILE, "utf8")) as Record<string, number>;
  } catch { /* 首次 */ }
  const now = Date.now();
  // 顺手清理过期项
  for (const k of Object.keys(last)) if (now - last[k] > 24 * 3600_000) delete last[k];
  if (last[key] && now - last[key] < cfg.dedupeMinutes * 60_000) return false;
  last[key] = now;
  try {
    fs.mkdirSync(path.dirname(DEDUPE_FILE), { recursive: true });
    fs.writeFileSync(DEDUPE_FILE, JSON.stringify(last));
  } catch { /* 写失败不去重,只多推一次 */ }
  return true;
}

async function pushServerChan(scKey: string, title: string, body: string): Promise<void> {
  const res = await fetch(`https://sctapi.ftqq.com/${scKey}.send`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ title: title.slice(0, 32), desp: body.slice(0, 800) }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`serverchan ${res.status}`);
}

async function pushTelegram(botToken: string, chatId: string, title: string, body: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: `${title}\n${body}`.slice(0, 4000) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}`);
}

/** 发送通知(异步尽力而为):无渠道配置或全部失败都只返回结果,不抛出。 */
export async function sendNotify(db: Db, event: NotifyEvent): Promise<{ sent: number; errors: string[] }> {
  const cfg = notifyConfigFromKv((await readSettingsKv(db)).notify);
  if (cfg.channels.length === 0) return { sent: 0, errors: [] };
  if (!shouldSend(cfg, event.dedupeKey)) return { sent: 0, errors: ["deduped"] };
  const errors: string[] = [];
  let sent = 0;
  for (const ch of cfg.channels) {
    try {
      if (ch.kind === "serverchan" && ch.scKey) { await pushServerChan(ch.scKey, event.title, event.body); sent++; }
      if (ch.kind === "telegram" && ch.botToken && ch.chatId) { await pushTelegram(ch.botToken, ch.chatId, event.title, event.body); sent++; }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { sent, errors };
}
