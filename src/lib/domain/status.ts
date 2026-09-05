export const TASK_STATUSES = [
  "inbox", "triaging", "ready", "running", "waiting_human",
  "review", "done", "archived", "canceled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  inbox: ["triaging", "ready", "canceled"],
  triaging: ["ready", "inbox", "canceled"],
  ready: ["running", "inbox", "canceled"],
  running: ["waiting_human", "ready", "canceled"],
  waiting_human: ["running", "review", "ready", "canceled"],
  review: ["done", "running", "canceled"],
  done: ["archived"],
  archived: [],
  canceled: ["inbox"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}
