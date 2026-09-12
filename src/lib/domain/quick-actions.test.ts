import { describe, it, expect, beforeAll } from "vitest";
import { renderQuickPayload, previewQuickAction, runCommandAction, resolveWorkingDir } from "./quick-actions";
import path from "node:path";
import fs from "node:fs";

const cwd = path.join(process.cwd(), "data", "sandbox");
beforeAll(() => fs.mkdirSync(cwd, { recursive: true }));

describe("renderQuickPayload", () => {
  it("command 型渲染 {{task.title}}", () => {
    const rendered = renderQuickPayload({ type: "command", payload: "分析 {{task.title}} 并输出" }, { title: "登录故障" });
    expect(rendered).toBe("分析 登录故障 并输出");
  });
  it("command 型缺省 task → 空串占位", () => {
    expect(renderQuickPayload({ type: "command", payload: "看 {{task.title}}" })).toBe("看 ");
  });
  it("url 型原样返回,不渲染", () => {
    const payload = "https://example.com/?q={{task.title}}";
    expect(renderQuickPayload({ type: "url", payload }, { title: "X" })).toBe(payload);
  });
});

describe("previewQuickAction", () => {
  it("command 型:风险命中 + needsWhitelist true", () => {
    const p = previewQuickAction({ type: "command", payload: "Remove-Item {{task.title}} -Recurse -Force" }, [cwd]);
    expect(p.needsWhitelist).toBe(true);
    expect(p.risks.length).toBeGreaterThan(0);
  });
  it("url 型:风险为空 + needsWhitelist false", () => {
    const p = previewQuickAction({ type: "url", payload: "https://example.com" }, [cwd]);
    expect(p.risks).toEqual([]);
    expect(p.needsWhitelist).toBe(false);
  });
});

describe("runCommandAction", () => {
  it("powershell echo 成功 → status ok", async () => {
    const r = await runCommandAction("Write-Output hello-quickaction", "powershell", cwd);
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("hello-quickaction");
    expect(r.status).toBe("ok");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  }, 20000);
  it("非零退出 → status failed", async () => {
    const r = await runCommandAction("exit 3", "powershell", cwd);
    expect(r.exitCode).toBe(3);
    expect(r.status).toBe("failed");
  }, 20000);
});

describe("resolveWorkingDir", () => {
  it("null → 默认 data/sandbox", () => {
    expect(resolveWorkingDir(null)).toBe(path.resolve(process.cwd(), "data", "sandbox"));
  });
  it("sandbox 子路径放行", () => {
    const sub = path.join(process.cwd(), "data", "sandbox", "sub");
    expect(resolveWorkingDir(sub)).toBe(path.resolve(sub));
  });
  it("白名单外 → 抛错且含路径", () => {
    const outside = path.join(process.cwd(), "src");
    expect(() => resolveWorkingDir(outside)).toThrow(/工作目录不在白名单/);
    expect(() => resolveWorkingDir(outside)).toThrow(/src/);
  });
});
