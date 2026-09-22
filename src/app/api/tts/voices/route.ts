import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { readSettingsKv } from "@/lib/db/read-settings";
import { listVoices, deleteVoice } from "@/lib/domain/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 音色管理:GET 列表 / POST 注册(克隆,multipart 转发) / DELETE 删除
export async function GET() {
  const db = getDb();
  const { voices } = await listVoices(db);
  return NextResponse.json({ voices });
}

// POST /api/tts/voices/register(multipart: audio 文件 + text 参考原文 + name + language + overwrite)
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求须为 multipart 表单(audio/text/name)" }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof File)) return NextResponse.json({ error: "缺少参考音频文件(audio)" }, { status: 400 });
  if (audio.size > 50 * 1024 * 1024) return NextResponse.json({ error: "参考音频超过 50MB 上限" }, { status: 400 });
  const name = typeof form.get("name") === "string" ? String(form.get("name")).trim() : "";
  if (!/^[a-zA-Z0-9_\-]{1,64}$/.test(name)) return NextResponse.json({ error: "音色名须为字母/数字/下划线/连字符(1-64 位)" }, { status: 400 });
  const text = typeof form.get("text") === "string" ? String(form.get("text")).trim() : "";
  if (!text) return NextResponse.json({ error: "参考原文(text)必填:须与音频中实际说出的内容一致" }, { status: 400 });
  const language = typeof form.get("language") === "string" ? String(form.get("language")).trim() : "";

  const db = getDb();
  const { base } = (await import("@/lib/domain/tts")).ttsConfig(db);
  // multipart 原样转发到 Audio8 服务
  const up = new FormData();
  up.append("audio", audio, audio.name || "reference.wav");
  up.append("text", text);
  up.append("name", name);
  up.append("overwrite", String(form.get("overwrite") === "true"));
  let res: Response;
  try {
    res = await fetch(`${base}/api/voices/register`, { method: "POST", body: up, signal: AbortSignal.timeout(180_000) });
  } catch {
    return NextResponse.json({ error: "TTS 服务不在线或不可达" }, { status: 503 });
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : `注册失败(HTTP ${res.status})`;
    return NextResponse.json({ error: detail }, { status: 502 });
  }
  // 语言标注:存 settings.tts_voice_langs 映射,供对话台音色选择器显示与分组
  if (language) {
    const kv = readSettingsKv(db);
    const map = (kv.tts_voice_langs && typeof kv.tts_voice_langs === "object" ? { ...(kv.tts_voice_langs as Record<string, string>) } : {});
    map[name] = language;
    const value = JSON.stringify(map);
    const existing = db.select().from(settings).where(eq(settings.key, "tts_voice_langs")).all()[0];
    if (existing) db.update(settings).set({ value }).where(eq(settings.key, "tts_voice_langs")).run();
    else db.insert(settings).values({ key: "tts_voice_langs", value }).run();
  }
  return NextResponse.json({ ok: true, name, frames: (data?.voice as { shape?: [number, number] } | undefined)?.shape?.[1] ?? null });
}

// DELETE /api/tts/voices?name=xxx → 删除本地音色目录
export async function DELETE(req: NextRequest) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  const db = getDb();
  const r = deleteVoice(db, name);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
