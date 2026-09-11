// src/lib/domain/script-security.ts
import path from "node:path";

export const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdel\s+\/[sq]/i, /\brd\s+\/s/i, /\brmdir\s+\/s/i, /\brm\s+(-[rf]|--recursive)/i,
  /\bformat\b/i, /remove-item\s+.*-recurse\s+.*-force/i, /\breg\s+delete\b/i,
  /\bshutdown\b/i, /\bmkfs\b/i, /\bdiskpart\b/i, /\bbcdedit\b/i,
];
export function scanRisk(command: string): string[] {
  return DESTRUCTIVE_PATTERNS.filter((re) => re.test(command)).map((re) => re.source);
}
export const DEFAULT_WHITELIST = [path.join(process.cwd(), "data", "sandbox")];
export function isPathWithin(child: string, parent: string): boolean {
  const c = path.resolve(child).toLowerCase();
  const p = path.resolve(parent).toLowerCase();
  return c === p || c.startsWith(p + path.sep);
}
export function checkWhitelist(workingDir: string, whitelist: string[]): boolean {
  return whitelist.some((dir) => isPathWithin(workingDir, path.resolve(dir)));
}
// 判定含 {{ 未渲染变量或未开启自动批准 → 需人工确认(规格 §10.2:AI 生成命令必须过目)
export function confirmRequired(stepDef: { command?: string }, executor: { autoApprove: boolean }): boolean {
  // 调用方(Task 10)可传渲染前模板命令或渲染后命令,{{ 检查对两者皆有效:渲染会替换掉 token
  const dynamic = /\{\{/.test(stepDef.command ?? "");
  return !executor.autoApprove || dynamic;
}
