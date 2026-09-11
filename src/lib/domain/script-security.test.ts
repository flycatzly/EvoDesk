import { describe, it, expect } from "vitest";
import { scanRisk, isPathWithin, checkWhitelist, confirmRequired, DEFAULT_WHITELIST } from "./script-security";
import path from "node:path";

describe("scanRisk", () => {
  it("命中破坏性模式", () => {
    expect(scanRisk("Remove-Item C:\\x -Recurse -Force").length).toBeGreaterThan(0);
    expect(scanRisk("rm -rf /").length).toBeGreaterThan(0);
    expect(scanRisk("del /s C:\\x").length).toBeGreaterThan(0);
    expect(scanRisk("shutdown /s").length).toBeGreaterThan(0);
  });
  it("普通命令零命中", () => {
    expect(scanRisk("Get-ChildItem .")).toHaveLength(0);
    expect(scanRisk("echo hello")).toHaveLength(0);
  });
  it("变体与误报回归", () => {
    expect(scanRisk("Get-Process | Format-Table")).toHaveLength(0);
    expect(scanRisk("format c:").length).toBeGreaterThan(0);
    expect(scanRisk("del /f /s /q C:\\x").length).toBeGreaterThan(0);
    expect(scanRisk("rd /q /s C:\\x").length).toBeGreaterThan(0);
    expect(scanRisk("Remove-Item C:\\x -Force -Recurse").length).toBeGreaterThan(0);
    expect(scanRisk("Remove-Item C:\\x -r -fo").length).toBeGreaterThan(0);
    expect(scanRisk("robocopy C:\\a C:\\b /MIR").length).toBeGreaterThan(0);
  });
});

describe("isPathWithin/checkWhitelist", () => {
  const root = path.resolve("data/sandbox");
  it("子目录与自身在内,穿越拒绝", () => {
    expect(isPathWithin(path.join(root, "sub"), root)).toBe(true);
    expect(isPathWithin(root, root)).toBe(true);
    expect(isPathWithin(path.resolve(root, ".."), root)).toBe(false);
  });
  it("checkWhitelist:默认白名单含 data/sandbox", () => {
    expect(checkWhitelist(root, DEFAULT_WHITELIST)).toBe(true);
    expect(checkWhitelist(path.resolve("C:\\Windows"), DEFAULT_WHITELIST)).toBe(false);
  });
});

describe("confirmRequired", () => {
  it("静态命令 + autoApprove → 免确认;含渲染变量或未开自动批准 → 需确认", () => {
    expect(confirmRequired("echo hi", { autoApprove: true })).toBe(false);
    expect(confirmRequired("echo {{prev_output}}", { autoApprove: true })).toBe(true);
    expect(confirmRequired("echo hi", { autoApprove: false })).toBe(true);
  });
});
