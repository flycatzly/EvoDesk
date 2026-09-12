import { describe, expect, it } from "vitest";
import { WIDGET_TYPES, layoutSchema, parseLayout, newWidgetId, deepCopyLayout } from "./canvas";

describe("layoutSchema", () => {
  it("接受合法布局", () => {
    const layout = [{ groupTitle: "今日焦点", widgets: [{ id: "w1", type: "todo", config: { scope: "today" } }] }];
    expect(layoutSchema.safeParse(layout).success).toBe(true);
  });
  it("拒绝未知 widget type 与空分组标题", () => {
    expect(layoutSchema.safeParse([{ groupTitle: "g", widgets: [{ id: "w1", type: "nope", config: {} }] }]).success).toBe(false);
    expect(layoutSchema.safeParse([{ groupTitle: "", widgets: [] }]).success).toBe(false);
  });
  it("config 缺省补 {}", () => {
    const parsed = layoutSchema.parse([{ groupTitle: "g", widgets: [{ id: "w1", type: "goals" }] }]);
    expect(parsed[0].widgets[0].config).toEqual({});
  });
});

describe("parseLayout", () => {
  it("坏 JSON / 非法结构返回 []", () => {
    expect(parseLayout("not json")).toEqual([]);
    expect(parseLayout("42")).toEqual([]);
  });
  it("合法 JSON 返回分组数组", () => {
    expect(parseLayout('[{"groupTitle":"g","widgets":[]}]')).toHaveLength(1);
  });
});

it("WIDGET_TYPES 含 9 类;newWidgetId 唯一;deepCopyLayout 重写 id", () => {
  expect(WIDGET_TYPES).toHaveLength(9);
  expect(newWidgetId()).not.toBe(newWidgetId());
  const copy = deepCopyLayout([{ groupTitle: "g", widgets: [{ id: "w1", type: "todo", config: {} }] }]);
  expect(copy[0].widgets[0].id).not.toBe("w1");
  expect(copy[0].widgets[0].type).toBe("todo");
});
