import { describe, it, expect } from "vitest";
import { parseFrontmatter, extractWikiLinks, buildGraph, buildTagIndex } from "./wiki";

describe("parseFrontmatter", () => {
  it("解析 tags 数组/逗号/多行列表与平铺属性", () => {
    const fm = parseFrontmatter(`---
title: 测试
tags: [AI, 部署]
source: wechat
---
正文`);
    expect([...fm.tags].sort()).toEqual(["AI", "部署"]);
    expect(fm.props.title).toBe("测试");
    expect(fm.props.source).toBe("wechat");
  });
  it("多行 - 列表 tags 与无 frontmatter 容错", () => {
    const fm = parseFrontmatter("---\ntags:\n  - 读书\n  - 笔记\n---\n正文");
    expect(fm.tags).toHaveLength(2);
    expect(fm.tags).toContain("读书");
    expect(fm.tags).toContain("笔记");
    expect(parseFrontmatter("无 frontmatter")).toEqual({ tags: [], props: {} });
  });
});

describe("extractWikiLinks", () => {
  it("提取 [[链接]]/[[链接|别名]]/[[链接#锚点]],按序去重", () => {
    const links = extractWikiLinks("见 [[主笔记]] 与 [[主笔记|别名]]、[[另笔记#小节]]。");
    expect(links).toEqual(["主笔记", "另笔记"]);
  });
  it("无链接返回空", () => {
    expect(extractWikiLinks("普通 [文本] 不是链接")).toEqual([]);
  });
});

describe("buildGraph", () => {
  it("双链生成边与度数;悬空链接创建占位节点", () => {
    const g = buildGraph([
      { relPath: "a.md", name: "a.md", content: "[[b]] 和 [[c]]" },
      { relPath: "b.md", name: "b.md", content: "回链 [[a]]" },
      { relPath: "d.md", name: "d.md", content: "无链接孤儿" },
    ]);
    expect(g.edges).toHaveLength(3); // a→b, a→c(占位), b→a
    const c = g.nodes.find((n) => n.name === "c")!;
    expect(c.id).toBe("__virtual__:c"); // 悬空占位
    expect(g.nodes.find((n) => n.name === "a")!.degree).toBe(3); // 无向度数:出 2 + 入 1
    expect(g.orphanCount).toBe(1); // d
  });
});

describe("buildTagIndex", () => {
  it("tag → 文件列表", () => {
    const idx = buildTagIndex([
      { relPath: "1.md", content: "---\ntags: [AI]\n---" },
      { relPath: "2.md", content: "---\ntags: [AI, 部署]\n---" },
    ]);
    expect(idx.get("AI")).toEqual(["1.md", "2.md"]);
    expect(idx.get("部署")).toEqual(["2.md"]);
  });
});
