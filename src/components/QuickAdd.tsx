"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function QuickAdd() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    setTitle("");
    setBusy(false);
    router.push("/inbox");
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      <input
        className="input px-3 py-1.5 text-sm w-48 md:w-64"
        placeholder="快速新增任务…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <button onClick={add} className="accent-btn px-3 py-1.5 text-sm">{busy ? "…" : "新增"}</button>
    </div>
  );
}
