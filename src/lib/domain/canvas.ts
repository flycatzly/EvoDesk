// 画布布局领域层:layout JSON 是画布结构的单一事实来源,应用层用 zod 校验。
import { z } from "zod";
import { randomBytes } from "node:crypto";

export const WIDGET_TYPES = ["counters", "todo", "calendar", "notes", "links", "goals", "vault", "radar", "quickactions", "focus"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const widgetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(WIDGET_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
});
export const groupSchema = z.object({
  groupTitle: z.string().trim().min(1).max(50),
  widgets: z.array(widgetSchema).max(12),
});
export const layoutSchema = z.array(groupSchema).max(20);
export type CanvasWidget = z.infer<typeof widgetSchema>;
export type CanvasGroup = z.infer<typeof groupSchema>;
export type CanvasLayout = CanvasGroup[];

export function parseLayout(raw: string): CanvasLayout {
  try {
    const parsed = layoutSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function newWidgetId(): string {
  return `w_${randomBytes(4).toString("hex")}`;
}

// 模板套用/组件复制时深拷贝并重写 widget id,保证画布内 id 唯一
export function deepCopyLayout(layout: CanvasLayout): CanvasLayout {
  const clone: CanvasLayout = JSON.parse(JSON.stringify(layout));
  return clone.map((g) => ({ ...g, widgets: g.widgets.map((w) => ({ ...w, id: newWidgetId() })) }));
}
