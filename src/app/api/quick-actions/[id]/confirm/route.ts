import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { quickActions, quickActionRuns, providerProfiles } from "@/lib/db/schema";
import { renderQuickPayload, runCommandAction, resolveWorkingDir } from "@/lib/domain/quick-actions";
import { spawnClaude, sanitizeModelName, isValidModelName, sweepStaleSettings } from "@/lib/domain/launch";
import { resolveApiKey } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const MAX_OUTPUT_CHARS = 65_536; // quick_action_runs.output 截断上限(64KB)

/** launch payload 解析:非法或缺 profile_id 返回 null(调用方回 400) */
function parseLaunchPayload(payload: string): { profile_id: string; model?: string; workdir?: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.profile_id !== "string" || !o.profile_id.trim()) return null;
  return { profile_id: o.profile_id, model: typeof o.model === "string" ? o.model : undefined, workdir: typeof o.workdir === "string" ? o.workdir : undefined };
}

function recordRun(db: ReturnType<typeof getDb>, run: Omit<typeof quickActionRuns.$inferInsert, "id" | "ts">) {
  const row = { id: crypto.randomUUID(), ts: new Date().toISOString(), ...run };
  db.insert(quickActionRuns).values(row).run();
  return row;
}

export async function POST(req: NextRequest, { params }: Params) {
  sweepStaleSettings(); // 崩溃残留兜底:fire-and-forget,不影响本次执行
  const { id } = await params;
  const db = getDb();
  const action = db.select().from(quickActions).where(eq(quickActions.id, id)).all()[0];
  if (!action) return NextResponse.json({ error: "快捷指令不存在" }, { status: 404 });
  if (!action.enabled) return NextResponse.json({ error: "快捷指令已禁用" }, { status: 409 });
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const taskTitle = typeof body.task_title === "string" ? body.task_title : "";

  try {
    if (action.type === "command") {
      const rendered = renderQuickPayload(action, { title: taskTitle });
      let workdir: string;
      try {
        workdir = resolveWorkingDir(null); // v1 固定沙盒目录;白名单外 → 409
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 409 });
      }
      const r = await runCommandAction(rendered, action.shell ?? "powershell", workdir);
      const run = recordRun(db, {
        actionId: action.id,
        renderedPayload: rendered,
        output: r.output.slice(0, MAX_OUTPUT_CHARS),
        exitCode: r.exitCode,
        status: r.status,
        durationMs: r.durationMs,
      });
      const runs = db.select().from(quickActionRuns).orderBy(desc(quickActionRuns.ts)).limit(20).all();
      return NextResponse.json({ run, runs });
    }
    if (action.type === "url") {
      // 不真正打开:由前端 window.open,这里只记 run
      const run = recordRun(db, {
        actionId: action.id,
        renderedPayload: action.payload,
        output: action.payload,
        exitCode: null,
        status: "ok",
        durationMs: 0,
      });
      return NextResponse.json({ run, url: action.payload });
    }
    // launch:手写最小 settings(不经 buildLaunchSettings——那是给完整 profile raw 用的)
    const spec = parseLaunchPayload(action.payload);
    if (!spec) return NextResponse.json({ error: "launch 型 payload 须为 JSON 且含 profile_id" }, { status: 400 });
    const profile = db.select().from(providerProfiles).where(eq(providerProfiles.id, spec.profile_id)).all()[0];
    if (!profile) return NextResponse.json({ error: "档案不存在" }, { status: 404 });
    const key = resolveApiKey(profile.apiKeyRef);
    if (!key) return NextResponse.json({ error: "档案密钥未配置" }, { status: 409 });
    const model = spec.model || null;
    if (model && !isValidModelName(model)) return NextResponse.json({ error: `模型名含非法字符:${model}` }, { status: 400 });
    const workdir = spec.workdir || process.cwd();
    const env: Record<string, string> = { ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_BASE_URL: profile.apiBase };
    if (model) env.ANTHROPIC_MODEL = model;
    // 含密钥文件只落 data/generated(已 gitignore);启动后 1s 延迟删除
    const outDir = path.join(process.cwd(), "data", "generated");
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `launch-${sanitizeModelName(model ?? "default")}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ env, ...(model ? { model } : {}) }, null, 2), "utf8");
    const res = await spawnClaude(file, model, workdir, false);
    const timer = setTimeout(() => {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* 尽力删除 */
      }
    }, 1000);
    timer.unref();
    const argsPreview = `claude.cmd --settings "${file}"${model ? ` --model ${model}` : ""}`;
    const run = recordRun(db, {
      actionId: action.id,
      renderedPayload: argsPreview,
      output: res.detail.slice(0, MAX_OUTPUT_CHARS),
      exitCode: null,
      status: res.status,
      durationMs: 0,
    });
    return NextResponse.json({ run });
  } catch (e) {
    return NextResponse.json({ error: `执行失败:${(e as Error).message}` }, { status: 502 });
  }
}
