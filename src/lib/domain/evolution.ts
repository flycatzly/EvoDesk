import { eq, desc } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { flowRuns, stepRuns, flowTemplates, evolutionEvents } from "@/lib/db/schema";
import type { StepDef } from "@/lib/domain/step-def";

export class EvolutionError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
const now = () => new Date().toISOString();

export interface StepHotspot { stepIndex: number; stepName: string; runs: number; rejected: number; manualOverrides: number; avgCostUsd: number }

export function collectHotspots(db: Db, templateId: string): StepHotspot[] {
  const runs = db.select().from(flowRuns).where(eq(flowRuns.templateId, templateId)).all() as (typeof flowRuns.$inferSelect)[];
  if (runs.length === 0) return [];
  const byRun = new Map(runs.map((r) => [r.id, r]));
  const steps = db.select().from(stepRuns).all() as (typeof stepRuns.$inferSelect)[];
  const acc = new Map<number, StepHotspot & { costSum: number }>();
  for (const s of steps) {
    if (!byRun.has(s.runId)) continue;
    const h = acc.get(s.stepIndex) ?? { stepIndex: s.stepIndex, stepName: s.stepName, runs: 0, rejected: 0, manualOverrides: 0, avgCostUsd: 0, costSum: 0 };
    h.runs++;
    if (s.rejected > 0) h.rejected++;
    if (s.feedbackNote === "manual_override") h.manualOverrides++;
    h.costSum += s.costUsd;
    acc.set(s.stepIndex, h);
  }
  return [...acc.values()].map(({ costSum, ...h }) => ({ ...h, avgCostUsd: h.runs ? costSum / h.runs : 0 }))
    .sort((a, b) => a.stepIndex - b.stepIndex);
}

export function canAnalyze(db: Db, templateId: string, threshold = 5): boolean {
  const last = db.select().from(evolutionEvents).where(eq(evolutionEvents.templateId, templateId)).orderBy(desc(evolutionEvents.ts)).all()[0] as typeof evolutionEvents.$inferSelect | undefined;
  const runs = db.select().from(flowRuns).where(eq(flowRuns.templateId, templateId)).all() as (typeof flowRuns.$inferSelect)[];
  const done = runs.filter((r) => r.status === "done");
  if (!last) return done.length >= threshold;
  return done.filter((r) => r.startedAt > last.ts).length >= threshold;
}

// ── 变体 ops(纯函数)──
export type VariantOp =
  | { op: "remove_step"; index: number }
  | { op: "add_step"; after_index: number; step: StepDef }
  | { op: "replace_executor_role"; index: number; executor_role: string }
  | { op: "edit_prompt"; index: number; prompt: string }
  | { op: "reorder"; from: number; to: number };

export function applyVariant(steps: StepDef[], ops: VariantOp[]): StepDef[] {
  const out = steps.map((s) => ({ ...s }));
  for (const op of ops) {
    switch (op.op) {
      case "remove_step": {
        if (op.index < 0 || op.index >= out.length) throw new EvolutionError(`remove_step 越界:${op.index}`);
        out.splice(op.index, 1);
        break;
      }
      case "add_step": {
        if (op.after_index < -1 || op.after_index > out.length) throw new EvolutionError(`add_step 越界:${op.after_index}`);
        out.splice(op.after_index + 1, 0, { ...op.step });
        break;
      }
      case "replace_executor_role": {
        const s = out[op.index];
        if (!s) throw new EvolutionError(`replace_executor_role 越界:${op.index}`);
        s.executorRole = op.executor_role;
        break;
      }
      case "edit_prompt": {
        const s = out[op.index];
        if (!s) throw new EvolutionError(`edit_prompt 越界:${op.index}`);
        s.prompt = op.prompt;
        break;
      }
      case "reorder": {
        if (op.from < 0 || op.from >= out.length || op.to < 0 || op.to >= out.length) throw new EvolutionError(`reorder 越界`);
        const [m] = out.splice(op.from, 1);
        out.splice(op.to, 0, m);
        break;
      }
      default:
        throw new EvolutionError(`未知 op:${(op as { op: string }).op}`);
    }
  }
  return out;
}

function logEvent(db: Db, kind: string, templateId: string | null, relatedTemplateId: string | null, reason: string, detail: unknown) {
  db.insert(evolutionEvents).values({
    id: crypto.randomUUID(), ts: now(), kind, templateId, relatedTemplateId,
    reason: reason.slice(0, 500), detail: JSON.stringify(detail ?? {}),
  }).run();
}

export function promoteTemplate(db: Db, variantId: string): void {
  const variant = db.select().from(flowTemplates).where(eq(flowTemplates.id, variantId)).all()[0] as typeof flowTemplates.$inferSelect | undefined;
  if (!variant) throw new EvolutionError("模板不存在", 404);
  if (variant.status !== "experimental") throw new EvolutionError("仅实验模板可晋升");
  const siblings = db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[];
  for (const s of siblings) {
    if (s.id !== variant.id && s.lineageId === variant.lineageId && s.complexity === variant.complexity && s.status === "active") {
      db.update(flowTemplates).set({ status: "retired", updatedAt: now() }).where(eq(flowTemplates.id, s.id)).run();
      logEvent(db, "retired", s.id, variant.id, `被 ${variant.name} 晋升取代`, { auto: true });
    }
  }
  db.update(flowTemplates).set({ status: "active", updatedAt: now() }).where(eq(flowTemplates.id, variant.id)).run();
  logEvent(db, "promoted", variant.id, variant.parentId, "实验模板晋升为活跃", {});
}

export function retireTemplate(db: Db, templateId: string, reason: string): void {
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, templateId)).all()[0] as typeof flowTemplates.$inferSelect | undefined;
  if (!tpl) throw new EvolutionError("模板不存在", 404);
  if (tpl.status !== "active" && tpl.status !== "experimental") throw new EvolutionError("模板已退役");
  db.update(flowTemplates).set({ status: "retired", updatedAt: now() }).where(eq(flowTemplates.id, templateId)).run();
  logEvent(db, "retired", templateId, null, reason, {});
}
