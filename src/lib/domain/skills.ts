// 本地 Skill 汇总管理(技能地图):扫描配置目录下的 SKILL.md,解析 frontmatter,
// 按一级子目录分类。只读——绝不写入或执行 skill 内容。
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { readSettingsKv } from "@/lib/db/read-settings";
import type { Db } from "@/lib/db/test-util";

export const DEFAULT_SKILLS_DIRS = ["~/.agents/skills", "~/.claude/skills"];
const MAX_DEPTH = 3;

export type SkillInfo = {
  path: string; // SKILL.md 绝对路径
  name: string;
  description: string;
  category: string; // 一级子目录名;扁平结构 → 未分类
  mtime: string;
};
export type ScanError = { dir: string; message: string };

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** settings.skills_dirs(JSON 数组;非法/缺省回退默认集) */
export function skillsDirsFromSettings(db: Db): string[] {
  const kv = readSettingsKv(db);
  const raw = kv.skills_dirs;
  if (Array.isArray(raw)) {
    const dirs = raw.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map(expandHome);
    if (dirs.length > 0) return dirs;
  }
  return DEFAULT_SKILLS_DIRS.map(expandHome);
}

/** 解析 SKILL.md 顶部 frontmatter 的 name/description;缺省回退(目录名 / 空串) */
export function parseSkillFrontmatter(content: string, fallbackName: string): { name: string; description: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return { name: fallbackName, description: "" };
  const lines = m[1].split(/\r?\n/);
  const get = (key: string) => {
    const line = lines.find((l) => new RegExp(`^${key}\\s*:`).test(l));
    if (!line) return "";
    return line.slice(line.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
  };
  return { name: get("name") || fallbackName, description: get("description") };
}

function walk(dir: string, root: string, depth: number, out: SkillInfo[]): void {
  if (depth > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const skillFile = entries.find((e) => e.isFile() && e.name === "SKILL.md");
  if (skillFile) {
    const full = path.join(dir, skillFile.name);
    try {
      const content = fs.readFileSync(full, "utf-8");
      const folder = path.basename(dir);
      // 分类:SKILL.md 相对根的第一段目录;直接放根下的技能归"未分类"
      const rel = path.relative(root, dir);
      const first = rel.split(path.sep)[0];
      const category = rel && first !== folder ? first : "未分类";
      const parsed = parseSkillFrontmatter(content, folder);
      out.push({ path: full, name: parsed.name, description: parsed.description, category, mtime: fs.statSync(full).mtime.toISOString() });
      return; // SKILL.md 所在目录不再下钻
    } catch {
      // 读失败跳过该文件
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith(".")) walk(path.join(dir, e.name), root, depth + 1, out);
  }
}

export function scanSkillsDirs(dirs: string[]): { skills: SkillInfo[]; errors: ScanError[] } {
  const skills: SkillInfo[] = [];
  const errors: ScanError[] = [];
  for (const dir of dirs) {
    const abs = expandHome(dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      errors.push({ dir, message: "目录不存在" });
      continue;
    }
    walk(abs, abs, 0, skills);
  }
  skills.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return { skills, errors };
}
