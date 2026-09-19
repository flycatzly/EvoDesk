import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "@/lib/db/client";
import { resolveGuideDir } from "../route";
import { scanGuide, readGuideDoc, docToHtml } from "@/lib/domain/guide";
import { resolveVaultRoot } from "@/lib/domain/vault";
import { isPathWithin } from "@/lib/domain/script-security";
import { conflictFreeName } from "@/lib/domain/library-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execFileAsync = promisify(execFile);

function resolveDirFromBody(body: Record<string, unknown> | null): string | null {
  return resolveGuideDir(body && typeof body.dir === "string" ? body.dir : null);
}

/**
 * 宝典导出/同步(POST {dir, mode, paths?}):
 *   mode=obsidian → 复制选中文档(缺省全部)到 Obsidian 库「面试宝典/<分类>/」子目录
 *   mode=md       → 打包选中文档为 .md 合集附件下载(带分类分隔头)
 *   mode=html     → 打包为单个离线 HTML(带目录导航)
 */
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const root = resolveDirFromBody(body);
  if (!root) return NextResponse.json({ error: "目录不在宝典白名单内" }, { status: 400 });
  const mode = body && typeof body.mode === "string" ? body.mode : "md";
  const tree = scanGuide(root);
  const requested = Array.isArray(body?.paths) ? (body!.paths as unknown[]).filter((p): p is string => typeof p === "string") : [];
  const entries = requested.length > 0 ? tree.entries.filter((e) => requested.includes(e.relPath)) : tree.entries;
  if (entries.length === 0) return NextResponse.json({ error: "没有可导出的文档" }, { status: 400 });

  if (mode === "obsidian") {
    const db = getDb();
    const vaultRoot = resolveVaultRoot(db, null);
    if (!vaultRoot) return NextResponse.json({ error: "未配置 Obsidian vault 路径(设置页)" }, { status: 400 });
    const base = path.resolve(vaultRoot, "面试宝典");
    if (!isPathWithin(base, vaultRoot)) return NextResponse.json({ error: "目标目录越界" }, { status: 400 });
    let copied = 0;
    for (const e of entries) {
      try {
        const destDir = path.resolve(base, e.category, e.folder);
        if (!isPathWithin(destDir, vaultRoot)) continue;
        fs.mkdirSync(destDir, { recursive: true });
        const finalName = conflictFreeName(new Set(fs.readdirSync(destDir).map((n) => n.toLowerCase())), e.name);
        fs.copyFileSync(path.resolve(root, e.relPath), path.join(destDir, finalName));
        copied++;
      } catch { /* 单个失败跳过 */ }
    }
    return NextResponse.json({ ok: true, copied, target: "Obsidian/面试宝典/" });
  }

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  if (mode === "html") {
    // 单文件离线 HTML:目录 + 全文
    const sections = entries.map((e) => {
      let content = "";
      try { content = readGuideDoc(root, e.relPath); } catch { /* 跳过 */ }
      return { e, html: content ? docToHtml(e.title, content) : "" };
    });
    const toc = entries.map((e, i) => `<li><a href="#doc${i}">${e.category}/${e.title}</a></li>`).join("");
    const bodies = sections.map((s, i) => `<div class="doc" id="doc${i}">${s.html || "<p>读取失败</p>"}</div><hr>`).join("\n");
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>面试宝典 ${ts}</title><style>
body{font-family:'Segoe UI','Microsoft YaHei UI',sans-serif;margin:0;display:flex}
nav{width:280px;position:fixed;inset:0 auto 0 0;overflow:auto;background:#f6f8fa;padding:16px;font-size:13px}
main{margin-left:280px;padding:24px 32px;max-width:860px;line-height:1.7;color:#24292f}
@media(max-width:900px){body{display:block}nav{position:static;width:auto}}
h1.doc-title{font-size:1.4em}.doc h1{font-size:1.5em}code{background:#f6f8fa;padding:2px 6px;border-radius:4px}pre{background:#f6f8fa;padding:14px;border-radius:8px;overflow:auto}
</style></head><body>
<nav><b>目录(${entries.length} 篇)</b><ul style="padding-left:16px">${toc}</ul></nav>
<main><h1 class="doc-title">📚 面试宝典</h1><p>导出于 ${new Date().toLocaleString()} · 共 ${entries.length} 篇</p>${bodies}</main>
</body></html>`;
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="guide-${ts}.html"` },
    });
  }

  // mode=md:PowerShell Compress-Archive 打包为 zip(保留分类目录结构)
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stage = path.join(process.env.TEMP ?? "/tmp", `evodesk-guide-${token}`);
  const zipPath = path.join(process.env.TEMP ?? "/tmp", `evodesk-guide-${token}.zip`);
  try {
    let n = 0;
    for (const e of entries) {
      try {
        const destDir = path.resolve(stage, e.category, e.folder);
        if (!isPathWithin(destDir, stage)) continue;
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(path.resolve(root, e.relPath), path.join(destDir, e.name));
        n++;
      } catch { /* 跳过 */ }
    }
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "Compress-Archive -Path (Join-Path $env:STAGE '*') -DestinationPath $env:ZIP -Force"], { env: { ...process.env, STAGE: stage, ZIP: zipPath }, timeout: 60_000 });
    const buf = await fs.promises.readFile(zipPath);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="guide-${ts}.zip"`, "X-Doc-Count": String(n) },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `打包失败:${e.message}` : "打包失败" }, { status: 500 });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
}

