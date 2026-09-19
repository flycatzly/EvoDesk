"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type GNode = { id: string; name: string; tags: string[]; degree: number };
type GEdge = { source: string; target: string };
type GraphResp = { root: string; tag: string; tags: string[]; total: number; orphanCount: number; nodes: GNode[]; edges: GEdge[] };

// 知识图谱(力导向):md 文件为节点、[[双链]] 为边;节点大小=连接数,颜色=标签哈希。
// 纯 canvas 实现(无三方库):每帧斥力+弹簧+向心,稳定后自动降帧;拖拽节点/滚轮缩放。
export function KnowledgeGraph({ root, defaultCollapsed = true }: { root: string; defaultCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<GraphResp | null>(null);
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string; tags: string[]; x: number; y: number } | null>(null);
  const [accentColor, setAccentColor] = useState("#6366f1");
  // 视图变换
  const view = useRef({ ox: 0, oy: 0, scale: 1 });
  const dragNode = useRef<string | null>(null);
  const simRun = useRef(0);

  const load = useCallback(async () => {
    if (!root) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ root, ...(tag ? { tag } : {}) });
      const res = await fetch(`/api/vault/graph?${qs}`);
      const d = await res.json();
      if (!res.ok) { setError((d as { error?: string }).error ?? "加载失败"); return; }
      setData(d as GraphResp);
      simRun.current = 120; // 帧数预算
      view.current = { ox: 0, oy: 0, scale: 1 };
    } catch {
      setError("请求失败");
    } finally {
      setLoading(false);
    }
  }, [root, tag]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(raf);
  }, [load]);

  // canvas fillStyle 不支持 CSS 变量,读取计算值
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAccentColor(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#6366f1"));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 力导向模拟 + 绘制(accentColor 变化无需重启动画,故不列入依赖)
  const simRef = useRef<{ x: number; y: number; vx: number; vy: number; id: string }[]>([]);
  useEffect(() => {
    if (!data) return;
    const W = 900;
    const H = 520;
    // 初始:环形摆放
    simRef.current = data.nodes.map((n, i) => {
      const a = (i / data.nodes.length) * Math.PI * 2;
      return { id: n.id, x: W / 2 + Math.cos(a) * 220, y: H / 2 + Math.sin(a) * 180, vx: 0, vy: 0 };
    });
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const tick = () => {
      const sim = simRef.current;
      // 斥力(库仑近似,O(n²),n≤800 可接受;稳定后帧数预算耗尽即停)
      if (simRun.current > 0) {
        simRun.current--;
        for (let i = 0; i < sim.length; i++) {
          for (let j = i + 1; j < sim.length; j++) {
            const a = sim[i]; const b = sim[j];
            let dx = a.x - b.x; let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
            const f = 2200 / d2;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f; const fy = (dy / d) * f;
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
          }
        }
        // 弹簧(边)
        for (const e of data.edges) {
          const a = sim.find((s) => s.id === e.source);
          const b = sim.find((s) => s.id === e.target);
          if (!a || !b) continue;
          const dx = b.x - a.x; const dy = b.y - a.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          const f = (d - 90) * 0.01;
          a.vx += (dx / d) * f; a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
        }
        // 向心力 + 阻尼 + 积分
        for (const s of sim) {
          s.vx += (W / 2 - s.x) * 0.002;
          s.vy += (H / 2 - s.y) * 0.002;
          s.vx *= 0.85; s.vy *= 0.85;
          s.x += Math.max(-20, Math.min(20, s.vx));
          s.y += Math.max(-20, Math.min(20, s.vy));
        }
      }
      // 绘制
      const v = view.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.translate(v.ox, v.oy);
      ctx.scale(v.scale, v.scale);
      ctx.strokeStyle = "rgba(128,128,160,0.25)";
      ctx.beginPath();
      for (const e of data.edges) {
        const a = sim.find((s) => s.id === e.source);
        const b = sim.find((s) => s.id === e.target);
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      for (const s of sim) {
        const n = byId.get(s.id);
        const r = 4 + Math.min(10, Math.sqrt(n?.degree ?? 1) * 2);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n?.id.startsWith("__virtual__") ? "rgba(128,128,160,0.4)" : accentColor;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const hit = useCallback((mx: number, my: number) => {
    const v = view.current;
    const x = (mx - v.ox) / v.scale;
    const y = (my - v.oy) / v.scale;
    for (const s of simRef.current) {
      if (Math.hypot(s.x - x, s.y - y) < 10) return s.id;
    }
    return null;
  }, []);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (dragNode.current) {
      const s = simRef.current.find((n) => n.id === dragNode.current);
      const v = view.current;
      if (s) { s.x = (mx - v.ox) / v.scale; s.y = (my - v.oy) / v.scale; s.vx = 0; s.vy = 0; }
      return;
    }
    const id = hit(mx, my);
    if (id && data) {
      const n = data.nodes.find((x) => x.id === id);
      if (n) setHover({ name: n.name, tags: n.tags, x: mx, y: my });
    } else setHover(null);
  };
  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    dragNode.current = hit(e.clientX - rect.left, e.clientY - rect.top);
  };
  const onUp = () => { dragNode.current = null; };
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const v = view.current;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    v.scale = Math.max(0.3, Math.min(4, v.scale * factor));
  };

  if (collapsed) {
    return (
      <div className="surface p-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">🕸️ 知识图谱</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>双链网络可视化(默认收起以省资源)</span>
          <button className="accent-btn text-xs px-2.5 py-1 ml-auto" onClick={() => { setCollapsed(false); void load(); }}>展开图谱</button>
        </div>
      </div>
    );
  }

  return (
    <div className="surface p-3 mb-4">
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <span className="text-sm font-medium">🕸️ 知识图谱</span>
        <button className="ghost-btn text-xs px-1.5 py-0.5" onClick={() => setCollapsed(true)} title="收起">▴ 收起</button>
        <select className="input text-xs max-w-40" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="按标签筛选">
          <option value="">全部标签</option>
          {(data?.tags ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="ghost-btn text-xs px-2 py-1" onClick={() => void load()} disabled={loading}>重新布局</button>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {data ? `${data.nodes.length} 节点 · ${data.edges.length} 链接 · 孤立 ${data.orphanCount}` : ""}
        </span>
        <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>拖节点 · 滚轮缩放 · 悬停看标签</span>
      </div>
      {error && <div className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</div>}
      {loading && <div className="text-xs" style={{ color: "var(--muted)" }}>构建中…</div>}
      <canvas
        ref={canvasRef}
        width={900}
        height={520}
        className="w-full rounded cursor-grab"
        style={{ background: "var(--surface-2)", touchAction: "none" }}
        onMouseMove={onMove}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseLeave={() => { onUp(); setHover(null); }}
        onWheel={onWheel}
      />
      {hover && (
        <div className="text-xs mt-1.5">
          <span className="font-medium">{hover.name}</span>
          {hover.tags.length > 0 && <span className="ml-2" style={{ color: "var(--muted)" }}>🏷️ {hover.tags.join(" / ")}</span>}
        </div>
      )}
    </div>
  );
}
