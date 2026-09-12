import path from "node:path";
import { renderPrompt } from "@/lib/domain/executor-resolve";
import { checkWhitelist, DEFAULT_WHITELIST } from "@/lib/domain/script-security";
import { executeScript } from "@/lib/domain/script-runner";

export interface QuickActionRow { id: string; name: string; type: string; payload: string; shell: string | null; enabled: boolean }

export function renderQuickPayload(action: { type: string; payload: string }, task?: { title: string }): string {
  if (action.type === "command") return renderPrompt(action.payload, { task: { title: task?.title ?? "", description: "" }, prevOutput: "" });
  return action.payload;
}

export async function runCommandAction(command: string, shell: string, workingDir: string): Promise<{ output: string; exitCode: number | null; durationMs: number; status: "ok" | "failed" | "timeout" }> {
  // v1:超时固定 60s(schema 无 per-action timeout 字段,后续需要再加列)
  const r = await executeScript(shell, command, { cwd: workingDir, timeoutMs: 60_000 });
  return { output: r.output, exitCode: r.exitCode, durationMs: r.durationMs, status: r.timedOut ? "timeout" : r.exitCode === 0 ? "ok" : "failed" };
}

export function resolveWorkingDir(candidate: string | null | undefined): string {
  const dir = candidate ? path.resolve(candidate) : path.resolve("data", "sandbox");
  if (!checkWhitelist(dir, DEFAULT_WHITELIST)) throw new Error(`工作目录不在白名单:${dir}`);
  return dir;
}
