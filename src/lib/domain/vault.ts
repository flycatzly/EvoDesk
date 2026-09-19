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

/** 全部资料库根目录:主 vault_path + settings.vault_roots(JSON 数组),去重保序。 */
export function vaultRoots(db: Db): string[] {
  const roots: string[] = [];
  const main = getVaultRoot(db);
  if (main) roots.push(main);
  const row = db.select().from(settings).where(eq(settings.key, "vault_roots")).all()[0];
  if (row) {
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (typeof r === "string" && r.trim() && !roots.some((x) => path.resolve(x) === path.resolve(r.trim()))) {
            roots.push(r.trim());
          }
        }
      }
    } catch { /* 坏配置忽略 */ }
  }
  return roots;
}

/** 校验 root 在资料库白名单内(与既有 vault 相同的规范化比较),返回规范化路径或 null */
export function resolveVaultRoot(db: Db, root: string | null): string | null {
  const roots = vaultRoots(db);
  if (roots.length === 0) return null;
  if (!root) return roots[0];
  return roots.find((r) => path.resolve(r) === path.resolve(root)) ?? null;
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

/** 读取笔记/文本文件:白名单 → 在线可读扩展 → 存在性 → 1MB 上限。 */
export function readNoteFile(vaultRoot: string, rel: string): string {
  const p = resolveVaultPath(vaultRoot, rel);
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  if (!VIEWABLE_TEXT_EXTS.includes(ext)) throw new Error("仅支持文本类文件(md/txt/代码/配置等)");
  if (!fs.existsSync(p)) throw new Error(`文件不存在:${rel}`);
  const st = fs.statSync(p);
  if (!st.isFile()) throw new Error(`文件不存在:${rel}`);
  if (st.size > MAX_FILE_BYTES) throw new Error("文件超过 1MB,不支持在线编辑");
  return fs.readFileSync(p, "utf8");
}

/** 写入 md/txt 笔记:扩展白名单 → 1MB 上限 → 白名单,父目录不存在则递归创建(仅限 vault 内)。
 *  原子写:先写临时文件再 rename,进程崩溃/断电不会留下半截内容损坏原文件。 */
export function writeNoteFile(vaultRoot: string, rel: string, content: string): void {
  if (!/\.(md|txt)$/i.test(rel)) throw new Error("仅支持写入 md/txt 文件");
  if (content.length > MAX_FILE_BYTES) throw new Error("内容超过 1MB 上限");
  const p = resolveVaultPath(vaultRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* 清理失败忽略 */ }
    throw e;
  }
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

// ---------- 资料库(多根):智能分类 / 索引 / 备份清单 ----------

export type FileCategory = "文档" | "图片" | "表格数据" | "代码" | "数据配置" | "压缩包" | "音频视频" | "其他";

const CATEGORY_EXTS: [FileCategory, string[]][] = [
  ["文档", ["md", "txt", "pdf", "doc", "docx", "rtf", "html", "htm", "epub"]],
  ["图片", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"]],
  ["表格数据", ["xls", "xlsx", "csv", "tsv"]],
  ["代码", ["ts", "tsx", "js", "jsx", "py", "java", "c", "cpp", "h", "go", "rs", "sql", "sh", "bat", "ps1", "css"]],
  ["数据配置", ["json", "xml", "yaml", "yml", "ini", "cfg", "toml", "env"]],
  ["压缩包", ["zip", "rar", "7z", "tar", "gz"]],
  ["音频视频", ["mp4", "mov", "avi", "mkv", "mp3", "wav", "flac", "m4a"]],
];

/** 按扩展名智能分类;nyf(myBase)等未知格式归「其他」 */
export function categoryForFile(name: string): FileCategory {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  for (const [cat, exts] of CATEGORY_EXTS) {
    if (exts.includes(ext)) return cat;
  }
  return "其他";
}

/** 在线可读的文本扩展(查看;写入仍限 md/txt) */
export const VIEWABLE_TEXT_EXTS = ["md", "txt", "html", "htm", "json", "xml", "yaml", "yml", "csv", "log", "ts", "js", "py", "sql", "css", "ini", "cfg", "toml"];

export type LibraryEntry = {
  relPath: string; // POSIX 风格相对路径
  name: string;
  category: FileCategory;
  size: number;
  mtime: string;
  isText: boolean;
};

export type LibraryIndex = { root: string; entries: LibraryEntry[]; stats: Record<string, number>; truncated: boolean };

/** 递归索引一个资料库根目录(跳过隐藏目录;容量上限防止超大目录拖垮页面) */
export function indexLibrary(root: string, opts?: { maxEntries?: number; maxDepth?: number }): LibraryIndex {
  const maxEntries = opts?.maxEntries ?? 2000;
  const maxDepth = opts?.maxDepth ?? 4;
  const entries: LibraryEntry[] = [];
  let truncated = false;
  const walk = (rel: string, depth: number): void => {
    if (truncated || depth > maxDepth) return;
    let names: fs.Dirent[] = [];
    try {
      names = fs.readdirSync(path.resolve(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      if (entries.length >= maxEntries) { truncated = true; return; }
      if (e.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      const full = path.resolve(root, child);
      try {
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          walk(child, depth + 1);
        } else if (st.isFile()) {
          const ext = e.name.split(".").pop()?.toLowerCase() ?? "";
          entries.push({
            relPath: child, name: e.name, category: categoryForFile(e.name),
            size: st.size, mtime: st.mtime.toISOString(), isText: VIEWABLE_TEXT_EXTS.includes(ext),
          });
        }
      } catch { /* 竞态删除等不可 stat 的条目跳过 */ }
    }
  };
  walk("", 0);
  const stats: Record<string, number> = {};
  for (const e of entries) stats[e.category] = (stats[e.category] ?? 0) + 1;
  return { root, entries, stats, truncated };
}

export type ManifestFile = { path: string; category: string; size: number; mtime: string; content?: string };

/** 备份清单:文件元数据全集;文本文件(≤ textMaxBytes)可内联内容,二进制/超大文件只记元数据 */
export function libraryManifest(root: string, opts?: { includeText?: boolean; textMaxBytes?: number }): {
  root: string; generatedAt: string; total: number; files: ManifestFile[];
} {
  const includeText = opts?.includeText ?? true;
  const textMax = opts?.textMaxBytes ?? 262_144;
  const index = indexLibrary(root, { maxEntries: 5000, maxDepth: 6 });
  const files: ManifestFile[] = index.entries.map((e) => {
    const meta: ManifestFile = { path: e.relPath, category: e.category, size: e.size, mtime: e.mtime };
    if (includeText && e.isText && e.size <= textMax) {
      try {
        meta.content = fs.readFileSync(path.resolve(root, e.relPath), "utf8");
      } catch { /* 读取失败只留元数据 */ }
    }
    return meta;
  });
  return { root, generatedAt: new Date().toISOString(), total: files.length, files };
}
