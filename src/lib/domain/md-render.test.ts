import { describe, it, expect } from "vitest";
import { markdownToHtml, escapeHtml, docToHtml } from "./md-render";

describe("markdownToHtml 链接安全(回归:2026-09-22 XSS 修复)", () => {
  it("普通 http 链接正常渲染", () => {
    const html = markdownToHtml("[Z.ai](https://chat.z.ai)");
    expect(html).toContain('<a href="https://chat.z.ai"');
    expect(html).toContain(">Z.ai</a>");
  });
  it("javascript:/data:/vbscript: 协议被置为空锚", () => {
    expect(markdownToHtml("[x](javascript:alert(1))")).toContain('href="#"');
    expect(markdownToHtml("[x](data:text/html,<script>)")).toContain('href="#"');
    expect(markdownToHtml("[x](vbscript:msgbox)")).toContain('href="#"');
    expect(markdownToHtml("[x](javascript:alert(1))")).not.toContain("javascript:");
  });
  it('链接 URL 中的双引号被转 %22,无法逃逸 href 属性', () => {
    const html = markdownToHtml('[x](https://a.b/c" onmouseover="alert(1))');
    expect(html).not.toContain('" onmouseover');
    expect(html).toContain("%22");
  });
  it("正文 HTML 一律转义(脚本注入无效)", () => {
    const html = markdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("escapeHtml", () => {
  it("转义 & < >", () => {
    expect(escapeHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });
});

describe("docToHtml", () => {
  it("产出完整 HTML 文档且正文经转义", () => {
    const html = docToHtml("测试文档", "# 标题\n\n正文 <b>粗</b>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("测试文档");
    expect(html).toContain("&lt;b&gt;");
  });
});
