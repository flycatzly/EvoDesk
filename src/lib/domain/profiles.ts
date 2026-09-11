// Launcher 档案(provider profile)领域:解析 ClaudeCode 类启动器配置、目录批量导入、按档位派生执行器。
// 设计:密钥落库为 plain: 引用(本地明文,界面掩码,日志不打印)——禁止在错误信息/日志中输出 token 值。
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { providerProfiles, executors } from "@/lib/db/schema";

export interface ProfileCandidate { model: string; alias: string; tier: "primary" | "opus" | "sonnet" | "haiku" }
export interface ParsedProfile {
  name: string; protocol: "anthropic" | "openai"; apiBase: string; apiKeyRef: string;
  candidates: ProfileCandidate[]; staleSections: string[];
}
// 档位白名单:derive 路由校验入参用
export const PROFILE_TIERS = ["primary", "opus", "sonnet", "haiku"] as const;
// 桌面端用不到的启动器配置段:导入时识别并在报告中标注(不落库)
const STALE = ["hooks", "mcpServers", "statusLine", "extraKnownMarketplaces", "enabledPlugins"];

export function parseProfileText(name: string, raw: string): ParsedProfile {
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    // 不回显原文:V8 的 SyntaxError 可能内嵌源码片段(含 token),只报出错位置
    const pos = (e as SyntaxError).message.match(/position (\d+)/)?.[1] ?? "?";
    throw new Error(`JSON 解析失败(位置 ${pos}),请检查文件格式`);
  }
  const env = cfg.env as Record<string, string> | undefined;
  if (!env || typeof env !== "object") throw new Error("缺少 env 段");
  const token = env.ANTHROPIC_AUTH_TOKEN;
  if (!token) throw new Error("缺少 ANTHROPIC_AUTH_TOKEN");
  const apiBase = env.ANTHROPIC_BASE_URL;
  if (!apiBase) throw new Error("缺少 ANTHROPIC_BASE_URL");
  const candidates: ProfileCandidate[] = [];
  // 每个档位至多一条候选;不同档位同模型也各自保留(派生按 tier 取用,如 sonnet=primary 同款仍可派 sonnet 执行器)
  const push = (model: string | undefined, alias: string | undefined, tier: ProfileCandidate["tier"]) => {
    if (!model) return;
    candidates.push({ model, alias: alias && alias !== model ? alias : model, tier });
  };
  push(env.ANTHROPIC_MODEL, undefined, "primary");
  push(env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME, "opus");
  push(env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME, "sonnet");
  push(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME, "haiku");
  return {
    name, protocol: /\/anthropic/i.test(apiBase) ? "anthropic" : "openai",
    apiBase, apiKeyRef: `plain:${token}`, candidates,
    staleSections: STALE.filter((k) => cfg[k] != null),
  };
}

export function importProfilesFromDir(db: Db, dir: string): { imported: string[]; skipped: { name: string; reason: string }[] } {
  const imported: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort(); } catch (e) { throw new Error(`目录不可读:${String(e).slice(0, 80)}`); }
  for (const file of files) {
    const name = path.basename(file, ".txt");
    const existing = db.select().from(providerProfiles).where(eq(providerProfiles.name, name)).all();
    if (existing.length > 0) { skipped.push({ name, reason: "已存在同名档案" }); continue; }
    try {
      const p = parseProfileText(name, fs.readFileSync(path.join(dir, file), "utf8"));
      db.insert(providerProfiles).values({
        id: crypto.randomUUID(), name: p.name, protocol: p.protocol, apiBase: p.apiBase,
        apiKeyRef: p.apiKeyRef, candidates: JSON.stringify(p.candidates), source: "import", importPath: dir, createdAt: new Date().toISOString(),
      }).run();
      imported.push(name);
    } catch (e) {
      skipped.push({ name, reason: String(e).slice(0, 120) });
    }
  }
  return { imported, skipped };
}

// 按档位从档案派生执行器:默认禁用(enabled=false),绑定档案的端点/协议/密钥引用;同名跳过保证幂等。
export function deriveExecutors(db: Db, profileId: string, selections: { tier: ProfileCandidate["tier"]; role: string }[]) {
  const prof = db.select().from(providerProfiles).where(eq(providerProfiles.id, profileId)).all()[0];
  if (!prof) throw new Error("档案不存在");
  const candidates = JSON.parse(prof.candidates) as ProfileCandidate[];
  const created: string[] = [];
  for (const sel of selections) {
    const cand = candidates.find((c) => c.tier === sel.tier);
    if (!cand) throw new Error(`档案 ${prof.name} 没有 ${sel.tier} 档位`);
    const name = `${prof.name}·${sel.tier}`;
    if ((db.select().from(executors).all() as (typeof executors.$inferSelect)[]).some((e) => e.name === name)) continue;
    const id = crypto.randomUUID();
    db.insert(executors).values({
      id, name, type: "llm", role: sel.role, model: cand.model,
      providerProfileId: prof.id, apiBase: prof.apiBase, protocol: prof.protocol,
      apiKeyRef: prof.apiKeyRef, enabled: false, createdAt: new Date().toISOString(),
    }).run();
    created.push(id);
  }
  return created;
}
