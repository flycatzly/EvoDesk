import { describe, it, expect } from "vitest";
import path from "node:path";
import { toVaultFileName, buildVaultPath, noteToMarkdown } from "./notes";

describe("toVaultFileName", () => {
  it("非法文件名字符全部替换为 _", () => {
    expect(toVaultFileName("a/b\\c:d*e?f\"g<h>i|j[k]l")).toBe("a_b_c_d_e_f_g_h_i_j_k_l");
  });
  it("合法标题保持原样", () => {
    expect(toVaultFileName("会议纪要 2026-09-12")).toBe("会议纪要 2026-09-12");
  });
  it("超长截断到 60 字符", () => {
    expect(toVaultFileName("长".repeat(70))).toHaveLength(60);
  });
  it("空标题 → 未命名", () => {
    expect(toVaultFileName("")).toBe("未命名");
  });
});

describe("buildVaultPath", () => {
  it("join vault 根 + 子目录 + 安全文件名.md", () => {
    expect(buildVaultPath("D:\\vault", "02_笔记", "我的标题")).toBe(path.join("D:\\vault", "02_笔记", "我的标题.md"));
    expect(buildVaultPath("D:\\vault", "02_笔记", "a/b")).toBe(path.join("D:\\vault", "02_笔记", "a_b.md"));
  });
});

describe("noteToMarkdown", () => {
  it("结构:标题/空行/正文/空行/标签行,仅一个尾随换行(无尾随空行)", () => {
    const md = noteToMarkdown({ title: "标题", body: "正文内容", tags: '["研究","事务"]', createdAt: "2026-09-12T00:00:00.000Z" });
    expect(md).toBe("# 标题\n\n正文内容\n\n#研究 #事务\n");
  });
  it("无标签/空正文 → trimEnd 收敛,无多余空行", () => {
    expect(noteToMarkdown({ title: "t", body: "b", tags: "[]", createdAt: "x" })).toBe("# t\n\nb\n");
    expect(noteToMarkdown({ title: "t", body: "", tags: "[]", createdAt: "x" })).toBe("# t\n");
  });
});
