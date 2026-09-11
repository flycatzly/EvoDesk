import { describe, it, expect, beforeAll } from "vitest";
import { shellCommand, executeScript } from "./script-runner";
import path from "node:path";
import fs from "node:fs";

const cwd = path.join(process.cwd(), "data", "sandbox");
beforeAll(() => fs.mkdirSync(cwd, { recursive: true }));

describe("shellCommand", () => {
  it("四种 shell 映射", () => {
    expect(shellCommand("powershell", "x")).toEqual({ file: "powershell", args: ["-NoProfile", "-Command", "x"] });
    expect(shellCommand("cmd", "x")).toEqual({ file: "cmd", args: ["/c", "x"] });
    expect(shellCommand("bash", "x")).toEqual({ file: "bash", args: ["-c", "x"] });
    expect(shellCommand("python", "x")).toEqual({ file: "python", args: ["-c", "x"] });
  });
});

describe("executeScript", () => {
  it("powershell echo 成功并捕获输出", async () => {
    const r = await executeScript("powershell", "Write-Output hello-evodesk", { cwd, timeoutMs: 15000 });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("hello-evodesk");
    expect(r.timedOut).toBe(false);
  });
  it("非零退出 → exitCode 记录", async () => {
    const r = await executeScript("powershell", "exit 3", { cwd, timeoutMs: 15000 });
    expect(r.exitCode).toBe(3);
  });
  it("超时终止并标记 timedOut", async () => {
    const r = await executeScript("powershell", "Start-Sleep -Seconds 30", { cwd, timeoutMs: 1500 });
    expect(r.timedOut).toBe(true);
  }, 20000);
  it("未知 shell 命令 → error 路径,exitCode null", async () => {
    const r = await executeScript("powershell", "definitely-not-a-real-command-xyz", { cwd, timeoutMs: 15000 });
    expect(r.exitCode).not.toBe(0);
  });
});
