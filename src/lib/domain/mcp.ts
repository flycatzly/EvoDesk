// 本机 MCP 服务器扫描:读取常见客户端配置文件里的 mcpServers 段(Claude Desktop / Claude Code 等)。
// 只读解析,不连接、不执行任何 MCP 服务器。
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { expandHome } from "./skills";

export type McpServer = { name: string; command: string; args: string[] };
export type McpConfigSource = { source: string; file: string; servers: McpServer[]; error?: string };

/** 解析一份配置 JSON 中的 mcpServers 段;非法/缺失返回空数组 */
export function parseMcpServers(raw: string): McpServer[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const mcpServers = (data as Record<string, unknown>)["mcpServers"];
  if (!mcpServers || typeof mcpServers !== "object") return [];
  const out: McpServer[] = [];
  for (const [name, v] of Object.entries(mcpServers as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const command = typeof o.command === "string" ? o.command : "";
    const args = Array.isArray(o.args) ? o.args.filter((a): a is string => typeof a === "string") : [];
    if (!command && args.length === 0) continue; // 无 command/args 的条目(如纯 remote url 配置)跳过
    out.push({ name, command, args });
  }
  return out;
}

/** 常见客户端配置文件位置(存在才扫描) */
export function mcpConfigCandidates(): { source: string; file: string }[] {
  const home = os.homedir();
  const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  return [
    { source: "Claude Desktop", file: path.join(appdata, "Claude", "claude_desktop_config.json") },
    { source: "Claude Code", file: expandHome("~/.claude.json") },
    { source: "Claude Code", file: expandHome("~/.claude/mcp.json") },
  ];
}

/** 扫描全部候选配置,返回每个来源的解析结果(文件不存在 → 跳过不出现在结果里) */
export function discoverMcpConfigs(candidates = mcpConfigCandidates()): McpConfigSource[] {
  const out: McpConfigSource[] = [];
  for (const { source, file } of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      out.push({ source, file, servers: parseMcpServers(fs.readFileSync(file, "utf-8")) });
    } catch (e) {
      out.push({ source, file, servers: [], error: e instanceof Error ? e.message : "读取失败" });
    }
  }
  return out;
}
