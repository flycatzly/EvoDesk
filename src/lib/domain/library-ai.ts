// 资料库 AI 整理:相似文章检测(内容哈希 + 标题/内容相似度)、AI 计划清洗、
// 分类移动(库内)、合并重生成、完善重写、导入 Obsidian。
// 纯函数/文件操作在此层;LLM 调用在 API 路由层。所有写入只发生在资料库白名单根目录内。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isPathWithin } from "./script-security";

export type LibFile = { relPath: string; name: string; category: string; size: number; mtime: string; isText: boolean };

export type AiPlan = {
  categories: { name: string; files: string[] }[];
  merges: { target: string; sources: string[] }[];
  enrich: string[];
};

// ---------- 相似检测 ----------

export function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** 标准化标题:去扩展名(含 .md.md 双扩展)、去空白与标点、小写(仅保留字母数字与中文) */
export function normalizeDocName(name: string): string {
  return name
    .replace(/\.md$/i, "")
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
}

/** 内容 shingle 集合(4 字滑窗),用于 Jaccard 相似度;内容截断 8KB */
function shingles(content: string): Set<string> {
  const text = content.slice(0, 8192).replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i + 4 <= text.length; i++) out.add(text.slice(i, i + 4));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type SimGroup = { kind: "同内容" | "高相似"; files: string[] };

/**
 * 相似文章分组(无 LLM,离线):
 * - 内容哈希完全一致 → 同内容;
 * - 标题标准化相同 或 内容 Jaccard ≥ threshold → 高相似(并查集合并传递关系)。
 */
export function findSimilarGroups(
  files: { relPath: string; name: string; content: string }[],
  opts?: { threshold?: number }
): SimGroup[] {
  const threshold = opts?.threshold ?? 0.7;
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const byHash = new Map<string, string[]>();
  for (const f of files) {
    const k = contentHash(f.content);
    if (byHash.has(k)) byHash.get(k)!.push(f.relPath);
    else byHash.set(k, [f.relPath]);
  }
  const exactGroups = [...byHash.values()].filter((g) => g.length > 1);
  const inExact = new Set(exactGroups.flat());

  // 标题相同
  const byName = new Map<string, string[]>();
  for (const f of files) {
    if (inExact.has(f.relPath)) continue;
    const key = normalizeDocName(f.name);
    if (key.length < 2) continue;
    if (byName.has(key)) byName.get(key)!.push(f.relPath);
    else byName.set(key, [f.relPath]);
  }
  for (const g of byName.values()) if (g.length > 1) for (let i = 1; i < g.length; i++) union(g[0], g[i]);

  // 内容 Jaccard(排除精确重复文件;数量上限防 O(n²) 爆炸)
  const candidates = files.filter((f) => !inExact.has(f.relPath) && f.content.length > 0).slice(0, 300);
  const sets = candidates.map((f) => ({ relPath: f.relPath, set: shingles(f.content) }));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      if (jaccard(sets[i].set, sets[j].set) >= threshold) union(sets[i].relPath, sets[j].relPath);
    }
  }

  // 聚类输出:对全部文件求根(未参与比较的单例自然落成长度为 1 的簇,被丢弃)
  const clusters = new Map<string, string[]>();
  for (const f of files) {
    const root = find(f.relPath);
    if (clusters.has(root)) clusters.get(root)!.push(f.relPath);
    else clusters.set(root, [f.relPath]);
  }
  const out: SimGroup[] = exactGroups.map((g) => ({ kind: "同内容", files: g }));
  for (const g of clusters.values()) if (g.length > 1) out.push({ kind: "高相似", files: g });
  return out;
}

// ---------- AI 计划清洗 ----------

const isSafeRel = (rel: string) => typeof rel === "string" && rel.length > 0 && rel.length < 400 && !rel.includes("..");

/** 清洗 LLM 计划:丢弃清单外/危险路径、空组、超限截断;合并目标补 .md 扩展 */
export function sanitizePlan(raw: unknown, knownPaths: Set<string>): AiPlan {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const categories: AiPlan["categories"] = [];
  const claimed = new Set<string>();
  const rawCats = Array.isArray(o.categories) ? o.categories.slice(0, 40) : [];
  for (const c of rawCats) {
    const co = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const name = typeof co.name === "string" ? co.name.trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 40) : "";
    if (!name || name.includes("..")) continue;
    // 跨分类去重:同一文件只归入最先命中的分类(AI 偶发重叠时不会重复移动)
    const files = (Array.isArray(co.files) ? co.files : [])
      .filter((f): f is string => typeof f === "string" && isSafeRel(f) && knownPaths.has(f))
      .filter((f) => !claimed.has(f) && (claimed.add(f), true));
    if (files.length > 0) categories.push({ name, files });
  }
  const merges: AiPlan["merges"] = [];
  for (const m of (Array.isArray(o.merges) ? o.merges : []).slice(0, 10)) {
    const mo = m && typeof m === "object" ? (m as Record<string, unknown>) : {};
    const target = typeof mo.target === "string" ? mo.target.trim() : "";
    if (!target) continue;
    const safeTarget = (target.replace(/[\\/:*?"<>|]/g, "-").endsWith(".md") ? target : `${target}.md`).replace(/^[.-]+/, "").slice(0, 120);
    const sources = (Array.isArray(mo.sources) ? mo.sources : []).filter((f): f is string => typeof f === "string" && isSafeRel(f) && knownPaths.has(f)).slice(0, 8);
    if (safeTarget && sources.length >= 2) merges.push({ target: safeTarget, sources });
  }
  const enrich = (Array.isArray(o.enrich) ? o.enrich : []).filter((f): f is string => typeof f === "string" && isSafeRel(f) && knownPaths.has(f)).slice(0, 20);
  return { categories, merges, enrich };
}

/** 冲突命名:a.md 已存在 → a(1).md */
export function conflictFreeName(existing: Set<string>, name: string): string {
  if (!existing.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}(${i})${ext}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

// ---------- 执行(文件操作,全部限定在 root 内) ----------

function assertWithin(root: string, rel: string): string {
  const p = path.resolve(root, rel);
  if (!isPathWithin(p, root)) throw new Error(`路径越界:${rel}`);
  return p;
}

/** 分类移动:文件移入 <root>/<分类名>/(重名加序号);返回 {moved, skipped} */
export function applyCategories(root: string, categories: AiPlan["categories"]): { moved: number; skipped: number } {
  let moved = 0;
  let skipped = 0;
  for (const c of categories) {
    const destDir = assertWithin(root, c.name);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    for (const rel of c.files) {
      try {
        const from = assertWithin(root, rel);
        if (!fs.existsSync(from) || !fs.statSync(from).isFile()) { skipped++; continue; }
        if (path.dirname(from) === destDir) { skipped++; continue; }
        const target = path.join(destDir, conflictFreeName(new Set(fs.readdirSync(destDir).map((n) => n.toLowerCase())), path.basename(from)));
        fs.renameSync(from, target);
        moved++;
      } catch { skipped++; }
    }
  }
  return { moved, skipped };
}

/** 读源文件内容(文本 ≤256KB);供合并/完善取材 */
export function readDoc(root: string, rel: string): string | null {
  try {
    const p = assertWithin(root, rel);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
    if (fs.statSync(p).size > 262_144) return null;
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** 写合并/完善产物:备份原文件到 <root>/_原始备份/<ts>/ 后覆盖写 */
export function writeDocWithBackup(root: string, rel: string, content: string, backupStamp: string): string {
  const p = assertWithin(root, rel);
  const backupDir = assertWithin(root, `_原始备份/${backupStamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(p)) {
    const backupName = rel.split("/").join("__");
    fs.copyFileSync(p, path.join(backupDir, backupName));
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
  return rel;
}

/** 移动源文件到 <root>/_已合并/<stamp>/(合并后保留原件,可找回) */
export function archiveFiles(root: string, rels: string[], stamp: string): number {
  const archiveDir = assertWithin(root, `_已合并/${stamp}`);
  fs.mkdirSync(archiveDir, { recursive: true });
  let n = 0;
  for (const rel of rels) {
    try {
      const from = assertWithin(root, rel);
      const finalName = conflictFreeName(new Set(fs.readdirSync(archiveDir).map((x) => x.toLowerCase())), rel.split("/").join("__"));
      fs.renameSync(from, path.join(archiveDir, finalName));
      n++;
    } catch { /* 单个失败跳过 */ }
  }
  return n;
}

/** 导入 Obsidian:把库内文件复制到主 vault 子目录(白名单校验 + 冲突加序号) */
export function importToVault(vaultRoot: string, sourceRoot: string, rels: string[], subfolder: string): { imported: number; skipped: number; target: string } {
  const folder = subfolder.trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "资料导入";
  const targetDir = path.resolve(vaultRoot, folder);
  if (!isPathWithin(targetDir, vaultRoot)) throw new Error("目标目录越界");
  fs.mkdirSync(targetDir, { recursive: true });
  let imported = 0;
  let skipped = 0;
  for (const rel of rels) {
    try {
      const src = assertWithin(sourceRoot, rel);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) { skipped++; continue; }
      // 保留相对目录结构(一级),避免同名覆盖
      const relName = rel.split("/").slice(-1)[0];
      const finalName = conflictFreeName(new Set(fs.readdirSync(targetDir).map((n) => n.toLowerCase())), relName);
      fs.copyFileSync(src, path.join(targetDir, finalName));
      imported++;
    } catch { skipped++; }
  }
  return { imported, skipped, target: folder };
}
