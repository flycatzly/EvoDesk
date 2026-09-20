"use client";
import { useCallback, useEffect, useState } from "react";

type Report = { table: string; source: number; imported: number };

/** 数据迁移(SQLite → MySQL):仅 MySQL 模式显示。按表顺序全量导数,可选先清空目标。 */
export function MySqlMigrateCard() {
  const [isMysql, setIsMysql] = useState<boolean | null>(null);
  const [sqlitePath, setSqlitePath] = useState("data/evodesk.db");
  const [truncate, setTruncate] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [report, setReport] = useState<Report[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/db/dialect");
        const data = (await res.json()) as { dialect?: string };
        if (alive) setIsMysql(data.dialect === "mysql");
      } catch { if (alive) setIsMysql(false); }
    })();
    return () => { alive = false; };
  }, []);

  const migrate = useCallback(async () => {
    if (running) return;
    if (truncate && !window.confirm("将先清空 MySQL 目标表再导数,确认?")) return;
    setRunning(true);
    setMsg(null);
    setReport(null);
    try {
      const res = await fetch("/api/db/migrate-from-sqlite", {
        method: "POST",
        body: JSON.stringify({ sqlitePath: sqlitePath.trim(), truncate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: (data as { error?: string }).error ?? "迁移失败" });
        return;
      }
      const d = data as { report: Report[]; errors: string[] };
      setReport(d.report);
      const totalImported = d.report.reduce((a, r) => a + r.imported, 0);
      setMsg({
        ok: true,
        text: `迁移完成:共导入 ${totalImported} 行${d.errors.length ? `,${d.errors.length} 个警告(见下方)` : ""}`,
      });
    } catch {
      setMsg({ ok: false, text: "请求失败" });
    } finally {
      setRunning(false);
    }
  }, [running, sqlitePath, truncate]);

  if (isMysql === null) return null;
  if (!isMysql) {
    return (
      <div className="surface p-4 max-w-xl">
        <div className="text-sm font-medium mb-1">🗃️ 数据迁移(SQLite → MySQL)</div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          当前数据源:SQLite(默认)。要迁移到 MySQL,先在 .env 配置 DATABASE_URL=mysql://… 并重启,此卡片会自动出现。
        </div>
      </div>
    );
  }

  return (
    <div className="surface p-4 max-w-xl">
      <div className="text-sm font-medium mb-1">🗃️ 数据迁移(SQLite → MySQL)</div>
      <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
        当前数据源:MySQL ✅。指定本机 SQLite 文件(默认 data/evodesk.db),按表顺序全量导数;可选先清空目标表。写入前每条独立容错,失败逐条报告。
      </div>
      <label className="block mb-3">
        <span className="text-sm block mb-1">源 SQLite 文件路径</span>
        <input className="input w-full px-3 py-2 text-sm" value={sqlitePath} onChange={(e) => setSqlitePath(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
        <input type="checkbox" checked={truncate} onChange={(e) => setTruncate(e.target.checked)} />
        先清空 MySQL 目标表(推荐:目标为空库时可跳过)
      </label>
      <button onClick={() => void migrate()} disabled={running} className="accent-btn px-4 py-2 text-sm">
        {running ? "迁移中…(逐表执行,请稍候)" : "开始迁移"}
      </button>
      {msg && <div className="text-xs mt-2" style={{ color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</div>}
      {report && (
        <div className="mt-2 rounded p-2 max-h-48 overflow-auto text-xs" style={{ border: "1px solid var(--border)" }}>
          {report.map((r) => (
            <div key={r.table} className="flex justify-between py-0.5">
              <span>{r.table}</span>
              <span style={{ color: "var(--muted)" }}>源 {r.source} → 导入 {r.imported}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
