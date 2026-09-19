"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** 网页 AI 剪藏:粘贴 URL → 抓正文 → AI 摘要+标签 → 自动存为笔记。 */
export function ClipBar() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const clip = useCallback(async () => {
    const u = url.trim();
    if (!u || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/clip", { method: "POST", body: JSON.stringify({ url: u }) });
      const data = (await res.json()) as { title?: string; summary?: string; error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "剪藏失败" });
        return;
      }
      setMsg({ ok: true, text: `已收藏《${data.title}》并生成摘要` });
      setUrl("");
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "请求失败,请重试" });
    } finally {
      setBusy(false);
    }
  }, [url, busy, router]);

  // 粘贴事件:剪贴板里有 URL 时一键提示剪藏
  const [clipHint, setClipHint] = useState(false);
  useEffect(() => {
    const onPaste = () => setClipHint(true);
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="surface p-3 mb-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium">✂️ 网页剪藏</span>
        <input
          className="input text-sm flex-1 min-w-56"
          placeholder={clipHint ? "检测到剪贴板内容,粘贴 URL 回车即可 AI 摘要收藏…" : "粘贴文章 URL,AI 自动摘要+标签存入笔记"}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void clip(); }}
          disabled={busy}
        />
        <button className="accent-btn text-xs px-3 py-1.5" onClick={() => void clip()} disabled={busy || !url.trim()}>
          {busy ? "抓取+摘要中…(约 20 秒)" : "AI 剪藏"}
        </button>
      </div>
      {msg && <div className="text-xs mt-1.5" style={{ color: msg.ok ? "var(--ok)" : "var(--danger)" }}>{msg.text}</div>}
    </div>
  );
}
