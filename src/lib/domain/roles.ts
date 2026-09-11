// 执行器角色白名单:执行器创建/PATCH/档案派生共用(role 属执行器域,不属 provider profiles)
export const EXECUTOR_ROLES = ["triage", "planner", "executor", "reviewer", "evolution"] as const;
export type ExecutorRole = (typeof EXECUTOR_ROLES)[number];
