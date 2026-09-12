import Link from "next/link";
import { NoteQuickAdd } from "./NoteQuickAdd";
import { WidgetEmpty } from "./WidgetEmpty";
import type { WidgetData } from "@/lib/domain/canvas-data";

// 笔记灵感组件:快速录入 + 最近 5 条
export function NotesWidget({ data }: { data: WidgetData["notes"] }) {
  return (
    <div>
      <NoteQuickAdd />
      {data.notes.length === 0 ? (
        <WidgetEmpty text="还没有灵感速记,上面输入第一条。" href="/notes" linkLabel="去内容灵感 →" />
      ) : (
        <ul className="space-y-1">
          {data.notes.map((n) => (
            <li key={n.id}>
              <Link href="/notes" className="text-sm hover:opacity-80 block truncate" title={n.title}>
                · {n.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
