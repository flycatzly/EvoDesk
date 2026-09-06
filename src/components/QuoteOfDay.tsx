"use client";
import { useEffect, useState } from "react";
import { quoteOfDay } from "@/lib/quotes";

export function QuoteOfDay() {
  const [quote, setQuote] = useState<string | null>(null);
  useEffect(() => {
    // 静态预渲染会把构建当天的语句固化进 HTML,水合后当天语句可能不同;
    // 与 Clock 一致:挂载后再计算,推迟到下一帧 setState 以符合 react-hooks/set-state-in-effect
    const raf = requestAnimationFrame(() => setQuote(quoteOfDay()));
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span className="hidden md:inline text-sm" style={{ color: "var(--muted)" }}>{quote ?? ""}</span>;
}
