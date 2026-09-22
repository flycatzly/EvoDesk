"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Msg { id: string; role: string; content: string; model: string | null; costUsd: number; tokensIn?: number; tokensOut?: number }

export function ChatView({ chats, activeId, initialMessages, modelGroups, hasAnyModel, mode = "chat", basePath = "/chat" }: {
  chats: { id: string; title: string; workdir: string | null; mode?: string }[];
  activeId: string | null;
  initialMessages: Msg[];
  modelGroups: { executorId: string; label: string; group: string }[];
  hasAnyModel: boolean;
  mode?: "chat" | "coach";
  basePath?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [executorId, setExecutorId] = useState<string>(modelGroups[0]?.executorId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [mgrOpen, setMgrOpen] = useState(false);
  // 会话管理:改名中的会话 id → 新标题;编辑目录中的会话 id → 目录草稿
  const [renaming, setRenaming] = useState<Record<string, string>>({});
  const [dirEditing, setDirEditing] = useState<Record<string, string>>({});
  // 撑满屏幕 / 多选分享 / 复制反馈
  const [maxi, setMaxi] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 转语音:正在合成/播放的消息 id(再点一次停止)
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [ttsBusyId, setTtsBusyId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 转语音配置:音色/语言(多音色可选,音色自带口音语言;语言为标注与偏好)
  const [ttsVoices, setTtsVoices] = useState<{ name: string; lang?: string }[]>([]);
  const [ttsVoice, setTtsVoice] = useState<string>("");
  const [ttsLang, setTtsLang] = useState<string>("中文");
  useEffect(() => {
    setTtsVoice(localStorage.getItem("tts-voice") ?? "");
    setTtsLang(localStorage.getItem("tts-lang") ?? "中文");
    void (async () => {
      try {
        const d = (await (await fetch("/api/tts")).json()) as { voices?: { name: string; lang?: string }[] };
        setTtsVoices(d.voices ?? []);
      } catch { /* TTS 离线不影响对话 */ }
    })();
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeChat = chats.find((c) => c.id === activeId) ?? null;
  // 会话模式以当前会话自身的 mode 为准(教练并入对话台:同一页面承载 chat/coach 两种会话)
  const effectiveMode: "chat" | "coach" = (activeChat?.mode as "chat" | "coach" | undefined) ?? mode;

  const groups = [...new Set(modelGroups.map((g) => g.group))];
  // 自动滚动:新消息加入时贴底(流式 delta 期间由 done 分支兜底滚动)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = async () => {
    if (!input.trim() || streaming || !activeId) return;
    setError(null);
    const userMsg: Msg = { id: `tmp-${Date.now()}`, role: "user", content: input, model: null, costUsd: 0, tokensIn: 0, tokensOut: 0 };
    const assistantId = `tmp-a-${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: assistantId, role: "assistant", content: "", model: null, costUsd: 0, tokensIn: 0, tokensOut: 0 }]);
    const text = input;
    setInput("");
    setStreaming(true);
    try {
      const res = await fetch(`/api/chats/${activeId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, executor_id: executorId || undefined }) });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setError(data?.error ?? "发送失败,请重试");
        setMessages((m) => m.filter((x) => x.id !== userMsg.id && x.id !== assistantId));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          if (!block.startsWith("data:")) continue;
          // 解析失败(半截块/非 JSON 噪声)跳过该块,不中断整个流
          let evt: { delta?: string; done?: boolean; error?: string; message?: { id: string; role: string; content: string; model: string | null; costUsd: number; tokensIn?: number; tokensOut?: number } };
          try { evt = JSON.parse(block.slice(5).trim()); } catch { continue; }
          if (evt.delta) setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, content: x.content + evt.delta } : x)));
          if (evt.done) {
            if (evt.error) { setError(evt.error); setMessages((m) => m.filter((x) => x.id !== assistantId)); }
            else if (evt.message) setMessages((m) => m.map((x) => (x.id === assistantId ? { id: evt.message!.id, role: "assistant", content: evt.message!.content, model: evt.message!.model, costUsd: evt.message!.costUsd, tokensIn: evt.message!.tokensIn ?? 0, tokensOut: evt.message!.tokensOut ?? 0 } : x)));
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }
        }
      }
    } catch {
      setError("网络中断,请重试");
      // 请求异常(网络层):乐观消息未获服务端确认,一并移除避免幽灵气泡
      setMessages((m) => m.filter((x) => x.id !== userMsg.id && x.id !== assistantId));
    } finally {
      setStreaming(false);
      router.refresh();
    }
  };

  // —— 转语音(Audio8_TTS 本地服务;见设置页「语音合成」)——
  const speakMsg = async (m: Msg) => {
    if (ttsBusyId) return;
    if (speakingId === m.id) {
      audioRef.current?.pause();
      setSpeakingId(null);
      return;
    }
    setTtsBusyId(m.id);
    setError(null);
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: m.content, voice: ttsVoice || undefined }) });
      if (!res.ok) {
        const d = await res.json().catch(() => null) as { error?: string } | null;
        setError(d?.error ?? "语音合成失败");
        setTtsBusyId(null);
        return;
      }
      const blob = await res.blob();
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onended = () => setSpeakingId(null);
      setTtsBusyId(null);
      setSpeakingId(m.id);
      await audio.play();
    } catch {
      setError("语音播放失败");
      setTtsBusyId(null);
      setSpeakingId(null);
    }
  };

  // —— 消息复制 / 多选 / 分享导出 ——
  const copyText = async (text: string, id: string | null = null) => {
    try {
      await navigator.clipboard.writeText(text);
      if (id) { setCopiedId(id); setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500); }
      else setError(null);
    } catch {
      setError("复制失败:浏览器未授权剪贴板");
    }
  };
  const toggleSelected = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  // 导出文本:role 标签 + 模型/token 元信息,粘贴即读
  const transcriptOf = (msgs: Msg[]) => {
    const lines = msgs.map((m) => {
      const who = m.role === "user" ? "🧑 用户" : "🤖 助手";
      const meta = m.role === "assistant" && m.model ? `(model: ${m.model}${m.tokensOut ? ` · ↑${m.tokensIn ?? 0} ↓${m.tokensOut} tokens` : ""})` : "";
      return `**${who}${meta}**

${m.content}`;
    });
    return `# ${activeChat?.title ?? "对话分享"}\n\n> 分享自 EvoDesk 对话台 · ${new Date().toLocaleString("zh-CN")}\n\n---\n\n${lines.join("\n\n---\n\n")}\n`;
  };
  const selectedMsgs = messages.filter((m) => selected.has(m.id));
  const shareSelected = (download: boolean) => {
    const md = transcriptOf(selectedMsgs.length > 0 ? selectedMsgs : messages);
    if (download) {
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `对话分享-${(activeChat?.title ?? "chat").slice(0, 20)}-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      void copyText(md);
    }
  };
  // 会话累计消耗(服务端已落库的 assistant 消息汇总)
  const sumIn = messages.reduce((acc, m) => acc + (m.tokensIn ?? 0), 0);
  const sumOut = messages.reduce((acc, m) => acc + (m.tokensOut ?? 0), 0);
  const sumCost = messages.reduce((acc, m) => acc + (m.costUsd ?? 0), 0);

  // Esc:退出撑满 / 退出多选
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectMode) exitSelect();
      else if (maxi) setMaxi(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode, maxi]);

  // —— 需求教练:轮次提示与最终提示词操作 ——
  const rounds = messages.filter((m) => m.role === "assistant" && !m.id.startsWith("tmp-")).length;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const finalReady = effectiveMode === "coach" && !!lastAssistant && lastAssistant.content.includes("最终搭建提示词");

  const copyFinal = async () => {
    if (!lastAssistant) return;
    try {
      await navigator.clipboard.writeText(lastAssistant.content);
      setError(null);
    } catch {
      setError("复制失败,请手动选择文本");
    }
  };
  const saveFinalNote = async () => {
    if (!lastAssistant) return;
    try {
      const res = await fetch("/api/notes", { method: "POST", body: JSON.stringify({ title: `搭建提示词 ${new Date().toLocaleDateString("zh-CN")}`, body: lastAssistant.content }) });
      if (!res.ok) throw new Error("save failed");
      setError(null);
      router.push("/notes");
    } catch {
      setError("存为笔记失败,请重试");
    }
  };

  // toTask 在组件内定义:setError 可达,失败落到既有 error state,而非未处理的 promise 拒绝
  const toTask = (content: string) => {
    fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: content.slice(0, 40), description: content }) })
      .then(() => router.push("/inbox"))
      .catch(() => setError("转为任务失败,请重试"));
  };

  // —— 会话管理:新建 / 重命名 / 工作目录 / 删除 ——
  const createChat = async (chatMode: "chat" | "coach" = effectiveMode) => {
    try {
      const res = await fetch("/api/chats", { method: "POST", body: JSON.stringify({ title: chatMode === "coach" ? "需求教练" : "新对话", mode: chatMode }) });
      const data = (await res.json().catch(() => null)) as { chat?: { id: string } } | null;
      const newId = data?.chat?.id;
      if (res.ok && newId) {
        setMgrOpen(false);
        router.push(`${basePath}?c=${newId}`);
      } else setError("创建会话失败");
    } catch {
      setError("创建会话失败");
    }
  };
  const patchChat = async (id: string, body: Record<string, unknown>, okText: string | null = null) => {
    try {
      const res = await fetch(`/api/chats/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "保存失败");
        return null;
      }
      if (okText) setError(null);
      router.refresh();
      return (await res.json()) as { chat: { id: string; workdir: string | null }; workdirExists: boolean | null };
    } catch {
      setError("保存请求失败");
      return null;
    }
  };
  const deleteChat = async (id: string) => {
    if (!window.confirm("删除该会话及全部消息?不可恢复。")) return;
    try {
      const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("删除失败");
        return;
      }
      setMgrOpen(false);
      if (id === activeId) router.push(basePath); // 删的是当前会话:回列表首
      else router.refresh();
    } catch {
      setError("删除请求失败");
    }
  };

  // —— 渲染:ZCode 风格对话台 ——
  // 结构:顶栏(会话/模型) → 可选会话管理/教练横幅 → 全高消息流 → 底部停靠输入区。
  const sendDisabled = streaming || !input.trim() || !activeId || !hasAnyModel;
  const suggestionChips = ["介绍一下你能帮我做什么", "帮我规划今天的任务", "把这段话整理成笔记:…"];

  return (
    <div
      className={`flex flex-col ${maxi ? "fixed inset-0 z-50 p-3 sm:p-4" : ""}`}
      style={maxi ? { background: "var(--bg)" } : { height: "calc(100dvh - 170px)", minHeight: 500 }}
    >
      {/* 顶栏 */}
      <div className="flex gap-2 flex-wrap items-center pb-2.5 mb-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <select className="input px-2 py-1.5 text-sm max-w-52" value={activeId ?? ""} onChange={(e) => router.push(`${basePath}?c=${e.target.value}`)}>
          {chats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button onClick={() => void createChat("chat")} className="ghost-btn px-2 py-1.5 text-sm" title="开始新对话">＋ 新对话</button>
        <button onClick={() => void createChat("coach")} className="ghost-btn px-2 py-1.5 text-sm" title="教练式逐轮提问,产出可复制的搭建提示词">🏃 教练</button>
        <button onClick={() => setMgrOpen((v) => !v)} className="ghost-btn px-2 py-1.5 text-sm" title="重命名 / 工作目录 / 删除">
          会话管理{mgrOpen ? " ▴" : " ▾"}
        </button>
        <button
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          className={`ghost-btn px-2 py-1.5 text-sm ${selectMode ? "ring-1" : ""}`}
          style={selectMode ? { color: "var(--accent)" } : undefined}
          title="勾选多条消息,批量复制或分享"
        >☑ 多选</button>
        {activeChat?.workdir && (
          <span className="text-xs px-2 py-1 rounded truncate max-w-56" style={{ background: "var(--surface-2)", color: "var(--muted)" }} title={activeChat.workdir}>
            📂 {activeChat.workdir}
          </span>
        )}
        <select className="input px-2 py-1.5 text-sm ml-auto max-w-56" value={executorId} onChange={(e) => setExecutorId(e.target.value)} disabled={!hasAnyModel} title="本次对话使用的模型执行器">
          {!hasAnyModel && <option value="">未配置模型</option>}
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {modelGroups.filter((m) => m.group === g).map((m) => <option key={m.executorId} value={m.executorId}>{m.label}</option>)}
            </optgroup>
          ))}
        </select>
        <select
          className="input px-2 py-1.5 text-xs max-w-40"
          value={ttsVoice}
          onChange={(e) => { setTtsVoice(e.target.value); localStorage.setItem("tts-voice", e.target.value); }}
          title="转语音使用的音色(更多音色在设置 → 语音合成中克隆注册)"
        >
          <option value="">音色:默认</option>
          {ttsVoices.map((v) => <option key={v.name} value={v.name}>音色:{v.name}{v.lang ? `(${v.lang})` : ""}</option>)}
        </select>
        <select
          className="input px-2 py-1.5 text-xs max-w-28"
          value={ttsLang}
          onChange={(e) => { setTtsLang(e.target.value); localStorage.setItem("tts-lang", e.target.value); }}
          title="朗读语言偏好(模型按文本自动识别语种,音色决定口音)"
        >
          {["中文", "粤语", "英语", "日语", "韩语", "法语", "德语", "意大利语", "荷兰语", "波兰语", "西班牙语"].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={() => setMaxi((v) => !v)} className="ghost-btn px-2 py-1.5 text-sm" title={maxi ? "还原布局(Esc 退出)" : "撑满屏幕(Esc 退出)"}>{maxi ? "⤡ 还原" : "⤢ 撑满"}</button>
      </div>
      {mgrOpen && (
        <div className="surface p-3 mb-3 space-y-2 max-h-72 overflow-auto chat-scroll" style={{ flex: "none" }}>
          <div className="text-sm font-medium mb-1">会话管理(共 {chats.length} 个)</div>
          {chats.length === 0 && <div className="text-xs" style={{ color: "var(--muted)" }}>暂无会话,点「＋ 新对话」创建。</div>}
          {chats.map((c) => {
            const draft = renaming[c.id];
            const dirDraft = dirEditing[c.id];
            return (
              <div key={c.id} className="rounded p-2" style={{ background: c.id === activeId ? "var(--surface-2)" : "transparent", border: "1px solid var(--border)" }}>
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  {c.mode === "coach" && <span title="教练会话" className="text-xs">🏃</span>}
                  {draft !== undefined ? (
                    <>
                      <input className="input text-sm flex-1 min-w-40" value={draft} autoFocus
                        onChange={(e) => setRenaming({ ...renaming, [c.id]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && draft.trim()) {
                            void patchChat(c.id, { title: draft.trim() });
                            const n = { ...renaming };
                            delete n[c.id];
                            setRenaming(n);
                          }
                        }}
                      />
                      <button className="accent-btn text-xs px-2 py-1" disabled={!draft.trim()}
                        onClick={() => { void patchChat(c.id, { title: draft.trim() }); const n = { ...renaming }; delete n[c.id]; setRenaming(n); }}>保存</button>
                      <button className="ghost-btn text-xs px-2 py-1" onClick={() => { const n = { ...renaming }; delete n[c.id]; setRenaming(n); }}>取消</button>
                    </>
                  ) : (
                    <>
                      <button className="font-medium hover:opacity-80 text-left truncate max-w-48" title="切换到该会话"
                        onClick={() => { setMgrOpen(false); router.push(`${basePath}?c=${c.id}`); }}>
                        {c.title}{c.id === activeId ? " ·当前" : ""}
                      </button>
                      <span className="ml-auto flex gap-1.5">
                        <button className="ghost-btn text-xs px-2 py-1" onClick={() => setRenaming({ ...renaming, [c.id]: c.title })}>重命名</button>
                        <button className="ghost-btn text-xs px-2 py-1" onClick={() => {
                          const n = { ...dirEditing };
                          if (dirDraft !== undefined) delete n[c.id];
                          else n[c.id] = c.workdir ?? "";
                          setDirEditing(n);
                        }}>
                          {dirDraft !== undefined ? "收起目录" : "工作目录"}
                        </button>
                        <button className="ghost-btn text-xs px-2 py-1" style={{ color: "var(--danger)" }} onClick={() => void deleteChat(c.id)}>删除</button>
                      </span>
                    </>
                  )}
                </div>
                {dirDraft !== undefined && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <input className="input text-xs flex-1 min-w-56" placeholder="本地工作目录绝对路径,如 D:\\work\\my-project"
                      value={dirDraft} onChange={(e) => setDirEditing({ ...dirEditing, [c.id]: e.target.value })} />
                    <button className="accent-btn text-xs px-2 py-1" disabled={!dirDraft.trim() && c.workdir === null}
                      onClick={async () => {
                        const out = await patchChat(c.id, { workdir: dirDraft.trim() || null }, "saved");
                        if (out !== null) {
                          const n = { ...dirEditing };
                          delete n[c.id];
                          setDirEditing(n);
                          if (dirDraft.trim() && out.workdirExists === false) setError("已保存,但该目录当前不存在,请核对路径");
                        }
                      }}>
                      保存目录
                    </button>
                    {c.workdir && (
                      <button className="ghost-btn text-xs px-2 py-1"
                        onClick={async () => {
                          await patchChat(c.id, { workdir: null }, "saved");
                          const n = { ...dirEditing };
                          delete n[c.id];
                          setDirEditing(n);
                        }}>清除</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {effectiveMode === "coach" && (
        <div className="p-2.5 mb-3 flex items-center gap-2 text-xs flex-wrap rounded" style={{ flex: "none", background: "var(--surface-2)", borderLeft: "3px solid var(--accent-2)" }}>
          <span style={{ color: "var(--accent-2)" }}>🏃 需求教练</span>
          <span style={{ color: "var(--muted)" }}>教练逐轮提问(最多 6 轮),信息足够后输出「最终搭建提示词」。</span>
          <span className="ml-auto" style={{ color: "var(--muted)" }}>已进行 {rounds} 轮</span>
          {finalReady && (
            <>
              <button className="accent-btn text-xs px-2 py-1" onClick={() => void copyFinal()}>复制提示词</button>
              <button className="ghost-btn text-xs px-2 py-1" onClick={() => void saveFinalNote()}>存为笔记</button>
            </>
          )}
        </div>
      )}

      {/* 消息流 */}
      <div className="chat-scroll flex-1 overflow-auto px-1 space-y-4 min-h-0">
        {!hasAnyModel && (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            尚未配置可用模型。到「执行器」页导入供应商档案并启用,或在设置环境变量后启用种子执行器。
          </div>
        )}
        {hasAnyModel && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center select-none">
            <div className="chat-avatar" style={{ width: 44, height: 44, fontSize: 20, background: "linear-gradient(135deg, var(--accent), var(--accent-2))", color: "#fff" }}>AI</div>
            <div className="text-sm" style={{ color: "var(--muted)" }}>开始你的第一句话</div>
            <div className="flex gap-2 flex-wrap justify-center">
              {suggestionChips.map((chip) => (
                <button key={chip} className="ghost-btn text-xs px-3 py-1.5 rounded-full" onClick={() => setInput(chip)}>{chip}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, idx) => {
          const isLast = idx === messages.length - 1;
          if (m.role === "user") {
            return (
              <div key={m.id} className={`flex justify-end items-end gap-2 ${selectMode ? "cursor-pointer" : ""}`}
                onClick={selectMode ? () => toggleSelected(m.id) : undefined}>
                {selectMode && <SelectBox on={selected.has(m.id)} />}
                <div className="flex flex-col items-end gap-1 min-w-0">
                  <div className="chat-user-bubble inline-block text-sm whitespace-pre-wrap px-3.5 py-2.5 max-w-full text-left leading-relaxed">{m.content}</div>
                  <button onClick={(e) => { if (selectMode) { e.stopPropagation(); toggleSelected(m.id); } else void copyText(m.content, m.id); }}
                    className="text-xs" style={{ color: "var(--muted)" }}>
                    {copiedId === m.id ? "✓ 已复制" : "复制"}
                  </button>
                </div>
                <div className="chat-avatar" style={{ background: "var(--surface-2)", color: "var(--muted)", border: "1px solid var(--border)" }}>你</div>
              </div>
            );
          }
          const showCursor = streaming && isLast;
          const tok = (m.tokensIn ?? 0) > 0 || (m.tokensOut ?? 0) > 0;
          return (
            <div key={m.id} className={`flex items-start gap-2 ${selectMode ? "cursor-pointer" : ""}`}
              onClick={selectMode ? () => toggleSelected(m.id) : undefined}>
              {selectMode && <SelectBox on={selected.has(m.id)} />}
              <div className="chat-avatar" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))", color: "#fff" }}>AI</div>
              <div className="max-w-[85%] min-w-0">
                <div className="chat-ai-bubble inline-block text-sm whitespace-pre-wrap px-3.5 py-2.5 leading-relaxed">
                  {m.content}{showCursor && <span className="chat-cursor" />}
                </div>
                {(m.model || m.costUsd > 0 || tok) && (
                  <div className="text-xs mt-1 flex items-center gap-2 flex-wrap" style={{ color: "var(--muted)" }}>
                    <span className="font-mono">
                      {m.model}
                      {tok ? ` · ↑${m.tokensIn ?? 0} ↓${m.tokensOut ?? 0} tok` : ""}
                      {m.costUsd > 0 ? ` · $${m.costUsd.toFixed(6)}` : ""}
                    </span>
                    <button onClick={(e) => { if (selectMode) { e.stopPropagation(); toggleSelected(m.id); } else void copyText(m.content, m.id); }} className="underline" style={{ color: "var(--accent)" }}>
                      {copiedId === m.id ? "✓ 已复制" : "复制"}
                    </button>
                    {m.content && !selectMode && (
                      <button onClick={(e) => { e.stopPropagation(); void speakMsg(m); }} className="underline" style={{ color: "var(--accent)" }} title="把这条回复转成语音播放">
                        {ttsBusyId === m.id ? "⏳ 合成中…" : speakingId === m.id ? "⏹ 停止" : "🔊 转语音"}
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); toTask(m.content); }} className="underline" style={{ color: "var(--accent)" }}>转为任务</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {selectMode && (
        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs p-2 rounded" style={{ flex: "none", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <span style={{ color: "var(--muted)" }}>已选 {selected.size} 条</span>
          <button className="ghost-btn px-2 py-1" onClick={() => setSelected(selected.size === messages.length ? new Set() : new Set(messages.map((x) => x.id)))}>
            {selected.size === messages.length ? "清空" : "全选"}
          </button>
          <button className="ghost-btn px-2 py-1" disabled={selected.size === 0} onClick={() => void shareSelected(false)}
            style={selected.size === 0 ? { opacity: 0.5 } : undefined} title="把所选消息合并为一份可读文稿,复制到剪贴板">📋 复制合并</button>
          <button className="accent-btn px-2 py-1" disabled={selected.size === 0} onClick={() => shareSelected(true)}
            style={selected.size === 0 ? { opacity: 0.5 } : undefined} title="导出为 Markdown 文件下载(未选则导出整段对话)">📤 分享(.md){selected.size === 0 ? "(整段)" : ""}</button>
          <button className="ghost-btn px-2 py-1 ml-auto" onClick={exitSelect}>取消(Esc)</button>
        </div>
      )}
      {error && <div className="text-xs mt-2" style={{ color: "var(--danger)" }}>{error}</div>}

      {/* 底部停靠输入区 */}
      <div className="pt-2.5 mt-1" style={{ flex: "none", borderTop: "1px solid var(--border)" }}>
        <div className="rounded-2xl px-3 py-2 flex items-end gap-2" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <textarea
            className="flex-1 bg-transparent text-sm resize-none outline-none leading-relaxed py-1.5"
            style={{ color: "var(--text)", minHeight: 24, maxHeight: 160, border: "none" }}
            placeholder={hasAnyModel ? "输入消息,Enter 发送,Shift+Enter 换行…" : "请先配置模型(到「执行器」页启用)"}
            rows={1}
            value={input}
            disabled={!activeId || !hasAnyModel}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!sendDisabled) send();
              }
            }}
          />
          <button
            onClick={send}
            disabled={sendDisabled}
            className="accent-btn px-3.5 py-2 text-sm rounded-xl"
            style={{ flex: "none" }}
            title="发送 (Enter)"
          >{streaming ? "⏳" : "➤"}</button>
        </div>
        <div className="text-xs mt-1.5 flex justify-between gap-2 flex-wrap" style={{ color: "var(--muted)" }}>
          <span>
            Enter 发送 · Shift+Enter 换行
            {(sumIn > 0 || sumOut > 0) && (
              <span className="font-mono" title="本会话累计 token 消耗与费用"> · 本会话 ↑{sumIn} ↓{sumOut} tok{sumCost > 0 ? ` · $${sumCost.toFixed(4)}` : ""}</span>
            )}
          </span>
          {activeChat && <span className="truncate max-w-64" title={activeChat.title}>{activeChat.title}</span>}
        </div>
      </div>
    </div>
  );
}


function SelectBox({ on }: { on: boolean }) {
  return (
    <span
      className="self-center shrink-0 inline-flex items-center justify-center rounded"
      style={{
        width: 18, height: 18, border: "1px solid var(--border)",
        background: on ? "var(--accent)" : "var(--surface-2)",
        color: "#fff", fontSize: 12, lineHeight: 1,
      }}
    >{on ? "✓" : ""}</span>
  );
}
