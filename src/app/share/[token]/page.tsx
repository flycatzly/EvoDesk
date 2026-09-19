import { getDb } from "@/lib/db/client";
import { canvases } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { parseLayout, type CanvasLayout, type WidgetType } from "@/lib/domain/canvas";
import { collectWidgetData } from "@/lib/domain/canvas-data";
import { readSettingsKv } from "@/lib/db/read-settings";
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
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// 分享只读页:与首页同一 CanvasBoard(readOnly 隐藏全部编辑控件),独立布局(无侧栏)
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const row = db.select().from(canvases)
    .where(and(eq(canvases.shareToken, token), eq(canvases.isTemplate, false)))
    .all()[0];
  if (!row) notFound();

  const kv = readSettingsKv(db);
  const timezone = typeof kv.timezone === "string" ? kv.timezone : "";
  const layout: CanvasLayout = parseLayout(row.layout);
  const types = [...new Set(layout.flatMap((g) => g.widgets.map((w) => w.type)))] as WidgetType[];
  const data = collectWidgetData(db, types, timezone);

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
    <div className="p-4 md:p-8">
      <CanvasBoard
        canvas={{ id: row.id, name: row.name, columns: row.columns, locked: true }}
        layout={layout}
        widgetNodes={widgetNodes}
        canvases={[]}
        templates={[]}
        readOnly
      />
    </div>
  );
}
