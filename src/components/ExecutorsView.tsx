"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { executors, providerProfiles } from "@/lib/db/schema";

// 行类型:apiKeyRef 放宽为 string | null —— 服务端页在 props 边界把 plain: 折叠为 "plain"/null(掩码后形状)
type Executor = Omit<typeof executors.$inferSelect, "apiKeyRef"> & { apiKeyRef: string | null };
type Profile = Omit<typeof providerProfiles.$inferSelect, "apiKeyRef"> & { apiKeyRef: string | null };

const ROLE_LABEL: Record<string, string> = { triage: "分诊", planner: "规划", executor: "执行", reviewer: "审查", evolution: "复盘" };
// 档位→角色默认映射:opus 规划、sonnet/primary 执行、haiku 分诊
const TIER_ROLE: Record<string, string> = { opus: "planner", sonnet: "executor", haiku: "triage", primary: "executor" };

// §10.3 密钥掩码:服务端已在 props 边界掩码(见 app/executors/page.tsx),这里只可能收到
// env:NAME(不含秘密,原样回显)、裸词 "plain"(只提示"已存")或 null;其余前缀一律不回显兜底
function keyHint(ref: string | null): string | null {
  if (!ref) return null;
  if (ref.startsWith("env:")) return ref;
  if (ref === "plain") return "本地已存密钥 🔒";
  return null;
}

function parseCandidates(raw: string): { model: string; tier: string }[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as { model: string; tier: string }[]) : [];
  } catch {
    return [];
  }
}

export function ExecutorsView({ executors: initialExecutors, profiles }: { executors: Executor[]; profiles: Profile[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [importDir, setImportDir] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", role: "executor", model: "", api_base: "", protocol: "openai" });
  const [keyMode, setKeyMode] = useState<"env" | "plain">("env");
  const [keyValue, setKeyValue] = useState("");

  const canCreate = !!(form.name.trim() && form.model.trim() && form.api_base.trim());

  const patch = async (id: string, body: Record<string, unknown>, tag: string) => {
    if (busy) return;
    setBusy(tag);
    try {
      const res = await fetch(`/api/executors/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setMsg(data?.error ?? "操作失败,请重试"); return; }
      router.refresh();
    } catch {
      setMsg("网络异常,请重试"); // 失败不改任何状态,原样保留
    } finally {
      setBusy(null);
    }
  };

  // 测试路由约定:业务失败也返回 200 + ok:false,只看 data.ok/data.error,不做 res.status 分支
  const test = async (id: string) => {
    if (busy) return;
    setBusy(`test-${id}`);
    try {
      const res = await fetch(`/api/executors/${id}/test`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!data || typeof data.ok !== "boolean") { setMsg("✗ 测试失败(响应异常)"); return; }
      setMsg(data.ok ? `✓ ${data.reply ?? "pong"} (${data.model ?? "?"})` : `✗ ${data.error ?? "测试失败"}`);
    } catch {
      setMsg("✗ 网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    if (busy || !importDir.trim()) return;
    setBusy("import");
    try {
      const res = await fetch("/api/provider-profiles/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir: importDir }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.report) { setMsg(data?.error ?? "导入失败"); return; }
      const skipped = (Array.isArray(data.report.skipped) ? data.report.skipped : []) as { name: string; reason: string }[];
      const importedCount = Array.isArray(data.report.imported) ? data.report.imported.length : 0;
      setMsg(`导入 ${importedCount} 个${skipped.length ? `;跳过:${skipped.map((x) => `${x.name}(${x.reason})`).join("、")}` : ""}`);
      setImportDir("");
      router.refresh();
    } catch {
      setMsg("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const derive = async (profileId: string, tier: string, role: string) => {
    if (busy) return;
    setBusy(`derive-${profileId}-${tier}`);
    try {
      const res = await fetch(`/api/provider-profiles/${profileId}/derive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selections: [{ tier, role }] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setMsg(data?.error ?? "派生失败"); return; }
      setMsg("已创建(默认禁用,请在列表中启用)");
      router.refresh();
    } catch {
      setMsg("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const addExecutor = async () => {
    if (busy || !canCreate) return;
    setBusy("add");
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(), role: form.role, model: form.model.trim(),
        api_base: form.api_base.trim(), protocol: form.protocol,
      };
      const kv = keyValue.trim();
      if (kv) {
        if (keyMode === "env") body.api_key_ref = kv.startsWith("env:") ? kv : `env:${kv}`;
        else body.api_key = kv; // API 侧包装为 plain: 引用,明文不落日志
      }
      const res = await fetch("/api/executors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setMsg(data?.error ?? "创建失败"); return; }
      setShowAdd(false);
      setForm({ name: "", role: "executor", model: "", api_base: "", protocol: "openai" });
      setKeyMode("env");
      setKeyValue("");
      setMsg("已创建执行器(默认禁用,请在列表中启用)");
      router.refresh();
    } catch {
      setMsg("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {msg && <div className="surface p-2 mb-3 text-sm">{msg}</div>}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-semibold">执行器</h2>
          <button onClick={() => setShowAdd(!showAdd)} className="ghost-btn px-2 py-1 text-xs">{showAdd ? "收起" : "+ 新增"}</button>
        </div>
        {showAdd && (
          <div className="surface p-3 mb-3 grid md:grid-cols-3 gap-2">
            <input className="input px-2 py-1.5 text-sm" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="input px-2 py-1.5 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input px-2 py-1.5 text-sm" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
              <option value="openai">OpenAI 协议</option><option value="anthropic">Anthropic 协议</option>
            </select>
            <input className="input px-2 py-1.5 text-sm" placeholder="模型名" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className="input px-2 py-1.5 text-sm" placeholder="API Base URL" value={form.api_base} onChange={(e) => setForm({ ...form, api_base: e.target.value })} />
            <select className="input px-2 py-1.5 text-sm" value={keyMode} onChange={(e) => setKeyMode(e.target.value === "plain" ? "plain" : "env")}>
              <option value="env">密钥方式:环境变量</option>
              <option value="plain">密钥方式:直接填写</option>
            </select>
            <input
              className="input px-2 py-1.5 text-sm md:col-span-2"
              placeholder={keyMode === "env" ? "环境变量名,如 EVODESK_FAST_KEY" : "API 密钥(仅存本地数据库)"}
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
            />
            {!canCreate && <div className="md:col-span-3 text-xs" style={{ color: "var(--warn)" }}>模型与 API 地址必填</div>}
            {canCreate && !keyValue.trim() && <div className="md:col-span-3 text-xs" style={{ color: "var(--muted)" }}>未填密钥,启用前请在测试中确认</div>}
            <button onClick={addExecutor} disabled={!canCreate || busy === "add"} className="accent-btn px-3 py-1.5 text-sm md:col-span-3">{busy === "add" ? "创建中…" : "创建执行器"}</button>
          </div>
        )}
        <div className="space-y-2">
          {initialExecutors.map((e) => {
            const hint = keyHint(e.apiKeyRef);
            const linked = e.providerProfileId ? profiles.find((p) => p.id === e.providerProfileId) : undefined;
            return (
              <div key={e.id} className="surface p-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{e.name}</span>
                <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{e.type}</span>
                <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{ROLE_LABEL[e.role] ?? e.role}</span>
                {e.model && <span className="text-xs" style={{ color: "var(--muted)" }}>{e.model}</span>}
                {linked && <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>档案:{linked.name}</span>}
                {hint && <span className="text-xs" style={{ color: "var(--muted)" }}>{hint}</span>}
                {!e.enabled && <span className="text-xs" style={{ color: "var(--warn)" }}>已禁用</span>}
                <div className="ml-auto flex gap-2">
                  {e.type === "llm" && (
                    <button onClick={() => test(e.id)} disabled={!!busy} className="ghost-btn px-2 py-1 text-xs">{busy === `test-${e.id}` ? "测试中…" : "测试"}</button>
                  )}
                  <button onClick={() => patch(e.id, { enabled: !e.enabled }, `toggle-${e.id}`)} disabled={!!busy} className="ghost-btn px-2 py-1 text-xs">
                    {busy === `toggle-${e.id}` ? "处理中…" : e.enabled ? "禁用" : "启用"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <h2 className="font-semibold mb-2">供应商档案</h2>
        <div className="surface p-3 mb-3 flex flex-wrap gap-2 items-center">
          <input className="input px-2 py-1.5 text-sm flex-1 min-w-60" placeholder="启动器配置目录(含 *.txt,如 D:\\AI\\setting\\发布包)" value={importDir} onChange={(e) => setImportDir(e.target.value)} />
          <button onClick={doImport} disabled={busy === "import" || !importDir.trim()} className="accent-btn px-3 py-1.5 text-sm">{busy === "import" ? "导入中…" : "扫描导入"}</button>
        </div>
        {profiles.length === 0 && <div className="surface p-3 text-sm" style={{ color: "var(--muted)" }}>暂无档案。指向你的启动器发布包目录即可一键导入(密钥仅存本地)。</div>}
        <div className="space-y-2">
          {profiles.map((p) => {
            const cands = parseCandidates(p.candidates);
            return (
              <div key={p.id} className="surface p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{p.protocol}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{p.apiBase}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>档位:{cands.map((c) => `${c.tier}=${c.model}`).join(" · ") || "无候选"}</div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(["opus", "sonnet", "haiku", "primary"] as const).map((tier) =>
                    cands.some((c) => c.tier === tier) ? (
                      <button key={tier} onClick={() => derive(p.id, tier, TIER_ROLE[tier])} disabled={!!busy} className="ghost-btn px-2 py-1 text-xs">
                        派生{tier}→{ROLE_LABEL[TIER_ROLE[tier]]}
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
