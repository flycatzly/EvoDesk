import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  normalizeDocName, findSimilarGroups, sanitizePlan, conflictFreeName,
  applyCategories, importToVault, writeDocWithBackup,
} from "./library-ai";

describe("normalizeDocName", () => {
  it("去双扩展/空白/标点并小写", () => {
    expect(normalizeDocName("CLAUDE.md.md")).toBe("claude");
    expect(normalizeDocName("Read Me!.MD")).toBe("readme");
    expect(normalizeDocName("API-接口 文档")).toBe("api接口文档");
  });
});

describe("findSimilarGroups", () => {
  it("内容完全一致 → 同内容组", () => {
    const groups = findSimilarGroups([
      { relPath: "a/Readme.md", name: "Readme.md", content: "# 相同内容\n正文一致" },
      { relPath: "b/Readme.md", name: "Readme.md", content: "# 相同内容\n正文一致" },
      { relPath: "c/其他.md", name: "其他.md", content: "完全不同" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("同内容");
    expect(groups[0].files).toEqual(["a/Readme.md", "b/Readme.md"]);
  });
  it("同标题(归一化)→ 高相似组", () => {
    const groups = findSimilarGroups([
      { relPath: "1/AI工具.md", name: "AI工具.md", content: "工具列表一" },
      { relPath: "2/AI 工具.md", name: "AI 工具.md", content: "工具列表二,内容不同" },
      { relPath: "3/独立.md", name: "独立.md", content: "独立内容" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("高相似");
    expect(groups[0].files).toEqual(["1/AI工具.md", "2/AI 工具.md"]);
  });
  it("内容高相似(Jaccard ≥ 0.7)→ 高相似组;低相似不入组", () => {
    const base = "如何在 Windows 上安装 Node.js 并配置环境变量,包括下载安装器与源码编译两种方式。";
    const groups = findSimilarGroups([
      { relPath: "a.md", name: "a.md", content: base },
      { relPath: "b.md", name: "b.md", content: base + "另外补充一点安装后配置的内容。" },
      { relPath: "c.md", name: "c.md", content: "完全无关的内容,讲的是数据库备份与恢复策略详情。" },
    ]);
    expect(groups.some((g) => g.files.includes("a.md") && g.files.includes("b.md"))).toBe(true);
    expect(groups.some((g) => g.files.includes("c.md"))).toBe(false);
  });
});

describe("sanitizePlan", () => {
  it("丢弃未知路径/空组/危险路径,合并补 .md,超限截断", () => {
    const known = new Set(["a.md", "b.md", "c/d.md"]);
    const plan = sanitizePlan(
      {
        categories: [
          { name: "接口文档", files: ["a.md", "b.md", "hack/../etc"] },
          { name: "", files: ["a.md"] },
          { name: "坏分类/../..", files: ["c/d.md"] },
        ],
        merges: [
          { target: "合并文档", sources: ["a.md", "b.md", "ghost.md"] },
          { target: "", sources: ["a.md"] },
        ],
        enrich: ["c/d.md", "ghost.md", "../../x"],
      },
      known
    );
    expect(plan.categories).toHaveLength(1);
    expect(plan.categories[0]).toEqual({ name: "接口文档", files: ["a.md", "b.md"] });
    expect(plan.merges).toEqual([{ target: "合并文档.md", sources: ["a.md", "b.md"] }]);
    expect(plan.enrich).toEqual(["c/d.md"]);
  });
});

describe("文件操作(临时目录)", () => {
  it("applyCategories 移动到分类子目录,重名加序号,已在目标内的跳过", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "libai-"));
    fs.writeFileSync(path.join(root, "a.md"), "1");
    fs.mkdirSync(path.join(root, "文档"), { recursive: true });
    fs.writeFileSync(path.join(root, "文档", "a.md"), "2");
    const r = applyCategories(root, [{ name: "文档", files: ["a.md"] }]);
    expect(r.moved).toBe(1);
    expect(fs.readFileSync(path.join(root, "文档", "a(1).md"), "utf8")).toBe("1");
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("writeDocWithBackup 覆盖前备份原件到 _原始备份", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "libai-bak-"));
    fs.writeFileSync(path.join(root, "doc.md"), "原稿");
    writeDocWithBackup(root, "doc.md", "完善后的内容", "T1");
    expect(fs.readFileSync(path.join(root, "doc.md"), "utf8")).toBe("完善后的内容");
    expect(fs.readFileSync(path.join(root, "_原始备份", "T1", "doc.md"), "utf8")).toBe("原稿");
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("conflictFreeName 冲突加序号", () => {
    const existing = new Set(["readme.md", "readme(1).md"]);
    expect(conflictFreeName(existing, "x.md")).toBe("x.md");
    expect(conflictFreeName(existing, "readme.md")).toBe("readme(2).md");
  });
});

describe("importToVault", () => {
  it("复制到 vault 子目录,重名加序号,越界目标拒绝", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "libai-vault-"));
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), "libai-src-"));
    fs.writeFileSync(path.join(lib, "a.md"), "A");
    fs.mkdirSync(path.join(lib, "sub"), { recursive: true });
    fs.writeFileSync(path.join(lib, "sub", "a.md"), "B");
    const r1 = importToVault(vault, lib, ["a.md", "sub/a.md"], "Apifox导入");
    expect(r1.imported).toBe(2);
    expect(fs.readFileSync(path.join(vault, "Apifox导入", "a.md"), "utf8")).toBe("A");
    expect(fs.readFileSync(path.join(vault, "Apifox导入", "a(1).md"), "utf8")).toBe("B");
    // 库外路径(../逃逸)被逐文件安全跳过,不抛出、不写入
    const r2 = importToVault(vault, lib, ["../escape.md"], "x");
    expect(r2.imported).toBe(0);
    expect(r2.skipped).toBe(1);
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(lib, { recursive: true, force: true });
  });
});
