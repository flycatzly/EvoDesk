"use client";
import { useState } from "react";

export function SettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const [form, setForm] = useState({
    cost_budget_usd: String(initial.cost_budget_usd ?? 10),
    vault_path: String(initial.vault_path ?? "D:\\work\\Obsidian\\Obsidian"),
    waiting_human_timeout_hours: String(initial.waiting_human_timeout_hours ?? 24),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(false); // 新一轮保存前清掉上次的失败提示
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cost_budget_usd: Number(form.cost_budget_usd) || 0,
          vault_path: form.vault_path,
          waiting_human_timeout_hours: Number(form.waiting_human_timeout_hours) || 24,
        }),
      });
      if (!res.ok) { setError(true); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError(true); // 网络异常等 fetch reject 也不能静默
    } finally {
      setSaving(false);
    }
  };
  const field = (label: string, key: keyof typeof form) => (
    <label className="block mb-3">
      <span className="text-sm block mb-1">{label}</span>
      <input className="input w-full px-3 py-2 text-sm" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="surface p-4 max-w-xl">
      {field("成本预算(USD,超限进风险雷达)", "cost_budget_usd")}
      {field("Obsidian vault 路径(知识库 M4 接入)", "vault_path")}
      {field("待人工超时阈值(小时)", "waiting_human_timeout_hours")}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="accent-btn px-4 py-2 text-sm">
          {saving ? "保存中…" : saved ? "已保存 ✓" : "保存设置"}
        </button>
        {error && <span className="text-xs" style={{ color: "var(--danger)" }}>保存失败,请重试</span>}
      </div>
    </div>
  );
}
