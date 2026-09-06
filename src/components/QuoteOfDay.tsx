"use client";
import { quoteOfDay } from "@/lib/quotes";

export function QuoteOfDay() {
  return <span className="hidden md:inline text-sm" style={{ color: "var(--muted)" }}>{quoteOfDay()}</span>;
}
