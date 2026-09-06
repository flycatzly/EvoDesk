"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { tasks, flowTemplates } from "@/lib/db/schema";

type Task = typeof tasks.$inferSelect;
type Template = typeof flowTemplates.$inferSelect;

export function TriageCard({ task, templates }: { task: Task; templates: Template[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState<{ tags: string; complexity: string; templateId: string } | null>(null);

  const triage = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/triage`, { method: "POST" });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data?.task || !data?.suggestion) return;
      setForm({
        tags: (data.task.tags ?? []).join(","),
        complexity: data.task.complexity,
        templateId: data.task.flowTemplateId ?? data.matched_template_id ?? "",
      });
      setNote(data.degraded ? "AI 分诊不可用,已用默认建议,请手动确认。" : `AI 建议:${data.suggestion.reason}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!form || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tags: form.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          complexity: form.complexity,
          flow_template_id: form.templateId || null,
          status: "ready",
        }),
      });
      if (!res.ok) return; // 失败(含并发流转 422)保留表单与提示,用户可重试或手动核对
      setForm(null);
      setNote(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="surface p-3 mb-2">
      <div className="text-sm font-medium">{task.title}</div>
      <div className="flex gap-2 mt-2">
        <button onClick={triage} disabled={busy} className="accent-btn px-3 py-1.5 text-sm">{busy ? "分诊中…" : form ? "重新分诊" : "一键分诊"}</button>
      </div>
      {note && <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>{note}</div>}
      {form && (
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <input className="input px-2 py-1.5 text-sm" placeholder="标签,逗号分隔" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <select className="input px-2 py-1.5 text-sm" value={form.complexity} onChange={(e) => setForm({ ...form, complexity: e.target.value })}>
            <option value="S">S 琐事</option><option value="M">M 常规</option><option value="L">L 深度</option>
          </select>
          <select className="input px-2 py-1.5 text-sm" value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
            <option value="">(暂不绑定流程)</option>
            {templates.filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={confirm} disabled={busy} className="accent-btn px-3 py-1.5 text-sm md:col-span-3">确认,进入就绪</button>
        </div>
      )}
    </div>
  );
}
