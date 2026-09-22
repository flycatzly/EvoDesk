import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { ttsStatus, ttsSpeak, listVoices, registrationAvailable, TTS_MAX_CHARS, TTS_LANGUAGES } from "@/lib/domain/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/tts → Audio8 服务状态 + 配置 + 音色列表 + 克隆能力(设置页管理卡片与对话台音色选择共用)
export async function GET() {
  const db = getDb();
  const status = await ttsStatus(db);
  const [voices, reg] = await Promise.all([listVoices(db), registrationAvailable(db)]);
  return NextResponse.json({ ...status, voices: voices.voices, registrationAvailable: reg, languages: TTS_LANGUAGES, maxChars: TTS_MAX_CHARS });
}

// POST /api/tts {text, voice?, temperature?, top_p?, seed?, max_tokens?} → audio/wav 二进制
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const text = body && typeof body.text === "string" ? body.text : "";
  const voice = body && typeof body.voice === "string" ? body.voice : undefined;
  const numOr = (k: string) => (body && typeof body[k] === "number" && Number.isFinite(body[k]) ? (body[k] as number) : undefined);
  if (!text.trim()) return NextResponse.json({ error: "text 必填" }, { status: 400 });
  if (text.length > TTS_MAX_CHARS) return NextResponse.json({ error: `文本过长,上限 ${TTS_MAX_CHARS} 字符` }, { status: 400 });

  const db = getDb();
  try {
    const { audio, contentType } = await ttsSpeak(db, text, {
      voice,
      temperature: numOr("temperature"),
      topP: numOr("top_p"),
      seed: numOr("seed"),
      maxTokens: numOr("max_tokens"),
    });
    return new Response(new Uint8Array(audio), {
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "语音合成失败";
    const offline = /fetch failed|ECONNREFUSED|abort/i.test(msg);
    return NextResponse.json(
      { error: offline ? "TTS 服务不在线:请在设置 → 语音合成(TTS)中启动 Audio8 服务" : msg },
      { status: offline ? 503 : 500 },
    );
  }
}
