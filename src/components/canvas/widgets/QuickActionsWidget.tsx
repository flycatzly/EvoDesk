import { QuickActionsCard } from "@/components/QuickActionsCard";
import type { quickActions } from "@/lib/db/schema";

type ActionRow = typeof quickActions.$inferSelect;

// 快捷指令组件:复用仪表盘快捷卡片(确认门/结果面板逻辑一致)
export function QuickActionsWidget({ actions }: { actions: ActionRow[] }) {
  if (actions.length === 0) {
    return <div className="text-sm py-2" style={{ color: "var(--muted)" }}>暂无快捷指令,可在设置中添加。</div>;
  }
  return <QuickActionsCard actions={actions} />;
}
