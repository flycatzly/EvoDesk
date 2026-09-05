export interface RoutableTemplate {
  id: string; tags: string; complexity: string; status: string;
  statSuccessRate: number; statAvgCostUsd: number; statLastUsedAt: string | null;
}

export function scoreTemplate(t: RoutableTemplate, taskTags: string[], taskComplexity: string, now: Date): number {
  const tTags = JSON.parse(t.tags) as string[];
  const overlap = tTags.filter((x) => taskTags.includes(x)).length;
  let s = overlap * 3 + (t.complexity === taskComplexity ? 2 : 0) + (t.statSuccessRate ?? 0);
  if (t.statLastUsedAt && now.getTime() - new Date(t.statLastUsedAt).getTime() < 30 * 86_400_000) s += 0.5;
  return s;
}

export function routeTemplate<T extends RoutableTemplate>(templates: T[], taskTags: string[], taskComplexity: string, now: Date = new Date()): T | null {
  const active = templates.filter((t) => t.status === "active");
  if (active.length === 0) return null;
  const scored = active.map((t) => ({ t, s: scoreTemplate(t, taskTags, taskComplexity, now) }));
  const max = Math.max(...scored.map((x) => x.s));
  const top = scored.filter((x) => x.s === max).sort((a, b) => a.t.statAvgCostUsd - b.t.statAvgCostUsd);
  return top[0].t;
}
