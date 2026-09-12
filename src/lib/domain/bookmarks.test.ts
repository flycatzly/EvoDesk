import { describe, it, expect } from "vitest";
import { parseBookmarksJson, toNetscapeHtml, pickCategory, type BookmarkItem } from "./bookmarks";

const SAMPLE = JSON.stringify({
  roots: {
    bookmark_bar: {
      type: "folder", name: "书签栏",
      children: [
        { type: "url", name: "GitHub", url: "https://github.com" },
        { type: "folder", name: "开发工具", children: [
          { type: "url", name: "MDN", url: "https://developer.mozilla.org" },
          { type: "url", name: "坏链接", url: "javascript:void(0)" },
        ]},
      ],
    },
    other: { type: "folder", name: "其他书签", children: [{ type: "url", name: "掘金", url: "https://juejin.cn" }] },
    synced: { type: "folder", name: "移动设备书签", children: [] },
  },
});

describe("parseBookmarksJson", () => {
  it("递归提取 url 节点,folder 为完整目录路径;非 http(s) 过滤", () => {
    const items = parseBookmarksJson(SAMPLE);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.folder)).toEqual(["书签栏", "书签栏/开发工具", "其他书签"]);
    expect(items.find((i) => i.title === "MDN")!.url).toBe("https://developer.mozilla.org");
    expect(items.every((i) => /^https?:\/\//.test(i.url))).toBe(true);
  });
  it("坏 JSON / 缺 roots 抛错", () => {
    expect(() => parseBookmarksJson("nope")).toThrow();
    expect(() => parseBookmarksJson("{}")).toThrow(/roots/);
  });
});

describe("pickCategory", () => {
  it("取直接父目录名作为分类;根下直接放的书签归'收藏夹'", () => {
    expect(pickCategory("书签栏/开发工具")).toBe("开发工具");
    expect(pickCategory("书签栏")).toBe("收藏夹");
    expect(pickCategory("")).toBe("收藏夹");
  });
});

describe("toNetscapeHtml", () => {
  it("导出 Netscape 书签格式,按文件夹分组,HTML 转义", () => {
    const items: BookmarkItem[] = [
      { title: '含"<引号>', url: "https://a.com", folder: "书签栏/开发工具" },
      { title: "裸链接", url: "https://b.com", folder: "" },
    ];
    const html = toNetscapeHtml(items);
    expect(html).toContain("NETSCAPE-Bookmark-file-1");
    expect(html).toContain('<DT><H3>开发工具</H3>');
    expect(html).toContain('<DT><A HREF="https://a.com">含&quot;&lt;引号&gt;</A>');
    expect(html).toContain('<DT><A HREF="https://b.com">裸链接</A>');
  });
});
