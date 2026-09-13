import { describe, it, expect } from "vitest";
import { categoryForExtension, planClassification, dedupeTargetName, isProtectedDir } from "./file-organize";

describe("file-organize", () => {
  it("categoryForExtension 按扩展分类,未知归其他", () => {
    expect(categoryForExtension("a.PNG")).toBe("图片");
    expect(categoryForExtension("b.md")).toBe("文档");
    expect(categoryForExtension("c.xlsx")).toBe("表格数据");
    expect(categoryForExtension("d.py")).toBe("代码");
    expect(categoryForExtension("e.nyf")).toBe("数据配置");
    expect(categoryForExtension("f.mp4")).toBe("音频视频");
    expect(categoryForExtension("g.7z")).toBe("压缩包");
    expect(categoryForExtension("h.xyz")).toBe("其他");
  });
  it("planClassification 只规划根级散文件,目录与隐藏文件跳过", () => {
    const plan = planClassification([
      { name: "a.png", isFile: true },
      { name: "sub", isFile: false },
      { name: ".hidden", isFile: true },
      { name: "b.md", isFile: true },
    ]);
    expect(plan.map((p) => p.from).sort()).toEqual(["a.png", "b.md"]);
    expect(plan.find((p) => p.from === "a.png")!.toDir).toBe("图片");
  });
  it("dedupeTargetName 重名追加序号", () => {
    const existing = ["report.pdf", "report(1).pdf"];
    expect(dedupeTargetName(existing, "new.txt")).toBe("new.txt");
    expect(dedupeTargetName(existing, "report.pdf")).toBe("report(2).pdf");
  });
  it("保护目录识别(分类/去重输出区不再被二次整理)", () => {
    expect(isProtectedDir("_分类")).toBe(true);
    expect(isProtectedDir("_重复文件")).toBe(true);
    expect(isProtectedDir("图片")).toBe(false);
  });
});
