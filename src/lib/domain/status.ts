export const TASK_STATUSES = [
  "inbox", "triaging", "ready", "running", "waiting_human",
  "review", "done", "archived", "canceled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  // inbox/triaging/ready → done:今日清单"勾选完成"(未进入流程的任务可直接标记完成)
  // done → ready:取消勾选/重新打开
  // running/waiting_human 特意不直达 done:有活跃 flow_run,直接完成会留孤儿 run(须走流程/取消)
  inbox: ["triaging", "ready", "canceled", "done"],
  triaging: ["ready", "inbox", "canceled", "done"],
  ready: ["running", "inbox", "canceled", "done"],
  // review 由 Plan 2 runner 完成聚合驱动(规格 §6);手动流转仍走 waiting_human
  running: ["waiting_human", "review", "ready", "canceled"],
  waiting_human: ["running", "review", "ready", "canceled"],
  review: ["done", "running", "canceled"],
  done: ["archived", "ready"],
  archived: [],
  canceled: ["inbox"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}
