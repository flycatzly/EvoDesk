import type { Db } from "@/lib/db/test-util";
import { executors } from "@/lib/db/schema";
import { getStepDefs, type StepDef } from "./step-def";

// 测试与下游(Task 5/6 runner)统一从本模块导入;step-def.ts 持有定义
export { getStepDefs, type StepDef };

export interface ResolvedExecutor {
  id: string; name: string; type: string; role: string; enabled: boolean;
  model: string | null; apiBase: string | null; protocol: string | null;
  apiKeyRef: string | null; costPer1kInput: number; costPer1kOutput: number;
  shell: string | null; workingDir: string | null; timeoutMs: number; autoApprove: boolean;
}

/** 角色精确匹配优先;否则回退 executor 角色的启用执行器(调用方可比较 resolved.role !== role 检测降级);无则 null。 */
export function resolveStepExecutor(db: Db, role: string): ResolvedExecutor | null {
  const all = db.select().from(executors).all() as unknown as ResolvedExecutor[];
  const enabled = all.filter((e) => e.type === "llm" && e.enabled);
  // 回退链保证"自检/审查"这类角色绑定的步骤在缺少专属角色执行器时仍能运行
  // (实际使用的模型记录在 step_runs.model);全部 LLM 禁用才返回 null。
  return (
    enabled.find((e) => e.role === role) ??
    enabled.find((e) => e.role === "executor") ??
    enabled.find((e) => e.role === "planner") ??
    enabled.find((e) => e.role === "triage") ??
    enabled[0] ??
    null
  );
}

export function renderPrompt(
  prompt: string,
  vars: { task: { title: string; description: string }; prevOutput: string },
): string {
  return prompt
    .replaceAll("{{task.title}}", vars.task.title)
    .replaceAll("{{task.description}}", vars.task.description)
    .replaceAll("{{prev_output}}", vars.prevOutput);
}
