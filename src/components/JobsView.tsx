"use client";
import { useCallback, useEffect, useState } from "react";

type JobRow = {
  id: string; jobId: string; title: string; salaryDesc: string; city: string; area: string;
  brand: string; scale: string; experience: string; degree: string; labels: string;
  jd: string; url: string; fetchedAt: string;
};
type RunRow = { id: string; kind: string; status: string; output: string; jobCount: number; startedAt: string; finishedAt: string | null; params: string };

const KIND_LABEL: Record<string, string> = { scrape: "抓取", check: "环境检查", setup: "启动 Chrome", smoke: "连通自检" };
const STATUS_LABEL: Record<string, string> = { running: "运行中", ok: "完成", failed: "失败", timeout: "超时" };

function parseLabels(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return [];
  }
}

// 求职雷达:托管 scripts/boss_cdp_raw.py(Chrome CDP)。守门内置:单次 ≤10 页、页间随机延迟、隔离 profile。
// 仅限个人求职研究;接口未对线上验证,首次使用请先「启动 Chrome」登录再「连通自检」。
export function JobsView() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [keyword, setKeyword] = useState("AI Agent");
  const [city, setCity] = useState("上海");
  const [pages, setPages] = useState(3);
  const [noDetail, setNoDetail] = useState(false);
  const [q, setQ] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedJd, setExpandedJd] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      const data = (await res.json()) as { jobs?: JobRow[]; runs?: RunRow[] };
      setJobs(data.jobs ?? []);
      setRuns(data.runs ?? []);
    } catch {
      setError("加载失败,请刷新重试");
    }
  }, []);

  // 状态驱动轮询:有 running 记录时每 3s 重拉,状态推进自然停表
  const anyRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = window.setTimeout(() => { void load(); }, 3000);
    return () => window.clearTimeout(t);
  }, [anyRunning, runs, load]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const say = (kind: "ok" | "err", text: string) => {
    if (kind === "ok") setNotice(text);
    else setError(text);
    window.setTimeout(() => { setNotice(null); setError(null); }, 6000);
  };

  const start = async (body: Record<string, unknown>, okText: string) => {
    setError(null);
    try {
      const res = await fetch("/api/jobs/runs", { method: "POST", body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "启动失败");
        return;
      }
      say("ok", okText);
      void load();
    } catch {
      setError("启动请求失败");
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("删除该岗位记录?")) return;
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    void load();
  };

  const filtered = jobs.filter((j) => {
    if (cityFilter && !j.city.includes(cityFilter)) return false;
    if (!q.trim()) return true;
    return `${j.title} ${j.brand} ${j.salaryDesc} ${j.labels}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  const running = runs.find((r) => r.status === "running");
  const cities = [...new Set(jobs.map((j) => j.city).filter(Boolean))];

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-1">求职雷达</h1>
      <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
        通过 Chrome CDP 抓取 BOSS直聘搜索结果(隔离 profile,需本人登录)。仅限个人求职研究,请勿大规模抓取。
        接口按文档实现、未对线上验证 —— 首次使用:①「启动 Chrome」登录 zhipin.com → ②「连通自检」→ ③抓取。
      </p>

      <div className="surface p-3 mb-4 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input className="input text-sm w-44" placeholder="关键词" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <input className="input text-sm w-24" placeholder="城市" value={city} onChange={(e) => setCity(e.target.value)} />
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--muted)" }}>
            页数
            <select className="input text-sm w-16" value={pages} onChange={(e) => setPages(Number(e.target.value))}>
              {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--muted)" }}>
            <input type="checkbox" checked={noDetail} onChange={(e) => setNoDetail(e.target.checked)} /> 只抓列表(不进详情页)
          </label>
          <button className="accent-btn text-xs px-3 py-1.5" disabled={!keyword.trim() || !!running}
            onClick={() => void start({ kind: "scrape", keyword, city, pages, no_detail: noDetail }, "抓取已启动,进度见运行记录(页间随机延迟 12-22s,请耐心等待)")}>
            开始抓取
          </button>
          <span className="flex gap-1.5 ml-auto">
            <button className="ghost-btn text-xs px-2 py-1.5" disabled={!!running} onClick={() => void start({ kind: "setup" }, "Chrome 启动中,请在弹出的窗口登录 zhipin.com")}>启动 Chrome</button>
            <button className="ghost-btn text-xs px-2 py-1.5" disabled={!!running} onClick={() => void start({ kind: "check" }, "环境检查已启动")}>环境检查</button>
            <button className="ghost-btn text-xs px-2 py-1.5" disabled={!!running} onClick={() => void start({ kind: "smoke" }, "连通自检已启动")}>连通自检</button>
          </span>
        </div>
        {running && (
          <div className="text-xs p-2 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
            ⏳ {KIND_LABEL[running.kind] ?? running.kind}运行中(已输出 {running.output.length} 字符)—— 运行结束自动入库。
          </div>
        )}
        {runs.filter((r) => r.status !== "running").slice(0, 3).map((r) => (
          <details key={r.id} className="text-xs">
            <summary className="cursor-pointer" style={{ color: r.status === "ok" ? "var(--ok)" : "var(--danger)" }}>
              {KIND_LABEL[r.kind] ?? r.kind} · {STATUS_LABEL[r.status] ?? r.status}
              {r.status === "ok" && r.kind === "scrape" && ` · 入库 ${r.jobCount} 条`}
              · {new Date(r.startedAt).toLocaleTimeString()}
            </summary>
            <pre className="mt-1 p-2 rounded whitespace-pre-wrap max-h-40 overflow-auto" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>{r.output.slice(-2000) || "(无输出)"}</pre>
          </details>
        ))}
        {(error || notice) && (
          <div className="text-xs" style={{ color: error ? "var(--danger)" : "var(--ok)" }}>{error ?? notice}</div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <input className="input text-sm flex-1 min-w-40" placeholder="搜索岗位/公司/薪资…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input text-sm w-28" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
          <option value="">全部城市</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <a className="ghost-btn text-xs px-2 py-1.5" href={cityFilter ? `/api/jobs/export?city=${encodeURIComponent(cityFilter)}` : "/api/jobs/export"}>导出 CSV</a>
        <span className="text-xs" style={{ color: "var(--muted)" }}>共 {filtered.length} 条</span>
      </div>

      {filtered.length === 0 ? (
        <div className="surface p-6 text-sm text-center" style={{ color: "var(--muted)" }}>
          还没有岗位数据 —— 配置好环境后点击「开始抓取」。
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((j) => {
            const labels = parseLabels(j.labels);
            return (
              <div key={j.id} className="surface p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{j.title}</span>
                  <span style={{ color: "var(--accent)" }}>{j.salaryDesc}</span>
                  <span style={{ color: "var(--muted)" }}>{j.city}{j.area ? ` · ${j.area}` : ""}</span>
                  <span>{j.brand}</span>
                  {j.scale && <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>{j.scale}</span>}
                  {(j.experience || j.degree) && <span className="text-xs" style={{ color: "var(--muted)" }}>{[j.experience, j.degree].filter(Boolean).join(" · ")}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {j.url && <a href={j.url} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "var(--accent)" }}>打开 ↗</a>}
                    {j.jd && (
                      <button className="ghost-btn text-xs px-1.5 py-0.5" onClick={() => setExpandedJd(expandedJd === j.id ? null : j.id)}>
                        {expandedJd === j.id ? "收起 JD" : "看 JD"}
                      </button>
                    )}
                    <button className="ghost-btn text-xs px-1.5 py-0.5" style={{ color: "var(--danger)" }} onClick={() => void remove(j.id)}>删</button>
                  </span>
                </div>
                {labels.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-1">
                    {labels.map((l) => <span key={l} className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>{l}</span>)}
                  </div>
                )}
                {expandedJd === j.id && (
                  <pre className="mt-2 p-2 rounded text-xs whitespace-pre-wrap max-h-64 overflow-auto" style={{ background: "var(--surface-2)" }}>{j.jd}</pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
