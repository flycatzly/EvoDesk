import { describe, it, expect } from "vitest";
import { scoreTemplate, routeTemplate } from "./router";

const t = (o: Partial<Parameters<typeof scoreTemplate>[0]>): Parameters<typeof scoreTemplate>[0] => ({
  id: "t", tags: "[]", complexity: "M", status: "active",
  statSuccessRate: 0, statAvgCostUsd: 0, statLastUsedAt: null, ...o,
});
const NOW = new Date("2026-09-06T00:00:00Z");

describe("scoreTemplate", () => {
  it("标签交集×3 + 复杂度匹配×2 + 成功率", () => {
    const s = scoreTemplate(t({ tags: '["写作","研究"]', complexity: "L", statSuccessRate: 0.8 }), ["写作"], "L", NOW);
    expect(s).toBeCloseTo(3 + 2 + 0.8);
  });
  it("30 天内使用过 +0.5", () => {
    const s1 = scoreTemplate(t({ statLastUsedAt: "2026-09-01T00:00:00Z" }), [], "M", NOW);
    const s2 = scoreTemplate(t({ statLastUsedAt: "2026-01-01T00:00:00Z" }), [], "M", NOW);
    expect(s1 - s2).toBeCloseTo(0.5);
  });
});

describe("routeTemplate", () => {
  it("只考虑 active;打分并列取平均成本低者", () => {
    const a = t({ id: "a", tags: '["写作"]', statAvgCostUsd: 0.5 });
    const b = t({ id: "b", tags: '["写作"]', statAvgCostUsd: 0.1 });
    const c = t({ id: "c", status: "retired", tags: '["写作"]', statAvgCostUsd: 0 });
    expect(routeTemplate([a, b, c], ["写作"], "M", NOW)?.id).toBe("b");
  });
  it("无候选返回 null(调用方 fallback;experimental 不进自动路由,设计 §9)", () => {
    expect(routeTemplate([], [], "M", NOW)).toBeNull();
    expect(routeTemplate([t({ status: "retired" })], [], "M", NOW)).toBeNull();
    expect(routeTemplate([t({ status: "experimental" })], [], "M", NOW)).toBeNull();
  });
});
