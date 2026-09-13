import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import { skillsDirsFromSettings, expandHome } from "@/lib/domain/skills";
import { isValidSkillSlug, skillNameFromMd } from "@/lib/domain/skill-create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_CONTENT = 65_536;

// 安装技能(POST {content, dir?, name?, overwrite?}):写入白名单技能目录 <dir>/<slug>/SKILL.md。
// dir 必须在 settings.skills_dirs 白名单内;默认不覆盖已存在技能。
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const content = body && typeof body.content === "string" ? body.content : "";
  if (!content.startsWith("---") || content.length > MAX_CONTENT) {
    return NextResponse.json({ error: "content 须为 SKILL.md(frontmatter 开头,≤64KB)" }, { status: 400 });
  }
  const name = body && typeof body.name === "string" && body.name.trim() ? body.name.trim() : skillNameFromMd(content, "");
  if (!isValidSkillSlug(name)) {
    return NextResponse.json({ error: "技能名须为小写字母/数字/连字符(1-64 位)" }, { status: 400 });
  }
  const whitelist = skillsDirsFromSettings(getDb());
  const requestedDir = body && typeof body.dir === "string" && body.dir.trim() ? expandHome(body.dir.trim()) : whitelist[0];
  const dir = whitelist.find((d) => path.resolve(d) === path.resolve(requestedDir ?? ""));
  if (!dir) {
    return NextResponse.json({ error: "目标目录不在技能目录白名单内" }, { status: 400 });
  }
  const targetDir = path.join(dir, name);
  const target = path.join(targetDir, "SKILL.md");
  if (fs.existsSync(target) && !(body && body.overwrite === true)) {
    return NextResponse.json({ error: `技能已存在:${name}(可勾选覆盖)`, exists: true }, { status: 409 });
  }
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return NextResponse.json({ ok: true, path: target });
}
