import { WidgetEmpty } from "./WidgetEmpty";
import type { WidgetData } from "@/lib/domain/canvas-data";

// 常用链接组件:按分类分组,新窗口一键打开
export function LinksWidget({ data }: { data: WidgetData["links"] }) {
  if (data.groups.length === 0) {
    return <WidgetEmpty text="还没有收藏链接。" href="/links" linkLabel="去添加 →" />;
  }
  return (
    <div className="space-y-2">
      {data.groups.map((g) => (
        <div key={g.category}>
          <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>{g.category}</div>
          <div className="flex flex-wrap gap-1.5">
            {g.links.map((l) => (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-2 py-1 rounded hover:opacity-80"
                style={{ background: "var(--surface-2)" }}
                title={l.url}
              >
                {l.title} ↗
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
