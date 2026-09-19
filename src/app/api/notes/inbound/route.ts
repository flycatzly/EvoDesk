import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "@/lib/db/client";
import { readSettingsKv } from "@/lib/db/read-settings";
import { resolveVaultRoot } from "@/lib/domain/vault";
import { isPathWithin } from "@/lib/domain/script-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execFileAsync = promisify(execFile);

/**
 * 入站随记(对标微信随记机器人,但不需要额外主机):
 * 手机快捷指令(iOS Shortcuts / Android Tasker / 微信收件转发工具)直接 POST 一段文字到这里,
 * 原样存为 Obsidian 库随记目录里的 md 文件;可选自动 git 提交推送,多端 Obsidian 拉取即见。
 *
 * 鉴权:POST /api/notes/inbound?token=<settings.inbound_token>
 * Body:JSON {text, title?} 或纯文本(text/plain)
 * 保存:随记目录 = <vault>/随记/;文件名 = MMDD-HHmm_标题.md(冲突加序号)
 * 同步:settings.inbound_git_push = true 时,保存后自动 commit+push(只提交该文件)
 */

function safeTitle(t: string): string {
  const cleaned = t.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return cleaned || "随记";
}

function inboundDir(db: ReturnType<typeof getDb>): { root: string; dir: string; rel: string } | null {
  const vaultRoot = resolveVaultRoot(db, null);
  if (!vaultRoot) return null;
  const kv = readSettingsKv(db);
  const sub = typeof kv.inbound_subdir === "string" && kv.inbound_subdir.trim() ? kv.inbound_subdir.trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 40) : "随记";
  const dir = path.resolve(vaultRoot, sub);
  if (!isPathWithin(dir, vaultRoot)) return null;
  return { root: vaultRoot, dir, rel: sub };
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const kv = readSettingsKv(db);
  const token = typeof kv.inbound_token === "string" ? kv.inbound_token : "";
  const given = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-inbound-token") ?? "";
  if (!token || given !== token) {
    return NextResponse.json({ error: "未授权:请在设置页生成随记令牌,并携带 ?token= 或 x-inbound-token 头" }, { status: 401 });
  }

  // 兼容两种投递:JSON {text,title} 与纯文本(快捷指令最简形态)
  const contentType = req.headers.get("content-type") ?? "";
  let text = "";
  let customTitle = "";
  if (contentType.includes("application/json")) {
    const raw = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    text = body && typeof body.text === "string" ? body.text : "";
    customTitle = body && typeof body.title === "string" ? body.title : "";
  } else {
    text = await req.text();
  }
  text = text.replace(/\r\n/g, "\n").trim();
  if (!text) return NextResponse.json({ error: "text 必填(随记内容)" }, { status: 400 });

  const target = inboundDir(db);
  if (!target) return NextResponse.json({ error: "无可用 Obsidian 资料库:先在设置配置 vault 路径" }, { status: 400 });

  fs.mkdirSync(target.dir, { recursive: true });
  const now = new Date();
  const stamp = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const title = safeTitle(customTitle || text.split("\n")[0]);
  const existing = new Set(fs.readdirSync(target.dir).map((n) => n.toLowerCase()));
  let fileName = `${stamp}_${safeTitle(title)}.md`;
  let i = 1;
  while (existing.has(fileName.toLowerCase())) fileName = `${stamp}_${safeTitle(title)}(${i++}).md`;

  const frontmatter = `---\ntitle: ${safeTitle(title)}\nsource: inbound\ndate: ${now.toISOString()}\n---\n\n${text}\n`;
  const filePath = path.join(target.dir, fileName);
  // 原子写
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, frontmatter, "utf8");
  fs.renameSync(tmp, filePath);

  // 复读校验(文章要点:确认原文无遗漏)
  const written = fs.readFileSync(filePath, "utf8");
  if (!written.includes(text)) {
    return NextResponse.json({ error: "保存校验失败(内容不完整),请重试" }, { status: 500 });
  }

  // 可选 git 同步:只 add 本文件 → commit → push;失败不影响保存结果(返回 warning)
  let gitNote: string | null = null;
  if (kv.inbound_git_push === true) {
    try {
      const opts = { cwd: target.root, timeout: 30_000 };
      await execFileAsync("git", ["add", path.join(target.rel, fileName)], opts);
      await execFileAsync("git", ["commit", "-m", `随记 ${now.toISOString().slice(0, 16)} ${title}`], opts);
      await execFileAsync("git", ["pull", "--rebase"], opts);
      await execFileAsync("git", ["push"], opts);
      gitNote = "已提交并推送";
    } catch (e) {
      gitNote = `已保存,同步失败:${e instanceof Error ? e.message.slice(0, 100) : "git 异常"}`;
    }
  }

  return NextResponse.json({ ok: true, file: fileName, synced: kv.inbound_git_push === true, gitNote });
}

// 生成/重置随记令牌(GET = 查看是否存在,POST = 生成新令牌)
export async function GET() {
  const kv = readSettingsKv(getDb());
  return NextResponse.json({ hasToken: typeof kv.inbound_token === "string" && kv.inbound_token.length > 0 });
}

export async function PUT(req: NextRequest) {
  void req;
  const token = crypto.randomUUID().replace(/-/g, "");
  const db = getDb();
  const value = JSON.stringify(token);
  const { settings } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const r = db.update(settings).set({ value }).where(eq(settings.key, "inbound_token")).run();
  if (r.changes === 0) db.insert(settings).values({ key: "inbound_token", value }).run();
  return NextResponse.json({ ok: true, token });
}
