import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandHome, parseSkillFrontmatter, scanSkillsDirs } from "./skills";

describe("skills", () => {
  it("expandHome 展开 ~ 与 ~/", () => {
    expect(expandHome("~")).not.toContain("~");
    expect(expandHome("~/foo")).not.toContain("~");
    expect(expandHome("C:\\x")).toBe("C:\\x");
  });
  it("parseSkillFrontmatter 提取 name/description;无 frontmatter 回退目录名", () => {
    const md = `---
name: my-skill
description: 做一件很棒的事
---

正文`;
    expect(parseSkillFrontmatter(md, "fallback")).toEqual({ name: "my-skill", description: "做一件很棒的事" });
    expect(parseSkillFrontmatter("# 无元数据", "fallback")).toEqual({ name: "fallback", description: "" });
  });
  it("scanSkillsDirs 递归找 SKILL.md,按一级子目录分类;坏目录记错误不抛", () => {
    const root = mkdtempSync(join(tmpdir(), "evodesk-skills-"));
    // 分类目录:web/<skill>/SKILL.md
    mkdirSync(join(root, "web", "page-reader"), { recursive: true });
    writeFileSync(join(root, "web", "page-reader", "SKILL.md"), "---\nname: page-reader\ndescription: 读取网页\n---\n正文");
    // 扁平:<skill>/SKILL.md → 未分类
    mkdirSync(join(root, "flat-skill"), { recursive: true });
    writeFileSync(join(root, "flat-skill", "SKILL.md"), "# 无元数据");
    // SKILL.md 缺 description 也收录
    mkdirSync(join(root, "web", "bare"), { recursive: true });
    writeFileSync(join(root, "web", "bare", "SKILL.md"), "---\nname: bare\n---\n");

    const { skills, errors } = scanSkillsDirs([root, join(root, "not-exist")]);
    expect(skills).toHaveLength(3);
    const reader = skills.find((s) => s.name === "page-reader")!;
    expect(reader.category).toBe("web");
    expect(reader.description).toBe("读取网页");
    expect(skills.find((s) => s.name === "flat-skill")!.category).toBe("未分类");
    expect(skills.find((s) => s.name === "bare")!.description).toBe("");
    expect(errors).toHaveLength(1);
    expect(errors[0].dir).toContain("not-exist");
    expect(skills.every((s) => s.path.includes("SKILL.md"))).toBe(true);
  });
});
