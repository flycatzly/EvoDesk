import { describe, it, expect } from "vitest";
import { autoCategoryFor, proposeRenames, findDuplicateGroups, normalizeUrl, isJunkCategory } from "./link-organize";

describe("autoCategoryFor", () => {
  it("域名命中归入对应分类(含子域)", () => {
    expect(autoCategoryFor("GitHub", "https://github.com/a/b")).toBe("开发");
    expect(autoCategoryFor("MDN", "https://developer.mozilla.org/zh-CN/")).toBe("开发");
    expect(autoCategoryFor("OpenAI", "https://api.openai.com/v1")).toBe("AI");
    expect(autoCategoryFor("Kimi", "https://kimi.moonshot.cn/")).toBe("AI");
    expect(autoCategoryFor("B站", "https://www.bilibili.com/video/x")).toBe("影音娱乐");
    expect(autoCategoryFor(" upp", "https://dash.cloudflare.com/xxx")).toBe("云与运维");
  });
  it("关键词命中(标题/URL 包含)", () => {
    expect(autoCategoryFor("AI 工具集导航", "https://example.com/ai")).toBe("AI");
  });
  it("未命中/非法 URL 返回 null", () => {
    expect(autoCategoryFor("某政策网站", "https://www.gov.cn/xxgk")).toBeNull();
    expect(autoCategoryFor("x", "not-a-url")).toBeNull();
  });
  it("杂物分类识别", () => {
    expect(isJunkCategory("书签栏")).toBe(true);
    expect(isJunkCategory("开发")).toBe(false);
  });
});

describe("proposeRenames", () => {
  const mk = (cats: string[]) => cats.map((c) => ({ category: c }));
  it("同名归并:大小写/空白差异归到多数派写法", () => {
    const out = proposeRenames(mk(["AI", "ai", "AI", "Web 前端", "web前端"]));
    const ai = out.find((o) => o.from === "ai")!;
    expect(ai.to).toBe("AI");
    const web = out.find((o) => o.from.toLowerCase().replace(/\s+/g, "") === "web前端" && o.from !== "Web 前端");
    expect(web?.to).toBe("Web 前端");
  });
  it("小分类收编进「其他」;杂物分类与「其他」本身不参与", () => {
    const out = proposeRenames(mk(["A", "B", "B", "收藏夹", "其他", "C", "C", "C"]));
    const tinyA = out.find((o) => o.from === "A")!;
    expect(tinyA.to).toBe("其他");
    expect(out.find((o) => o.from === "收藏夹")).toBeUndefined();
    expect(out.find((o) => o.from === "其他")).toBeUndefined();
    expect(out.find((o) => o.from === "C")).toBeUndefined();
  });
  it("tinyMax 可调", () => {
    const out = proposeRenames(mk(["A", "B", "B"]), { tinyMax: 2 });
    expect(out.find((o) => o.from === "A")).toBeDefined();
  });
});

describe("normalizeUrl / findDuplicateGroups", () => {
  it("归一化:协议/www/末尾斜杠/跟踪参数差异视为相同", () => {
    const a = "https://www.example.com/a/b/?utm_source=x&spm=y&id=1";
    const b = "http://example.com/a/b?id=1";
    expect(normalizeUrl(a)).toBe(normalizeUrl(b));
  });
  it("路径或查询不同则不同", () => {
    expect(normalizeUrl("https://example.com/a")).not.toBe(normalizeUrl("https://example.com/b"));
    expect(normalizeUrl("https://example.com/a?id=1")).not.toBe(normalizeUrl("https://example.com/a?id=2"));
  });
  it("findDuplicateGroups 只返回重复组,保持出现顺序(首条=保留)", () => {
    const rows = [
      { id: "1", url: "https://github.com/x" },
      { id: "2", url: "https://www.github.com/x/" },
      { id: "3", url: "https://unique.com" },
      { id: "4", url: "http://github.com/x" },
    ];
    const groups = findDuplicateGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual(["1", "2", "4"]);
  });
});
