import { describe, it, expect } from "vitest";
import { visibleHrefs, modulePermsFromKv, ALWAYS_VISIBLE } from "./module-visibility";

const ALL = ["/", "/inbox", "/tasks", "/chat", "/skills", "/vault", "/jobs", "/settings"];

describe("module-visibility", () => {
  it("无配置 → 全部可见", () => {
    const v = visibleHrefs(ALL, { globalHidden: [], canvasVisible: {} }, null);
    expect([...v].sort()).toEqual([...ALL].sort());
  });
  it("全局隐藏:被隐藏的不可见,ALWAYS_VISIBLE 恒可见", () => {
    const v = visibleHrefs(ALL, { globalHidden: ["/chat", "/jobs", "/"], canvasVisible: {} }, null);
    expect(v.has("/chat")).toBe(false);
    expect(v.has("/jobs")).toBe(false);
    expect(v.has("/")).toBe(true); // 工作台恒可见
  });
  it("工作台覆盖:白名单生效且并上恒可见集;未配置的工作台跟随全局", () => {
    const perms = { globalHidden: ["/jobs"], canvasVisible: { stu: ["/", "/inbox", "/vault"] } };
    const vStu = visibleHrefs(ALL, perms, "stu");
    expect([...vStu].sort()).toEqual(["/", "/inbox", "/vault"]);
    const vOther = visibleHrefs(ALL, perms, "other-canvas");
    expect(vOther.has("/tasks")).toBe(true);
    expect(vOther.has("/jobs")).toBe(false); // 跟随全局隐藏
  });
  it("空白名单 = 该工作台只看工作台本身(显式空数组也是覆盖)", () => {
    const v = visibleHrefs(ALL, { globalHidden: [], canvasVisible: { minimal: [] } }, "minimal");
    expect([...v]).toEqual(["/"]);
  });
  it("modulePermsFromKv:坏数据安全回退", () => {
    expect(modulePermsFromKv(null)).toEqual({ globalHidden: [], canvasVisible: {} });
    expect(modulePermsFromKv("x")).toEqual({ globalHidden: [], canvasVisible: {} });
    const parsed = modulePermsFromKv({ globalHidden: ["/chat", 42], canvasVisible: { c: ["/tasks"], bad: "nope", empty: [] } });
    expect(parsed.globalHidden).toEqual(["/chat"]);
    expect(parsed.canvasVisible).toEqual({ c: ["/tasks"], empty: [] });
    expect(ALWAYS_VISIBLE).toEqual(["/"]);
  });
});
