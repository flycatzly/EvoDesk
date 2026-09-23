import { getDb } from "@/lib/db/client";
import { canvases } from "@/lib/db/schema";
import { readSettingsKv } from "@/lib/db/read-settings";
import { tickRecurring } from "@/lib/domain/recurring";
import { parseLayout, type CanvasLayout, type WidgetType } from "@/lib/domain/canvas";
import { collectWidgetData } from "@/lib/domain/canvas-data";
import { CanvasBoard } from "@/components/canvas/CanvasBoard";
import { CountersWidget } from "@/components/canvas/widgets/CountersWidget";
import { TodoWidget } from "@/components/canvas/widgets/TodoWidget";
import { CalendarWidget } from "@/components/canvas/widgets/CalendarWidget";
import { NotesWidget } from "@/components/canvas/widgets/NotesWidget";
import { LinksWidget } from "@/components/canvas/widgets/LinksWidget";
import { GoalsWidget } from "@/components/canvas/widgets/GoalsWidget";
import { VaultWidget } from "@/components/canvas/widgets/VaultWidget";
import { RadarWidget } from "@/components/canvas/widgets/RadarWidget";
import { QuickActionsWidget } from "@/components/canvas/widgets/QuickActionsWidget";
import { FocusWidget } from "@/components/canvas/widgets/FocusWidget";
import { BriefingCard } from "@/components/BriefingCard";

export const dynamic = "force-dynamic";

// 首页 = 可拖拽组件画布(?c= 切换画布;widget 内容在服务端渲染后按组件 id 注入客户端画布)
export default async function WorkbenchPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const db = getDb();
  await tickRecurring(db);
  const kv = await readSettingsKv(db);
  const timezone = typeof kv.timezone === "string" ? kv.timezone : "";

  const rows = db.select().from(canvases).all() as (typeof canvases.$inferSelect)[];
  const normal = rows.filter((r) => !r.isTemplate).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const templates = rows.filter((r) => r.isTemplate).map((r) => ({ id: r.id, name: r.name }));
  const current = normal.find((r) => r.id === c) ?? normal[0];

  if (!current) {
    return (
      <div className="max-w-3xl surface p-6 text-sm" style={{ color: "var(--muted)" }}>
        尚无工作台画布,请重启应用让种子数据补齐,或在设置中检查数据库。
      </div>
    );
  }

  const layout: CanvasLayout = parseLayout(current.layout);
  const types = [...new Set(layout.flatMap((g) => g.widgets.map((w) => w.type)))] as WidgetType[];
  const data = await collectWidgetData(db, types, timezone);
  const widgetNodes: Record<string, React.ReactNode> = {};
  for (const g of layout) {
    for (const w of g.widgets) {
      switch (w.type) {
        case "counters": if (data.counters) widgetNodes[w.id] = <CountersWidget data={data.counters} />; break;
        case "todo": if (data.todo) widgetNodes[w.id] = <TodoWidget data={data.todo} />; break;
        case "calendar": if (data.calendar) widgetNodes[w.id] = <CalendarWidget data={data.calendar} />; break;
        case "notes": if (data.notes) widgetNodes[w.id] = <NotesWidget data={data.notes} />; break;
        case "links": if (data.links) widgetNodes[w.id] = <LinksWidget data={data.links} />; break;
        case "goals": if (data.goals) widgetNodes[w.id] = <GoalsWidget data={data.goals} />; break;
        case "vault": if (data.vault) widgetNodes[w.id] = <VaultWidget data={data.vault} />; break;
        case "radar": if (data.radar) widgetNodes[w.id] = <RadarWidget items={data.radar.items} />; break;
        case "quickactions": if (data.quickactions) widgetNodes[w.id] = <QuickActionsWidget actions={data.quickactions.actions} />; break;
        case "focus": widgetNodes[w.id] = <FocusWidget />; break;
      }
    }
  }

  return (
    <>
      <BriefingCard />
      <CanvasBoard
        canvas={{ id: current.id, name: current.name, columns: current.columns, locked: current.locked }}
        layout={layout}
        widgetNodes={widgetNodes}
        canvases={normal.map((r) => ({ id: r.id, name: r.name }))}
        templates={templates}
      />
    </>
  );
}
