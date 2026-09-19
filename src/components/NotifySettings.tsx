"use client";
import { useState } from "react";

type Channel = { kind: "serverchan" | "telegram"; scKey?: string; botToken?: string; chatId?: string };

// 通知渠道配置(Server酱/Telegram):保存到 settings.notify;
// 事件源:自愈修复失败、任务逾期(后续可扩展)。推送失败不影响主流程。
export function NotifySettings({ initial }: { initial: unknown }) {
  const init = (initial && typeof initial === "object" ? (initial as { channels?: Channel[] }) : {}) as { channels?: Channel[] };
  const existing = init.channels ?? [];
  const sc = existing.find((c) => c.kind === "serverchan");
  const tg = existing.find((c) => c.kind === "telegram");
  const [scKey, setScKey] = useState(sc?.scKey ?? "");
  const [botToken, setBotToken] = useState(tg?.botToken ?? "");
  const [chatId, setChatId] = useState(tg?.chatId ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const buildChannels = (): Channel[] => {
    const channels: Channel[] = [];
    if (scKey.trim()) channels.push({ kind: "serverchan", scKey: scKey.trim() });
    if (botToken.trim() && chatId.trim()) channels.push({ kind: "telegram", botToken: botToken.trim(), chatId: chatId.trim() });
    return channels;
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ notify: { channels: buildChannels(), dedupeMinutes: 10 } }) });
      setMsg(res.ok ? { ok: true, text: "已保存" } : { ok: false, text: "保存失败" });
    } catch {
      setMsg({ ok: false, text: "网络异常" });
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const saveRes = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ notify: { channels: buildChannels(), dedupeMinutes: 10 } }) });
      if (!saveRes.ok) { setMsg({ ok: false, text: "保存失败" }); return; }
      const res = await fetch("/api/notify", { method: "POST", body: JSON.stringify({ title: "EvoDesk 通知测试" }) });
      const data = (await res.json()) as { ok?: boolean; sent?: number; error?: string };
      setMsg(res.ok && data.sent ? { ok: true, text: `已发送(${data.sent} 个渠道),请查收` } : { ok: false, text: data.error ?? "未配置任何渠道" });
    } catch {
      setMsg({ ok: false, text: "网络异常" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="surface p-4 max-w-xl">
      <div className="text-sm font-medium mb-2">🔔 IM 通知(逾期 / 自愈失败提醒)</div>
      <label className="block mb-3">
        <span className="text-sm block mb-1">Server酱 SendKey(微信推送,<a className="underline" href="https://sct.ftqq.com" target="_blank" rel="noreferrer">sct.ftqq.com</a> 获取)</span>
        <input className="input w-full px-3 py-2 text-sm" value={scKey} placeholder="SCT…(留空不启用)" onChange={(e) => setScKey(e.target.value)} />
      </label>
      <label className="block mb-3">
        <span className="text-sm block mb-1">Telegram Bot Token</span>
        <input className="input w-full px-3 py-2 text-sm" value={botToken} placeholder="123456:ABC…(留空不启用)" onChange={(e) => setBotToken(e.target.value)} />
      </label>
      <label className="block mb-3">
        <span className="text-sm block mb-1">Telegram Chat ID</span>
        <input className="input w-full px-3 py-2 text-sm" value={chatId} placeholder="与 Bot 对话后从 getUpdates 获取" onChange={(e) => setChatId(e.target.value)} />
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={saving} className="accent-btn px-4 py-2 text-sm">{saving ? "保存中…" : "保存配置"}</button>
        <button onClick={test} disabled={testing} className="ghost-btn px-3 py-2 text-sm">{testing ? "发送中…" : "发送测试"}</button>
        {msg && <span className="text-xs" style={{ color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</span>}
      </div>
      <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>同类事件 10 分钟内去重,不轰炸。推送失败不影响工作台运行。</div>
    </div>
  );
}
