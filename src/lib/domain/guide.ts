// 面试宝典:将外部文档库(如 JavaGuide)作为只读"宝典源"挂载,
// 提供分类树、检索、Obsidian 同步、md/html 导出。纯函数 + 文件操作。
import fs from "node:fs";
import path from "node:path";
import { isPathWithin } from "./script-security";
import { readSettingsKv } from "@/lib/db/read-settings";
import { expandHome } from "./skills";
import type { Db } from "@/lib/db/test-util";

/** 宝典源目录(settings.guide_dirs 数组,白名单)。放在 domain 层供多个路由共享(路由模块不可跨路由导入)。 */
export async function guideDirsFromDb(db: Db): Promise<string[]> {
  const kv = await readSettingsKv(db);
  const raw = kv.guide_dirs;
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map(expandHome);
}

/** 解析宝典源:必须在 guide_dirs 白名单内;dir 为空回退第一个源。 */
export async function resolveGuideDir(db: Db, dir: string | null): Promise<string | null> {
  const list = await guideDirsFromDb(db);
  if (!dir) return list[0] ?? null;
  const abs = expandHome(dir);
  return list.find((w) => path.resolve(w) === path.resolve(abs)) ?? null;
}

export type GuideEntry = {
  relPath: string; // POSIX 相对路径(含分类)
  name: string; // 文件名
  title: string; // 去 .md 的显示标题
  category: string; // 一级目录(docs/xxx 的 xxx)
  folder: string; // 二级目录名(或空)
  size: number;
  headline: string; // 首个 # 标题或首行
};

export type GuideTree = {
  root: string;
  categories: { name: string; folders: { name: string; count: number }[]; count: number }[];
  entries: GuideEntry[];
  truncated: boolean;
};

const MAX_ENTRIES = 3000;

/** 标题提取:首个 "# x" 行,否则首行非空文本 */
function headlineOf(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (/^#\s+/.test(t)) return t.replace(/^#\s+/, "").slice(0, 80);
    if (t && !t.startsWith("---") && !t.startsWith("![")) return t.slice(0, 80);
  }
  return "";
}

/** 扫描宝典源目录(只收 docs/ 或根下 md;跳过 .vuepress/.git/node_modules) */
export function scanGuide(root: string): GuideTree {
  const entries: GuideEntry[] = [];
  let truncated = false;
  const walk = (rel: string, depth: number): void => {
    if (truncated || depth > 4) return;
    let names: fs.Dirent[] = [];
    try {
      names = fs.readdirSync(path.resolve(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      if (entries.length >= MAX_ENTRIES) { truncated = true; return; }
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      const full = path.resolve(root, child);
      try {
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          walk(child, depth + 1);
        } else if (st.isFile() && e.name.toLowerCase().endsWith(".md")) {
          let content = "";
          try { content = fs.readFileSync(full, "utf8").slice(0, 8192); } catch { /* 跳过 */ }
          const parts = child.split("/");
          // 分类:docs/ 下一级;根文件归「根文档」
          const category = parts[0] === "docs" && parts.length > 2 ? parts[1] : parts.length > 1 ? parts[0] : "根文档";
          const folder = parts[0] === "docs" && parts.length > 3 ? parts[parts.length - 2] : parts.length > 2 ? parts[parts.length - 2] : "";
          entries.push({
            relPath: child,
            name: e.name,
            title: e.name.replace(/\.md$/i, ""),
            category,
            folder,
            size: st.size,
            headline: headlineOf(content),
          });
        }
      } catch { /* 不可 stat 跳过 */ }
    }
  };
  walk("", 0);
  // 分类聚合
  const catMap = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const folders = catMap.get(e.category) ?? new Map<string, number>();
    if (e.folder) folders.set(e.folder, (folders.get(e.folder) ?? 0) + 1);
    catMap.set(e.category, folders);
  }
  const categories = [...catMap.entries()].map(([name, folders]) => ({
    name,
    count: [...folders.values()].reduce((a, b) => a + b, 0),
    folders: [...folders.entries()].map(([fname, count]) => ({ name: fname, count })).sort((a, b) => b.count - a.count),
  })).sort((a, b) => b.count - a.count);
  return { root, categories, entries, truncated };
}

/** 读宝典文章全文(白名单 + ≤1MB) */
export function readGuideDoc(root: string, relPath: string): string {
  const p = path.resolve(root, relPath);
  if (!isPathWithin(p, root)) throw new Error(`路径越界:${relPath}`);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error(`文件不存在:${relPath}`);
  if (fs.statSync(p).size > 1_048_576) throw new Error("文件超过 1MB");
  return fs.readFileSync(p, "utf8");
}

/** 简易 md → html:标题/粗体/行内代码/代码块/列表/链接/段落;导出用,不做完整渲染 */
export { markdownToHtml, docToHtml } from "./md-render";
