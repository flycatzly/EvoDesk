"use client";
import { useEffect, useState } from "react";

type Snapshot = { name: string; sizeBytes: number; ts: string };

// 设置页-数据与备份:一键导出 JSON(默认不含密钥)/ 导入 / 快照创建与恢复
export function BackupForm() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/backup/snapshot");
      const data = (await res.json()) as { snapshots?: Snapshot[] };
      setSnapshots(data.snapshots ?? []);
    } catch {
      /* 列表加载失败不阻塞主功能 */
    }
  };
  useEffect(() => { void load(); }, []);

  const say = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    window.setTimeout(() => setMsg(null), 5000);
  };

  const doImport = async (file: File) => {
    setBusy("import");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/backup/import", { method: "POST", body: form });
      const data = (await res.json()) as { ok?: boolean; perTable?: Record<string, number>; snapshot?: string; error?: string };
      if (res.ok && data.perTable) {
        const total = Object.values(data.perTable).reduce((a, b) => a + b, 0);
        say("ok", `导入成功,共 ${total} 条记录(导入前已自动快照 ${data.snapshot ?? "已保存"})。`);
        void load();
      } else {
        say("err", data.error ?? "导入失败");
      }
    } catch {
      say("err", "导入请求失败");
    } finally {
      setBusy(null);
    }
  };

  const doSnapshot = async () => {
    setBusy("snap");
    try {
      const res = await fetch("/api/backup/snapshot", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; name?: string; error?: string };
      if (res.ok) { say("ok", `快照已创建:${data.name}`); void load(); }
      else say("err", data.error ?? "创建失败");
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async (name: string) => {
    if (!window.confirm(`恢复快照「${name}」?当前数据将先自动快照,然后被该快照覆盖。`)) return;
    setBusy(`restore-${name}`);
    try {
      const res = await fetch("/api/backup/restore", { method: "POST", body: JSON.stringify({ name }) });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok) say("ok", "恢复完成,页面数据已在下次启动/刷新后生效。");
      else say("err", data.error ?? "恢复失败");
    } finally {
      setBusy(null);
    }
  };

  const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

  return (
    <div className="surface p-4 space-y-4">
      <h2 className="font-semibold text-sm">数据与备份</h2>

      {/* 导出 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <a
          className="accent-btn text-xs px-3 py-1.5"
          href={includeSecrets ? "/api/backup/export?include_secrets=1" : "/api/backup/export"}
          download
        >
          导出 JSON 备份
        </a>
        <label className="text-xs flex items-center gap-1" style={{ color: "var(--muted)" }}>
          <input type="checkbox" checked={includeSecrets} onChange={(e) => setIncludeSecrets(e.target.checked)} />
          包含 API 密钥(含明文密钥,谨慎分享)
        </label>
      </div>
      <div className="text-xs" style={{ color: "var(--muted)" }}>
        默认剥离供应商档案与执行器中的密钥;导入后需到执行器页重新填写。换电脑迁移:导出 → 新机导入。
      </div>

      {/* 导入 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="accent-btn text-xs px-3 py-1.5 cursor-pointer">
          {busy === "import" ? "导入中…" : "导入 JSON 备份"}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            disabled={busy !== null}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ""; }}
          />
        </label>
        <span className="text-xs" style={{ color: "var(--muted)" }}>导入会覆盖现有数据,导入前自动快照。</span>
      </div>

      {/* 快照 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <button className="ghost-btn text-xs" onClick={() => void doSnapshot()} disabled={busy !== null}>
            {busy === "snap" ? "创建中…" : "立即创建快照(.db)"}
          </button>
          <span className="text-xs" style={{ color: "var(--muted)" }}>保留最近 20 份,存于 data/backups。</span>
        </div>
        {snapshots.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>暂无快照。</div>
        ) : (
          <ul className="space-y-1">
            {snapshots.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-xs">
                <span className="truncate flex-1" title={s.name}>{s.name}</span>
                <span style={{ color: "var(--muted)" }}>{sizeLabel(s.sizeBytes)} · {new Date(s.ts).toLocaleString()}</span>
                <button
                  className="ghost-btn px-2 py-0.5"
                  disabled={busy !== null}
                  onClick={() => void doRestore(s.name)}
                >
                  {busy === `restore-${s.name}` ? "恢复中…" : "恢复"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && (
        <div className="text-xs" style={{ color: msg.kind === "ok" ? "var(--ok)" : "var(--danger)" }}>{msg.text}</div>
      )}
    </div>
  );
}
