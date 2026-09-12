import { describe, it, expect, afterEach } from "vitest";
import { sanitizeModelName, buildLaunchSettings, spawnClaude, isValidModelName, sweepStaleSettings } from "./launch";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

describe("isValidModelName", () => {
  it("合法字符(字母数字 . _ : @ -)通过", () => {
    expect(isValidModelName("claude-sonnet-4.5")).toBe(true);
    expect(isValidModelName("deepseek_chat:v3.1@2024")).toBe(true);
  });
  it("shell 元字符/空格/空串拒绝", () => {
    expect(isValidModelName("x & calc.exe")).toBe(false);
    expect(isValidModelName("a|b")).toBe(false);
    expect(isValidModelName("a;b")).toBe(false);
    expect(isValidModelName("model name")).toBe(false);
    expect(isValidModelName("")).toBe(false);
  });
});

describe("spawnClaude", () => {
  it("非法模型名 → failed 含 非法字符(dryRun 也 fail closed)", async () => {
    const r = await spawnClaude("C:\\tmp\\settings.json", "x & echo hacked", "D:\\work", true);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("非法字符");
    expect(r.detail).toContain("x & echo hacked");
  });
  it("非法模型名真实路径 → failed,校验先于 spawn/预检,不触发执行", async () => {
    const r = await spawnClaude("C:\\tmp\\settings.json", "a & b", "D:\\work", false);
    expect(r.status).toBe("failed");
    expect(r.detail).toContain("非法字符");
  });
  it("dryRun 不做 claude.cmd 预检(环境无关;真实 spawn 的预检路径需 mock 才能测,此处不测)", async () => {
    const r = await spawnClaude("C:\\tmp\\settings.json", null, "D:\\work", true);
    expect(r.status).toBe("ok");
  });
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

describe("sweepStaleSettings", () => {
  it("超龄 launch-*.json 删除、新鲜文件保留,返回删除数", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-sweep-"));
    const oldFile = path.join(dir, "launch-old.json");
    const freshFile = path.join(dir, "launch-fresh.json");
    fs.writeFileSync(oldFile, "{}");
    fs.writeFileSync(freshFile, "{}");
    const past = new Date(Date.now() - 10 * 60_000); // 10 分钟前 → 超过默认 5 分钟
    fs.utimesSync(oldFile, past, past);
    try {
      const removed = sweepStaleSettings(5 * 60_000, dir);
      expect(removed).toBe(1);
      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(freshFile)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("非 launch-*.json 不清扫;目录不存在 → 返回 0 不抛错", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-sweep2-"));
    fs.writeFileSync(path.join(dir, "other.json"), "{}");
    try {
      expect(sweepStaleSettings(5 * 60_000, dir)).toBe(0);
      expect(fs.existsSync(path.join(dir, "other.json"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(sweepStaleSettings(5 * 60_000, path.join(os.tmpdir(), "evodesk-no-such-dir-qa"))).toBe(0);
  });
});

describe("spawnClaude 模型后缀剥离", () => {
  it("dryRun 预览使用剥离后的模型名", async () => {
    const r = await spawnClaude("C:/no/such/settings.json", "mimo-v2.5[1M]", "C:/wd", true);
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("mimo-v2.5");
    expect(r.detail).not.toContain("[1M]");
  });
});
