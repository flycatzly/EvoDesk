import { describe, it, expect } from "vitest";
import { toApiTask } from "./serialize";
import type { tasks } from "@/lib/db/schema";

type TaskRow = typeof tasks.$inferSelect;

const row = (tags: string): TaskRow => ({
  id: "t1",
  title: "T",
  description: "",
  tags,
  complexity: "M",
  priority: 1,
  dueDate: null,
  projectId: null,
  recurringRuleId: null,
  status: "inbox",
  flowTemplateId: null,
  outcomeNote: null,
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
});

// 任务 API 形状契约(Task 11 评审固化的永久测试):tags 一律 string[],其余键为 drizzle 行的 camelCase。
describe("toApiTask", () => {
  it("JSON 数组解析为 string[]", () => {
    expect(toApiTask(row('["写作","研究"]')).tags).toEqual(["写作", "研究"]);
  });
  it.each(['"abc"', "null", '{"a":1}'])("非数组 JSON(%s)→ []", (tags) => {
    expect(toApiTask(row(tags)).tags).toEqual([]);
  });
  it("损坏 JSON → []", () => {
    expect(toApiTask(row("{oops")).tags).toEqual([]);
  });
  it("本就合法的 tags 保持不变", () => {
    expect(toApiTask(row("[]")).tags).toEqual([]);
  });
  it("其余键原样透传(不重命名、不丢键)", () => {
    const out = toApiTask(row('["写作"]'));
    expect(out.id).toBe("t1");
    expect(out.dueDate).toBeNull();
    expect(out.createdAt).toBe("2026-09-06T00:00:00.000Z");
  });
});
