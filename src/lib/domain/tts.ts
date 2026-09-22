// Audio8 TTS(本地 ONNX Runtime 服务)集成:状态探测、多音色、音色克隆(注册)、参数化语音合成。
// 服务默认 127.0.0.1:8024(onnx_runtime/start_server.sh):
//   GET  /api/health            → 就绪状态
//   GET  /api/voices            → 已注册音色列表
//   GET  /api/registration/status → 音色注册(克隆)能力是否可用
//   POST /api/voices/register   → multipart 注册音色(audio/text/name/overwrite)
//   POST /api/tts               → {text, voice_name, max_new_tokens, temperature, top_p, seed} → WAV
// 设计为可选外挂:服务不在线时功能静默降级,不影响主流程。
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/db/test-util";
import { readSettingsKv } from "@/lib/db/read-settings";

export const TTS_DEFAULT_BASE = "http://127.0.0.1:8024";
export const TTS_DEFAULT_VOICE = "default"; // Audio8 要求必填音色;已注册名为 default 的默认音色
export const TTS_MAX_CHARS = 1000; // 模型建议单次 ≤150 字;上限放宽但 UI 提示分段
export const TTS_LANGUAGES = ["中文", "粤语", "英语", "日语", "韩语", "法语", "德语", "意大利语", "荷兰语", "波兰语", "西班牙语"] as const;

export interface TtsParams {
  temperature: number;
  topP: number;
  seed: number;
  maxTokens: number;
}

export function ttsConfig(db: Db): {
  base: string; voice: string; lang: string; voicesDir: string; params: TtsParams;
} {
  const kv = readSettingsKv(db);
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    base: typeof kv.tts_base_url === "string" && kv.tts_base_url.trim() ? kv.tts_base_url.trim().replace(/\/$/, "") : TTS_DEFAULT_BASE,
    voice: typeof kv.tts_voice === "string" && kv.tts_voice.trim() ? kv.tts_voice.trim() : TTS_DEFAULT_VOICE,
    lang: typeof kv.tts_lang === "string" && kv.tts_lang.trim() ? kv.tts_lang.trim() : "中文",
    voicesDir: typeof kv.tts_voices_dir === "string" && kv.tts_voices_dir.trim()
      ? kv.tts_voices_dir.trim()
      : path.join(process.cwd(), "..", "Audio8_TTS", "onnx_runtime", "voices"),
    params: {
      temperature: num(kv.tts_temperature, 0.3),
      topP: num(kv.tts_top_p, 0.9),
      seed: num(kv.tts_seed, 42),
      maxTokens: num(kv.tts_max_tokens, 512),
    },
  };
}

/** 音色 → 语言标签映射(注册时标注,存 settings.tts_voice_langs) */
export function voiceLangs(db: Db): Record<string, string> {
  const kv = readSettingsKv(db);
  return kv.tts_voice_langs && typeof kv.tts_voice_langs === "object" ? (kv.tts_voice_langs as Record<string, string>) : {};
}

/** 探测服务在线状态(3s 超时);在线时附带健康负载。 */
export async function ttsStatus(db: Db): Promise<{ online: boolean; base: string; voice: string; lang: string; health?: unknown }> {
  const { base, voice, lang } = ttsConfig(db);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${base}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    return { online: res.ok, base, voice, lang, health: res.ok ? await res.json().catch(() => null) : null };
  } catch {
    return { online: false, base, voice, lang };
  }
}

export type SpeakResult = { audio: Buffer; contentType: string };

/** 合成语音:调用 Audio8 /api/tts 返回 WAV 字节。支持音色与采样参数。 */
export async function ttsSpeak(
  db: Db,
  text: string,
  opts: { voice?: string; temperature?: number; topP?: number; seed?: number; maxTokens?: number } = {},
): Promise<SpeakResult> {
  const { base, voice, params } = ttsConfig(db);
  const clean = text.trim();
  if (!clean) throw new Error("text 必填");
  if (clean.length > TTS_MAX_CHARS) throw new Error(`文本过长(${clean.length} 字符),请分次转换(上限 ${TTS_MAX_CHARS})`);
  const body: Record<string, unknown> = {
    text: clean,
    voice_name: opts.voice?.trim() || voice || TTS_DEFAULT_VOICE,
    max_new_tokens: Math.min(2048, Math.max(16, Math.round(opts.maxTokens ?? params.maxTokens))),
    temperature: opts.temperature ?? params.temperature,
    top_p: opts.topP ?? params.topP,
    seed: opts.seed ?? params.seed,
  };
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

export type VoiceInfo = { name: string; lang?: string; frames?: number; referenceText?: string };

/** 已注册音色列表(合并语言标签) */
export async function listVoices(db: Db): Promise<{ online: boolean; base: string; voices: VoiceInfo[] }> {
  const { base } = ttsConfig(db);
  const langs = voiceLangs(db);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${base}/api/voices`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { online: false, base, voices: [] };
    const data = (await res.json()) as { voices?: (string | Record<string, unknown>)[] };
    const voices = (data.voices ?? []).map((v): VoiceInfo => {
      if (typeof v === "string") return { name: v, lang: langs[v] };
      const name = String(v.name ?? "");
      const shape = Array.isArray(v.shape) ? (v.shape as unknown[]) : null;
      return {
        name,
        lang: langs[name],
        frames: shape && typeof shape[1] === "number" ? shape[1] : undefined,
        referenceText: typeof v.reference_text === "string" ? v.reference_text : undefined,
      };
    });
    return { online: true, base, voices };
  } catch {
    return { online: false, base, voices: [] };
  }
}

/** 音色注册(克隆)能力是否可用 */
export async function registrationAvailable(db: Db): Promise<boolean> {
  const { base } = ttsConfig(db);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${base}/api/registration/status`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const d = (await res.json()) as { available?: boolean };
    return d.available === true;
  } catch {
    return false;
  }
}

/** 删除本地音色目录(voices/<name>/;name 做路径段校验防穿越) */
export function deleteVoice(db: Db, name: string): { ok: boolean; error?: string } {
  if (!name || /[\\/:*?"<>|]/.test(name) || name === "." || name === "..") return { ok: false, error: "非法音色名" };
  const { voicesDir } = ttsConfig(db);
  const dir = path.join(path.resolve(voicesDir), path.basename(name));
  if (!fs.existsSync(dir)) return { ok: false, error: "音色不存在" };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}
