// src/lib/domain/script-security.ts
import path from "node:path";

// 启发式告警,非安全保证(规格 §10.2)。
export const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdel(\.com)?\b[^|;&]*\/[sq]/i, /\b(rd|rmdir)(\.com)?\b[^|;&]*\/s\b/i,
  /\brm\s+(-[a-z]*[rf][a-z]*\s+|--recursive\b)/i,
  /\bformat(\.com)?\b[^|;&]*\s[a-z]:/i, /\bformat-volume\b/i,
  /remove-item\b(?=[^|;&]*-r(ec(urse)?)?\b)(?=[^|;&]*-fo(rce)?\b)/i,
  /\breg(\.exe)?\s+delete\b/i,
  /\bshutdown\b/i, /\brestart-computer\b/i, /\bmkfs\b/i, /\bdiskpart\b/i, /\bbcdedit\b/i,
  /\brobocopy\b[^|;&]*\/mir\b/i,
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
/** 须传【未渲染】的模板命令:渲染后 {{ 消失,含 AI 产出变量的命令会被漏放行,违反规格 §10.2.2(AI 生成命令必须人工过目)。 */
export function confirmRequired(commandTemplate: string | undefined, executor: { autoApprove: boolean }): boolean {
  return !executor.autoApprove || /\{\{/.test(commandTemplate ?? "");
}
