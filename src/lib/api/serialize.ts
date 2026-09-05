import type { tasks } from "@/lib/db/schema";

type TaskRow = typeof tasks.$inferSelect;

// 任务 API 形状契约:tags 一律为 string[](DB 中是 JSON 文本);其余键保持 drizzle 行的 camelCase。
// 非数组/损坏数据一律归一为 [],避免下游(如 TriageCard 的 tags.join)拿到字符串崩溃。
// 注意返回类型是 Omit 而非 TaskRow & {...} —— 交叉类型会要求 tags 同时是 string 和 string[],不可满足。
export function toApiTask(row: TaskRow): Omit<TaskRow, "tags"> & { tags: string[] } {
  try {
    const parsed = JSON.parse(row.tags);
    return { ...row, tags: Array.isArray(parsed) ? parsed : [] };
  } catch {
    return { ...row, tags: [] };
  }
}
