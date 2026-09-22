"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type VoiceInfo = { name: string; lang?: string; frames?: number; referenceText?: string };
type TtsState = {
  online: boolean; base: string; voice: string; lang: string;
  voices: VoiceInfo[]; registrationAvailable: boolean; languages: string[]; maxChars: number;
};

const LANGS = ["中文", "粤语", "英语", "日语", "韩语", "法语", "德语", "意大利语", "荷兰语", "波兰语", "西班牙语"];

/** 语音合成(TTS)管理:Audio8_TTS 全功能管理 —— 服务状态、默认音色/语言、采样参数、
 *  克隆音色(上传参考音频注册)、音色列表(试听/删除)、试听。 */
export function TtsSettings() {
  const [st, setSt] = useState<TtsState | null>(null);
  const [base, setBase] = useState("");
  const [voice, setVoice] = useState("default");
  const [lang, setLang] = useState("中文");
  const [temperature, setTemperature] = useState(0.3);
  const [topP, setTopP] = useState(0.9);
  const [seed, setSeed] = useState(42);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [speakBusy, setSpeakBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 克隆音色表单
  const [file, setFile] = useState<File | null>(null);
  const [refText, setRefText] = useState("");
  const [newName, setNewName] = useState("");
  const [newLang, setNewLang] = useState("中文");
  const [regBusy, setRegBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = (await (await fetch("/api/tts")).json()) as TtsState;
      setSt(s);
      setBase(s.base);
      setVoice(s.voice ?? "default");
      setLang(s.lang ?? "中文");
    } catch {
      setSt({ online: false, base: "http://127.0.0.1:8024", voice: "default", lang: "中文", voices: [], registrationAvailable: false, languages: LANGS, maxChars: 1000 });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ tts_base_url: base.trim(), tts_voice: voice.trim(), tts_lang: lang, tts_temperature: temperature, tts_top_p: topP, tts_seed: seed }),
      });
      setMsg(res.ok ? "已保存" : "保存失败");
      if (res.ok) await load();
    } catch {
      setMsg("网络异常");
    } finally {
      setSaving(false);
    }
  };

  const speak = async (text: string, v?: string) => {
    setSpeakBusy(v ?? "default");
    setMsg(null);
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: voice.trim() ? voice.trim() : undefined }) });
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
      setSpeakBusy(null);
    }
  };

  const registerVoice = async () => {
    if (!file) { setMsg("请选择参考音频文件(wav/mp3,0.5-30 秒)"); return; }
    if (!refText.trim()) { setMsg("参考原文必填:须与音频中实际说出的内容一致"); return; }
    if (!/^[a-zA-Z0-9_\-]{1,64}$/.test(newName.trim())) { setMsg("音色名须为字母/数字/下划线/连字符(1-64 位)"); return; }
    setRegBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("audio", file);
      fd.append("text", refText.trim());
      fd.append("name", newName.trim());
      fd.append("language", newLang);
      fd.append("overwrite", "true");
      const res = await fetch("/api/tts/voices", { method: "POST", body: fd });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setMsg((d as { error?: string })?.error ?? "注册失败"); return; }
      setMsg(`音色「${newName.trim()}」注册成功(${(d as { frames?: number })?.frames ?? "?"} 帧),已可用于对话台与试听`);
      setFile(null);
      setRefText("");
      await load();
    } catch {
      setMsg("注册请求失败");
    } finally {
      setRegBusy(false);
    }
  };

  const removeVoice = async (name: string) => {
    if (!window.confirm(`删除音色「${name}」?不可恢复。`)) return;
    const res = await fetch(`/api/tts/voices?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (res.ok) { setMsg(`已删除音色:${name}`); await load(); }
    else setMsg("删除失败");
  };

  return (
    <div className="surface p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-sm font-medium">🔊 语音合成(TTS)</span>
        {st && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--surface-2)", color: st.online ? "var(--ok)" : "var(--danger)" }}>
            {st.online ? "● 服务在线" : "○ 服务离线"}
          </span>
        )}
        {st && <span className="text-xs" style={{ color: "var(--muted)" }}>{st.voices.length} 个音色</span>}
        <button className="ghost-btn text-xs px-2 py-0.5 ml-auto" onClick={() => void load()}>刷新状态</button>
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
        基于 Audio8_TTS 本地 ONNX 服务(纯 CPU):多音色可选、参考音频克隆音色、11 种语言。
        对话台工具栏可选音色与语言,每条 AI 回复旁有「🔊 转语音」。
      </p>

      <label className="block mb-3">
        <span className="text-sm block mb-1">服务地址</span>
        <input className="input w-full px-3 py-2 text-sm font-mono" value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://127.0.0.1:8024" />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <label className="block">
          <span className="text-sm block mb-1">默认音色</span>
          <input className="input w-full px-3 py-2 text-sm" value={voice} onChange={(e) => setVoice(e.target.value)} list="tts-voice-options" />
          <datalist id="tts-voice-options">
            {(st?.voices ?? []).map((v) => <option key={v.name} value={v.name} />)}
          </datalist>
        </label>
        <label className="block">
          <span className="text-sm block mb-1">首选语言</span>
          <select className="input w-full px-3 py-2 text-sm" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-sm block mb-1">Temperature(采样,默认 0.3)</span>
          <input type="number" min={0.05} max={2} step={0.05} className="input w-full px-3 py-2 text-sm" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => void save()} disabled={saving} className="accent-btn px-4 py-2 text-sm">{saving ? "保存中…" : "保存配置"}</button>
        <button
          onClick={() => void speak("你好,这是 EvoDesk 语音合成测试。")}
          disabled={speakBusy !== null || st?.online === false}
          className="ghost-btn px-4 py-2 text-sm"
          title={st?.online === false ? "服务离线,无法试听" : "用默认音色合成并播放"}
        >{speakBusy === "default" ? "合成中…(约 10-60 秒)" : playing ? "▶ 播放中…" : "🎧 试听"}</button>
        {msg && <span className="text-xs" style={{ color: "var(--accent)" }}>{msg}</span>}
      </div>

      {/* 音色列表 */}
      {st && st.voices.length > 0 && (
        <div className="mt-4">
          <div className="text-xs mb-1.5" style={{ color: "var(--muted)" }}>已注册音色({st.voices.length})</div>
          <div className="space-y-1.5 max-h-52 overflow-auto chat-scroll">
            {st.voices.map((v) => (
              <div key={v.name} className="flex items-center gap-2 text-xs p-2 rounded" style={{ background: "var(--surface-2)" }}>
                <span className="font-medium" style={{ color: "var(--text)" }}>{v.name}</span>
                {v.lang && <span className="px-1.5 rounded" style={{ background: "var(--surface)", color: "var(--accent)" }}>{v.lang}</span>}
                {v.frames ? <span className="font-mono" style={{ color: "var(--muted)" }}>{v.frames} 帧</span> : null}
                <button className="ghost-btn text-xs px-2 py-0.5 ml-auto" disabled={speakBusy !== null} onClick={() => void speak(`这是音色${v.name}的试听。`, v.name)}>🎧 试听</button>
                <button className="ghost-btn text-xs px-2 py-0.5" style={{ color: "var(--danger)" }} onClick={() => void removeVoice(v.name)}>删除</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 克隆音色 */}
      <div className="mt-4 p-3 rounded" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <div className="text-sm font-medium mb-1">🎤 克隆音色(零样本:上传一段参考音频 + 它的准确原文)</div>
        <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          音频 0.5-30 秒、≤50MB、发音清晰;原文须与音频内容逐字一致。注册后即可在对话台选择该音色朗读。
        </p>
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <input type="file" accept="audio/wav,audio/mpeg,audio/x-wav" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <input className="input px-2 py-1.5 text-xs max-w-44" placeholder="音色名(如 my_voice)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select className="input px-2 py-1.5 text-xs max-w-28" value={newLang} onChange={(e) => setNewLang(e.target.value)}>
            {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <textarea className="input w-full px-3 py-2 text-xs mb-2" rows={2} placeholder="参考原文(与音频内容逐字一致)" value={refText} onChange={(e) => setRefText(e.target.value)} />
        <button className="accent-btn px-3 py-1.5 text-xs" disabled={regBusy || !st?.registrationAvailable} onClick={() => void registerVoice()}>
          {regBusy ? "注册中…(加载编码模型,可能 1-2 分钟)" : "🎤 注册音色"}
        </button>
        {st && !st.registrationAvailable && (
          <span className="text-xs ml-2" style={{ color: "var(--warn)" }}>注册能力不可用:缺少 registration 编码模型</span>
        )}
      </div>

      <details className="mt-3">
        <summary className="text-xs cursor-pointer" style={{ color: "var(--muted)" }}>服务启动/排障(点开)</summary>
        <div className="text-xs mt-2 space-y-1.5" style={{ color: "var(--muted)" }}>
          <div>1. 启动服务(本机安装于 <span className="font-mono" style={{ color: "var(--text)" }}>D:\work\Audio8_TTS\onnx_runtime</span>):</div>
          <div className="font-mono break-all rounded p-2" style={{ background: "var(--surface-2)", color: "var(--text)" }}>cd /d/work/Audio8_TTS/onnx_runtime && ARKTTS_MODEL_DIR=$PWD/model ARKTTS_VOICES_DIR=$PWD/voices .venv/Scripts/python.exe -m uvicorn arktts_runtime.service:app --app-dir . --port 8024</div>
          <div>2. 就绪标志:<span className="font-mono">http://127.0.0.1:8024/api/health</span> 返回 ok;首次加载模型约 10-30 秒。</div>
          <div>3. 单次合成建议 ≤150 字;语言由文本与音色决定(模型原生支持 11 种语言,无需手动切换引擎)。</div>
        </div>
      </details>
    </div>
  );
}
