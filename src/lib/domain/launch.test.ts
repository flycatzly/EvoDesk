import { describe, it, expect, afterEach } from "vitest";
import { sanitizeModelName, buildLaunchSettings, spawnClaude } from "./launch";
import fs from "node:fs";
import path from "node:path";

// 测试产生的临时 settings 文件(含假密钥),每个用例后清理
const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) fs.rmSync(cleanup.pop()!, { force: true });
});

describe("sanitizeModelName", () => {
  it("非法文件名字符全部替换为 _", () => {
    expect(sanitizeModelName("a/b\\c:d*e?f\"g<h>i|j[k]l")).toBe("a_b_c_d_e_f_g_h_i_j_k_l");
  });
  it("合法名保持原样", () => {
    expect(sanitizeModelName("claude-sonnet-4.5")).toBe("claude-sonnet-4.5");
  });
});

describe("buildLaunchSettings", () => {
  it("model 覆盖 env.ANTHROPIC_MODEL + 顶层 model,并落 data/generated", () => {
    const raw = JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: "sk-test-token", ANTHROPIC_BASE_URL: "https://api.example.com" },
    });
    const file = buildLaunchSettings(raw, "test/model:1");
    cleanup.push(file);
    const expectedDir = path.join(process.cwd(), "data", "generated");
    expect(path.dirname(file)).toBe(expectedDir);
    expect(file).toContain("launch-test_model_1-");
    const cfg = JSON.parse(fs.readFileSync(file, "utf8")) as { env: Record<string, string>; model?: string };
    expect(cfg.env.ANTHROPIC_MODEL).toBe("test/model:1");
    expect(cfg.model).toBe("test/model:1");
    expect(cfg.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-test-token");
    expect(cfg.env.ANTHROPIC_BASE_URL).toBe("https://api.example.com");
  });
  it("model 为 null → 原样落盘,文件名用 default", () => {
    const raw = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-x" } });
    const file = buildLaunchSettings(raw, null);
    cleanup.push(file);
    expect(file).toContain("launch-default-");
    const cfg = JSON.parse(fs.readFileSync(file, "utf8")) as { env: Record<string, string>; model?: string };
    expect(cfg.model).toBeUndefined();
    expect(cfg.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-x");
  });
});

describe("spawnClaude", () => {
  it("dryRun 返回命令预览,不真正开窗", async () => {
    const r = await spawnClaude("C:\\tmp\\settings.json", "m1", "D:\\work\\dir", true);
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("claude.cmd");
    expect(r.detail).toContain("--settings C:\\tmp\\settings.json");
    expect(r.detail).toContain("--model m1");
    expect(r.detail).toContain("工作目录:D:\\work\\dir");
  });
  it("dryRun 无 model → 不带 --model", async () => {
    const r = await spawnClaude("C:\\tmp\\settings.json", null, "D:\\work", true);
    expect(r.status).toBe("ok");
    expect(r.detail).not.toContain("--model");
    expect(r.detail).toContain("工作目录:D:\\work");
  });
});
