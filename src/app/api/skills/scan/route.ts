import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { scanSkillsDirs, skillsDirsFromSettings } from "@/lib/domain/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 技能地图扫描:读 settings.skills_dirs(缺省 ~/.agents/skills 与 ~/.claude/skills),只读扫描 SKILL.md
export async function GET() {
  const dirs = await skillsDirsFromSettings(getDb());
  const { skills, errors } = scanSkillsDirs(dirs);
  return NextResponse.json({ dirs, skills, errors });
}
