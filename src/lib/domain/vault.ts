// src/lib/domain/vault.ts
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { settings } from "@/lib/db/schema";
import { isPathWithin } from "@/lib/domain/script-security";

const MAX_FILE_BYTES = 1_048_576; // 1MB:在线编辑/写入的内容上限

/** 读 settings.vault_path(value 统一 JSON 序列化;解析失败/缺失/空白/非字符串一律视为未配置)。 */
export function getVaultRoot(db: Db): string | null {
  const row = db.select().from(settings).where(eq(settings.key, "vault_path")).all()[0];
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    return typeof parsed === "string" && parsed.trim() ? parsed : null;
  } catch {
    return null;
  }
}

/** 解析 vault 内相对路径并强制白名单:绝对路径/.. 穿越/vault 外一律抛错。 */
export function resolveVaultPath(vaultRoot: string, rel: string): string {
  const p = path.resolve(vaultRoot, rel);
  if (!isPathWithin(p, vaultRoot)) throw new Error(`路径越界:${rel}`);
  return p;
}

export interface VaultEntry { name: string; type: "dir" | "md" | "file" }

const TYPE_RANK: Record<VaultEntry["type"], number> = { dir: 0, md: 1, file: 2 };

export function listTree(vaultRoot: string, rel = ""): VaultEntry[] {
  const dir = resolveVaultPath(vaultRoot, rel);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).flatMap((name): VaultEntry[] => {
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) return [{ name, type: "dir" }];
      if (name.endsWith(".md")) return [{ name, type: "md" }];
      return [{ name, type: "file" }];
    } catch { /* 竞态删除等不可 stat 的条目跳过 */ return []; }
  }).sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.name.localeCompare(b.name));
}

/** 读取 md/txt 笔记:白名单 → 扩展白名单 → 存在性 → 1MB 上限。 */
export function readNoteFile(vaultRoot: string, rel: string): string {
  const p = resolveVaultPath(vaultRoot, rel);
  if (!/\.(md|txt)$/i.test(rel)) throw new Error("仅支持 md/txt 文件");
  if (!fs.existsSync(p)) throw new Error(`文件不存在:${rel}`);
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error(`文件不存在:${rel}`);
  if (st.size > MAX_FILE_BYTES) throw new Error("文件超过 1MB,不支持在线编辑");
  return fs.readFileSync(p, "utf8");
}

/** 写入 md/txt 笔记:扩展白名单 → 1MB 上限 → 白名单,父目录不存在则递归创建(仅限 vault 内)。 */
export function writeNoteFile(vaultRoot: string, rel: string, content: string): void {
  if (!/\.(md|txt)$/i.test(rel)) throw new Error("仅支持写入 md/txt 文件");
  if (content.length > MAX_FILE_BYTES) throw new Error("内容超过 1MB 上限");
  const p = resolveVaultPath(vaultRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

export interface SearchHit { path: string; snippet: string }

/** 递归搜索 vault 内全部 .md 文件,返回前 limit 个命中;path 为 POSIX 风格相对路径供 UI 使用。 */
export function searchNotes(vaultRoot: string, q: string, limit = 50): SearchHit[] {
  const hits: SearchHit[] = [];
  const walk = (rel: string) => {
    if (hits.length >= limit) return;
    for (const e of listTree(vaultRoot, rel)) {
      if (hits.length >= limit) return;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.type === "dir") {
        walk(child);
      } else if (e.type === "md") {
        try {
          const text = fs.readFileSync(resolveVaultPath(vaultRoot, child), "utf8");
          const idx = text.indexOf(q);
          if (q && idx >= 0) {
            hits.push({ path: child, snippet: text.slice(Math.max(0, idx - 30), idx + q.length + 50) });
          }
        } catch { /* 跳过不可读文件 */ }
      }
    }
  };
  walk("");
  return hits;
}
