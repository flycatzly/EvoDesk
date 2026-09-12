import { TodoChecklist } from "./TodoChecklist";
import type { WidgetData } from "@/lib/domain/canvas-data";

// 待办组件:今日+逾期(逾期置顶),勾选完成
export function TodoWidget({ data }: { data: WidgetData["todo"] }) {
  return <TodoChecklist tasks={data.tasks} />;
}
