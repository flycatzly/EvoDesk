import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "@/lib/db/client";
import { scanSkillsDirs, skillsDirsFromSettings, type SkillInfo } from "@/lib/domain/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execFileAsync = promisify(execFile);

/** 把扫描到的技能目录复制到暂存区(保留 <分类>/<技能名>/ 结构),返回暂存目录 */
export function stageSkills(skills: SkillInfo[], stageRoot: string): number {
  let staged = 0;
  for (const s of skills) {
    const skillDir = path.dirname(s.path);
    const dest = path.join(stageRoot, s.category, path.basename(skillDir));
    fs.cpSync(skillDir, dest, { recursive: true });
    staged++;
  }
  return staged;
}

// 导出技能包(zip):把全部已扫描技能按 <分类>/<技能名>/ 打包,解压进任意技能目录即可直接使用
export async function GET() {
  const db = getDb();
  const dirs = await skillsDirsFromSettings(db);
  const { skills } = scanSkillsDirs(dirs);
  if (skills.length === 0) {
    return NextResponse.json({ error: "未扫描到任何技能,先在技能地图执行扫描" }, { status: 400 });
  }
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stage = path.join(os.tmpdir(), `evodesk-skills-${token}`);
  const zipPath = path.join(os.tmpdir(), `evodesk-skills-${token}.zip`);
  try {
    fs.mkdirSync(stage, { recursive: true });
    stageSkills(skills, stage);
    // 经环境变量传路径,避免 PowerShell 引号/中文转义问题
    await execFileAsync("powershell.exe", [
      "-NoProfile", "-Command",
      "Compress-Archive -Path (Join-Path $env:STAGE '*') -DestinationPath $env:ZIP -Force",
    ], { env: { ...process.env, STAGE: stage, ZIP: zipPath }, timeout: 60_000 });
    const buf = await fs.promises.readFile(zipPath);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="evodesk-skills-${ts}.zip"`,
        "X-Skill-Count": String(skills.length),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `打包失败:${e.message}` : "打包失败" }, { status: 500 });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  }
}
