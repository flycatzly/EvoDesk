// Audio8 TTS(本地 ONNX Runtime 服务)集成:状态探测与语音合成。
// 服务默认 127.0.0.1:8024(onnx_runtime/start_server.sh),接口 POST /api/tts → WAV。
// 设计为可选外挂:服务不在线时功能静默降级,不影响主流程。
import type { Db } from "@/lib/db/test-util";
import { readSettingsKv } from "@/lib/db/read-settings";

export const TTS_DEFAULT_BASE = "http://127.0.0.1:8024";
export const TTS_DEFAULT_VOICE = "default"; // Audio8 要求必填音色;已注册名为 default 的默认音色
export const TTS_MAX_CHARS = 1000; // 模型建议单次 ≤150 字;上限放宽但 UI 提示分段

export function ttsConfig(db: Db): { base: string; voice: string } {
  const kv = readSettingsKv(db);
  const base = typeof kv.tts_base_url === "string" && kv.tts_base_url.trim() ? kv.tts_base_url.trim().replace(/\/$/, "") : TTS_DEFAULT_BASE;
  const voice = typeof kv.tts_voice === "string" && kv.tts_voice.trim() ? kv.tts_voice.trim() : TTS_DEFAULT_VOICE;
  return { base, voice };
}

/** 探测服务在线状态(3s 超时);在线时附带健康负载。 */
export async function ttsStatus(db: Db): Promise<{ online: boolean; base: string; voice: string; health?: unknown }> {
  const { base, voice } = ttsConfig(db);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${base}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    return { online: res.ok, base, voice, health: res.ok ? await res.json().catch(() => null) : null };
  } catch {
    return { online: false, base, voice };
  }
}

export type SpeakResult = { audio: Buffer; contentType: string };

/** 合成语音:调用 Audio8 /api/tts 返回 WAV 字节。voice 为空用服务默认音色。 */
export async function ttsSpeak(db: Db, text: string, voiceOverride?: string): Promise<SpeakResult> {
  const { base, voice } = ttsConfig(db);
  const clean = text.trim();
  if (!clean) throw new Error("text 必填");
  if (clean.length > TTS_MAX_CHARS) throw new Error(`文本过长(${clean.length} 字符),请分次转换(上限 ${TTS_MAX_CHARS})`);
  const body: Record<string, unknown> = { text: clean, max_new_tokens: 512 };
  // Audio8 服务要求 voice_name 必填;未配置时用已注册的默认音色
  body.voice_name = voiceOverride?.trim() || voice || TTS_DEFAULT_VOICE;
  const controller = new AbortController();
  // CPU 推理较慢:首句可能 10-60s,超时放宽到 180s
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(`${base}/api/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`TTS 服务返回 ${res.status}:${detail.slice(0, 120)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("TTS 服务返回空音频");
    return { audio: buf, contentType: res.headers.get("content-type") ?? "audio/wav" };
  } finally {
    clearTimeout(timer);
  }
}
