"use client";
import { useEffect, useState } from "react";

export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // 首帧立即取时 + 每秒刷新;推迟到下一帧调用 setState 以符合 react-hooks/set-state-in-effect
    const tick = () => setNow(new Date());
    const raf = requestAnimationFrame(tick);
    const t = setInterval(tick, 1000);
    return () => { cancelAnimationFrame(raf); clearInterval(t); };
  }, []);
  if (!now) return <span className="text-sm" style={{ color: "var(--muted)" }} />;
  return (
    <span className="text-sm tabular-nums" style={{ color: "var(--muted)" }}>
      {now.toLocaleTimeString("zh-CN", { hour12: false })} · {now.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" })}
    </span>
  );
}
