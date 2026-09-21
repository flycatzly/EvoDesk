import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { quickActions, providerProfiles } from "@/lib/db/schema";
import { renderQuickPayload } from "@/lib/domain/quick-actions";
import { scanRisk } from "@/lib/domain/script-security";
import { resolveWorkingDir } from "@/lib/domain/quick-actions";
import { buildLaunchSettings, spawnClaude, parseLaunchPayload } from "@/lib/domain/launch";
import { resolveApiKey } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body || typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id 必填" }, { status: 400 });
  }
  const db = await getAnyDb();
  const action = db.select().from(quickActions).where(eq(quickActions.id, body.id)).all()[0];
  if (!action) return NextResponse.json({ error: "快捷指令不存在" }, { status: 404 });
  if (!action.enabled) return NextResponse.json({ error: "快捷指令已禁用" }, { status: 409 });
  const taskTitle = typeof body.task_title === "string" ? body.task_title : "";

  try {
    if (action.type === "command") {
      const rendered = renderQuickPayload(action, { title: taskTitle });
      const risks = scanRisk(rendered);
      let workingDir: string;
      try {
        workingDir = resolveWorkingDir(null); // v1 固定沙盒目录(白名单内)
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 409 });
      }
      return NextResponse.json({ action, rendered, risks, workingDir, awaiting: true });
    }
    if (action.type === "launch") {
      const spec = parseLaunchPayload(action.payload);
      if (!spec) return NextResponse.json({ error: "launch 型 payload 须为 JSON 且含 profile_id" }, { status: 400 });
      const profile = db.select().from(providerProfiles).where(eq(providerProfiles.id, spec.profile_id)).all()[0];
      if (!profile) return NextResponse.json({ error: "档案不存在" }, { status: 404 });
      const model = spec.model || null;
      const workdir = spec.workdir || process.cwd();
      // DryRun 语义:不真正 spawn;生成含密钥的 settings 文件仅用于拼预览命令,拿到预览立即删除
      const key = resolveApiKey(profile.apiKeyRef);
      const rawSettings = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_BASE_URL: profile.apiBase } });
      const file = buildLaunchSettings(rawSettings, model);
      const preview = await spawnClaude(file, model, workdir, true);
      fs.rmSync(file, { force: true }); // preview 不留含密钥文件
      return NextResponse.json({ action, rendered: preview.detail, risks: [], model, workdir, awaiting: true });
    }
    // url:直接打开,无需确认,但返回给 UI 展示
    return NextResponse.json({ action, rendered: action.payload, risks: [], awaiting: false });
  } catch (e) {
    return NextResponse.json({ error: `预览失败:${(e as Error).message}` }, { status: 502 });
  }
}
