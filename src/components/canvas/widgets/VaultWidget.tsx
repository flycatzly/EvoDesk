import Link from "next/link";
import { WidgetEmpty } from "./WidgetEmpty";
import type { WidgetData } from "@/lib/domain/canvas-data";

// 知识库收纳组件:vault 概览(根目录名 + 笔记/目录计数)
export function VaultWidget({ data }: { data: WidgetData["vault"] }) {
  if (!data.configured) {
    return <WidgetEmpty text="知识库未配置,可在设置页填写 Obsidian vault 路径。" href="/settings" linkLabel="去设置 →" />;
  }
  return (
    <div className="text-sm">
      <div className="font-medium mb-1">📚 {data.rootName}</div>
      <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
        {data.noteCount} 篇笔记 · {data.dirCount} 个目录
      </div>
      <Link href="/vault" className="text-xs hover:opacity-80" style={{ color: "var(--accent)" }}>
        打开知识库 →
      </Link>
    </div>
  );
}
