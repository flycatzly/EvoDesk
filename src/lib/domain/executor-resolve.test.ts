import { describe, it, expect } from "vitest";
import { getStepDefs, resolveStepExecutor, renderPrompt } from "./executor-resolve";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { executors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

describe("getStepDefs", () => {
  it("解析模板 steps JSON", () => {
    const defs = getStepDefs('[{"name":"a","type":"llm","executorRole":"executor","prompt":"p"}]');
    expect(defs[0]).toMatchObject({ name: "a", type: "llm" });
  });
});

describe("resolveStepExecutor", () => {
  it("角色精确匹配优先,回退 executor 角色,无则 null", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    // 种子:快速模型 role=triage(disabled)、强模型 role=planner(disabled)——默认全禁用 → null
    expect(resolveStepExecutor(db, "planner")).toBeNull();
    db.update(executors).set({ enabled: true }).where(eq(executors.name, "强模型")).run();
    expect(resolveStepExecutor(db, "planner")?.name).toBe("强模型");
    // 无 reviewer → 回退 executor 角色
    db.update(executors).set({ enabled: true }).where(eq(executors.name, "快速模型")).run();
    db.update(executors).set({ role: "executor" }).where(eq(executors.name, "快速模型")).run();
    expect(resolveStepExecutor(db, "reviewer")?.name).toBe("快速模型");
  });
});

describe("renderPrompt", () => {
  it("替换任务与上一步产出变量,未知变量原样保留", () => {
    const out = renderPrompt("任务:{{task.title}}\n描述:{{task.description}}\n上一步:\n{{prev_output}}\n{{unknown}}", {
      task: { title: "T", description: "D" },
      prevOutput: "P",
    });
    expect(out).toBe("任务:T\n描述:D\n上一步:\nP\n{{unknown}}");
  });
});
