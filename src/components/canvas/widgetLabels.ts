// 组件类型中文名(增组件菜单与空态共用;与 domain/canvas WIDGET_TYPES 一一对应)
import type { WidgetType } from "@/lib/domain/canvas";

export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  counters: "指标卡",
  todo: "待办任务",
  calendar: "日历时间",
  notes: "笔记灵感",
  links: "常用链接",
  goals: "目标进度",
  vault: "知识库",
  radar: "风险雷达",
  quickactions: "快捷指令",
  focus: "番茄钟专注",
};
