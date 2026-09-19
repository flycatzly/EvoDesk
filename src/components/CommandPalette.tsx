"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = { type: string; id: string; title: string; sub: string; href: string };

const TYPE_COLOR: Record<string, string> = {
  任务: "var(--accent)", 笔记: "var(--ok)", 链接: "var(--warn)",
  工作台: "var(--accent-2)", 流程: "var(--danger)", 页面: "var(--muted)",
};
// 动作动词:输入 > 前缀时优先直达动作
const ACTIONS: { title: string; href: string }[] = [
  { title: "> 新建任务(去收件箱)", href: "/inbox" },
  { title: "> 切换主题(去设置)", href: "/settings" },
  { title: "> 创建快照备份", href: "/settings" },
];

/** 全局 ⌘K/Ctrl+K 命令面板:搜任务/笔记/链接/工作台/流程/页面,方向键+回车导航。 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // 全局快捷键:⌘K / Ctrl+K 开关,Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 打开时聚焦并重置
  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      const raf = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // 防抖搜索
  useEffect(() => {
    const mySeq = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { hits?: Hit[] };
        if (mySeq !== seq.current) return; // 过期响应丢弃
        const actionHits: Hit[] = ACTIONS.filter((a) => !q || a.title.toLowerCase().includes(q.toLowerCase()) || q.startsWith(">"))
          .map((a, i) => ({ type: "动作", id: `a${i}`, title: a.title, sub: "", href: a.href }));
        const list = q.startsWith(">") ? [...actionHits, ...(data.hits ?? [])] : [...(data.hits ?? []), ...actionHits.filter((a) => a.title.toLowerCase().includes(q.toLowerCase()))];
        setHits(list.slice(0, 20));
        setActive(0);
      } catch { /* 网络失败保持旧结果 */ }
      finally { if (mySeq === seq.current) setLoading(false); }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const go = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active].href); }
  };

  const grouped = useMemo(() => hits, [hits]);

  return (
    <>
      {/* 顶栏提示按钮(也可点击打开) */}
      <button
        className="hidden md:flex items-center gap-1.5 text-xs px-2 py-1 rounded"
        style={{ background: "var(--surface-2)", color: "var(--muted)" }}
        onClick={() => setOpen(true)}
        aria-label="打开命令面板"
        title="搜索一切 (Ctrl+K)"
      >
        ⌘K
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh]" style={{ background: "rgba(0,0,0,.45)" }} onClick={() => setOpen(false)}>
          <div ref={boxRef} className="w-[560px] max-w-[92vw] surface shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 p-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <span style={{ color: "var(--muted)" }}>🔍</span>
              <input
                ref={inputRef}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: "var(--text)" }}
                placeholder="搜索任务 / 笔记 / 链接 / 页面…(输入 > 看动作)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
              />
              {loading && <span className="text-xs" style={{ color: "var(--muted)" }}>…</span>}
              <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>Esc</span>
            </div>
            <div className="max-h-[52vh] overflow-y-auto py-1">
              {grouped.length === 0 && !loading && (
                <div className="text-sm text-center py-6" style={{ color: "var(--muted)" }}>没有匹配结果</div>
              )}
              {grouped.map((h, i) => (
                <button
                  key={`${h.type}-${h.id}`}
                  className="w-full text-left px-3 py-2 flex items-center gap-2.5 text-sm"
                  style={i === active ? { background: "var(--surface-2)" } : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h.href)}
                >
                  <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: "var(--surface-2)", color: TYPE_COLOR[h.type] ?? "var(--muted)" }}>{h.type}</span>
                  <span className="truncate flex-1">{h.title}</span>
                  {h.sub && <span className="text-xs truncate max-w-32" style={{ color: "var(--muted)" }}>{h.sub}</span>}
                </button>
              ))}
            </div>
            <div className="px-3 py-1.5 text-xs flex gap-3" style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}>
              <span>↑↓ 选择</span><span>↵ 打开</span><span>输入 &gt; 执行动作</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
