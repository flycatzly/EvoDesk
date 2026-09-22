"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type TtsStatus = { online: boolean; base: string; voice: string };

/** 语音合成(TTS)管理:Audio8_TTS 本地服务状态、地址/音色配置、试听。
 *  服务本体: D:\work\Audio8_TTS\onnx_runtime(bash start_server.sh,端口 8024)。 */
export function TtsSettings() {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [base, setBase] = useState("");
  const [voice, setVoice] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [speakBusy, setSpeakBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = (await (await fetch("/api/tts")).json()) as TtsStatus;
      setStatus(s);
      setBase(s.base);
      setVoice(s.voice ?? "");
    } catch {
      setStatus({ online: false, base: "http://127.0.0.1:8024", voice: "" });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ tts_base_url: base.trim(), tts_voice: voice.trim() }) });
      setMsg(res.ok ? "已保存" : "保存失败");
      if (res.ok) await load();
    } catch {
      setMsg("网络异常");
    } finally {
      setSaving(false);
    }
  };

  const speak = async (text: string) => {
    setSpeakBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: voice.trim() || undefined }) });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setMsg((d as { error?: string })?.error ?? "合成失败");
        return;
      }
      const blob = await res.blob();
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      setPlaying(true);
      await audio.play();
    } catch {
      setMsg("播放失败");
    } finally {
      setSpeakBusy(false);
    }
  };

  return (
    <div className="surface p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-sm font-medium">🔊 语音合成(TTS)</span>
        {status && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--surface-2)", color: status.online ? "var(--ok)" : "var(--danger)" }}>
            {status.online ? "● 服务在线" : "○ 服务离线"}
          </span>
        )}
        <button className="ghost-btn text-xs px-2 py-0.5 ml-auto" onClick={() => void load()}>刷新状态</button>
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
        基于 Audio8_TTS 本地 ONNX 服务(纯 CPU,支持中文/英文/粤语/日语等 11 种语言)。
        对话台每条 AI 回复旁有「🔊 转语音」按钮,点击即合成并播放。
      </p>

      <label className="block mb-3">
        <span className="text-sm block mb-1">服务地址</span>
        <input className="input w-full px-3 py-2 text-sm font-mono" value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://127.0.0.1:8024" />
      </label>
      <label className="block mb-3">
        <span className="text-sm block mb-1">音色(voice_name,留空用默认音色)</span>
        <input className="input w-full px-3 py-2 text-sm" value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="默认;注册音色后填音色名" />
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => void save()} disabled={saving} className="accent-btn px-4 py-2 text-sm">{saving ? "保存中…" : "保存配置"}</button>
        <button
          onClick={() => void speak("你好,这是 EvoDesk 语音合成测试。")}
          disabled={speakBusy || (status?.online === false)}
          className="ghost-btn px-4 py-2 text-sm"
          title={status?.online === false ? "服务离线,无法试听" : "合成并播放一句话"}
        >{speakBusy ? "合成中…(CPU 推理约 10-60 秒)" : playing ? "▶ 播放中…" : "🎧 试听"}</button>
        {msg && <span className="text-xs" style={{ color: "var(--accent)" }}>{msg}</span>}
      </div>

      <details className="mt-3">
        <summary className="text-xs cursor-pointer" style={{ color: "var(--muted)" }}>服务启动/排障(点开)</summary>
        <div className="text-xs mt-2 space-y-1.5" style={{ color: "var(--muted)" }}>
          <div>1. 启动服务(本机已安装于 <span className="font-mono" style={{ color: "var(--text)" }}>D:\work\Audio8_TTS\onnx_runtime</span>):</div>
          <div className="font-mono break-all rounded p-2" style={{ background: "var(--surface-2)", color: "var(--text)" }}>cd /d/work/Audio8_TTS/onnx_runtime && bash start_server.sh</div>
          <div>2. 就绪标志:<span className="font-mono">http://127.0.0.1:8024/api/health</span> 返回 ok;首次加载模型约需 10-30 秒。</div>
          <div>3. 音色克隆:参考音频注册接口见项目文档(POST /api/voices/register),注册后把音色名填到上方「音色」。</div>
          <div>4. 单次合成建议 ≤150 字,长文本请分段转换。</div>
        </div>
      </details>
    </div>
  );
}
