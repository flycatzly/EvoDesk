"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Msg { id: string; role: string; content: string; model: string | null; costUsd: number }

export function ChatView({ chats, activeId, initialMessages, modelGroups, hasAnyModel }: {
  chats: { id: string; title: string }[];
  activeId: string | null;
  initialMessages: Msg[];
  modelGroups: { executorId: string; label: string; group: string }[];
  hasAnyModel: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [executorId, setExecutorId] = useState<string>(modelGroups[0]?.executorId ?? "");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const groups = [...new Set(modelGroups.map((g) => g.group))];
  // 自动滚动:新消息加入时贴底(流式 delta 期间由 done 分支兜底滚动)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = async () => {
    if (!input.trim() || streaming || !activeId) return;
    setError(null);
    const userMsg: Msg = { id: `tmp-${Date.now()}`, role: "user", content: input, model: null, costUsd: 0 };
    const assistantId = `tmp-a-${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: assistantId, role: "assistant", content: "", model: null, costUsd: 0 }]);
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
          const evt = JSON.parse(block.slice(5).trim()) as { delta?: string; done?: boolean; error?: string; message?: { id: string; role: string; content: string; model: string | null; costUsd: number } };
          if (evt.delta) setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, content: x.content + evt.delta } : x)));
          if (evt.done) {
            if (evt.error) { setError(evt.error); setMessages((m) => m.filter((x) => x.id !== assistantId)); }
            else if (evt.message) setMessages((m) => m.map((x) => (x.id === assistantId ? { id: evt.message!.id, role: "assistant", content: evt.message!.content, model: evt.message!.model, costUsd: evt.message!.costUsd } : x)));
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

  const toTask = (content: string) => {
    fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: content.slice(0, 40), description: content }) })
      .then(() => router.push("/inbox"));
  };

  return (
    <div>
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <select className="input px-2 py-1.5 text-sm" value={activeId ?? ""} onChange={(e) => router.push(`/chat?c=${e.target.value}`)}>
          {chats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button onClick={() => router.push("/chat")} className="ghost-btn px-2 py-1.5 text-sm">+ 新对话</button>
        <select className="input px-2 py-1.5 text-sm ml-auto" value={executorId} onChange={(e) => setExecutorId(e.target.value)} disabled={!hasAnyModel}>
          {!hasAnyModel && <option value="">未配置模型</option>}
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {modelGroups.filter((m) => m.group === g).map((m) => <option key={m.executorId} value={m.executorId}>{m.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="surface p-4 mb-3 space-y-3 min-h-60 max-h-[60vh] overflow-auto">
        {!hasAnyModel && (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            尚未配置可用模型。到「执行器」页导入供应商档案并启用,或在设置环境变量后启用种子执行器。
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block text-sm whitespace-pre-wrap px-3 py-2 rounded-xl max-w-[85%] text-left ${m.role === "user" ? "accent-btn" : "surface"}`}
              style={m.role === "user" ? {} : { background: "var(--surface-2)" }}>
              {m.content}
            </div>
            {m.role === "assistant" && (m.model || m.costUsd > 0) && (
              <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>{m.model} · ${m.costUsd.toFixed(6)}
                <button onClick={() => toTask(m.content)} className="ml-2 underline" style={{ color: "var(--accent)" }}>转为任务</button>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <div className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</div>}
      <div className="flex gap-2">
        <input
          className="input flex-1 px-3 py-2 text-sm"
          placeholder={hasAnyModel ? "输入消息,Enter 发送…" : "请先配置模型"}
          value={input}
          disabled={!activeId || !hasAnyModel}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }}
        />
        <button onClick={send} disabled={streaming || !input.trim()} className="accent-btn px-4 py-2 text-sm">{streaming ? "…" : "发送"}</button>
      </div>
    </div>
  );
}
