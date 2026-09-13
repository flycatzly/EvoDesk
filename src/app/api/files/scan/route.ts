import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "@/lib/db/client";
import { readSettingsKv } from "@/lib/db/read-settings";
import { expandHome } from "@/lib/domain/skills";
import { isPathWithin } from "@/lib/domain/script-security";
import { categoryForExtension, isProtectedDir } from "@/lib/domain/file-organize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_ENTRIES = 4000;
const MAX_HASH_BYTES = 32 * 1024 * 1024; // 超过 32MB 不参与哈希去重

/** settings.organize_dirs(JSON 数组;白名单) */
export function organizeDirsFromDb(): string[] {
  const kv = readSettingsKv(getDb());
  const raw = kv.organize_dirs;
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map(expandHome);
}

export function resolveOrganizeDir(dir: string | null): string | null {
  const whitelist = organizeDirsFromDb();
  if (!dir) return whitelist[0] ?? null;
  const abs = expandHome(dir);
  return whitelist.find((w) => path.resolve(w) === path.resolve(abs)) ?? null;
}

function sha256(file: string): string | null {
  try {
    const h = crypto.createHash("sha256");
    h.update(fs.readFileSync(file));
    return h.digest("hex");
  } catch {
    return null;
  }
}

export type ScanEntry = { name: string; relPath: string; isDir: boolean; category: string; size: number; mtime: string };
export type DupGroup = { hash: string; files: { relPath: string; size: number }[] };

export function scanDir(root: string, withDupes: boolean): { entries: ScanEntry[]; stats: Record<string, number>; truncated: boolean; duplicateGroups: DupGroup[] } {
  const entries: ScanEntry[] = [];
  let truncated = false;
  const bySize = new Map<number, string[]>();
  const walk = (rel: string, depth: number) => {
    if (truncated || depth > 2) return;
    let names: fs.Dirent[] = [];
    try {
      names = fs.readdirSync(path.resolve(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      if (entries.length >= MAX_ENTRIES) { truncated = true; return; }
      if (e.name.startsWith(".") || (depth === 0 && isProtectedDir(e.name))) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      const full = path.resolve(root, child);
      try {
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          entries.push({ name: e.name, relPath: child, isDir: true, category: "目录", size: 0, mtime: st.mtime.toISOString() });
          walk(child, depth + 1);
        } else {
          const category = categoryForExtension(e.name);
          entries.push({ name: e.name, relPath: child, isDir: false, category, size: st.size, mtime: st.mtime.toISOString() });
          if (withDupes && st.isFile() && st.size > 0 && st.size <= MAX_HASH_BYTES) {
            const list = bySize.get(st.size) ?? [];
            list.push(child);
            bySize.set(st.size, list);
          }
        }
      } catch { /* 不可 stat 的条目跳过 */ }
    }
  };
  walk("", 0);
  const stats: Record<string, number> = {};
  for (const e of entries) if (!e.isDir) stats[e.category] = (stats[e.category] ?? 0) + 1;

  const duplicateGroups: DupGroup[] = [];
  if (withDupes) {
    for (const [size, files] of bySize) {
      if (files.length < 2) continue;
      const byHash = new Map<string, string[]>();
      for (const f of files) {
        const h = sha256(path.resolve(root, f));
        if (!h) continue;
        const list = byHash.get(h) ?? [];
        list.push(f);
        byHash.set(h, list);
      }
      for (const [hash, group] of byHash) {
        if (group.length > 1) {
          duplicateGroups.push({
            hash,
            files: group.map((relPath) => ({ relPath, size })),
          });
        }
      }
    }
    duplicateGroups.sort((a, b) => b.files.length - a.files.length);
  }
  return { entries, stats, truncated, duplicateGroups };
}

// GET /api/files/scan?dir=&dupes=1:白名单目录扫描 + 类型统计 + 可选同内容重复分组
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const root = resolveOrganizeDir(url.searchParams.get("dir"));
  if (!root) return NextResponse.json({ error: "目录不在整理白名单内:先在下方添加要整理的目录" }, { status: 400 });
  if (!fs.existsSync(root)) return NextResponse.json({ error: "目录不存在" }, { status: 400 });
  const result = scanDir(root, url.searchParams.get("dupes") === "1");
  return NextResponse.json({ root, ...result });
}

// path 安全:目标必须在白名单目录内(防穿越)
export function assertWithin(root: string, rel: string): string {
  const p = path.resolve(root, rel);
  if (!isPathWithin(p, root)) throw new Error(`路径越界:${rel}`);
  return p;
}
