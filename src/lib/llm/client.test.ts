import { describe, it, expect, vi } from "vitest";
import { callLlm, callLlmWithRetry, resolveApiKey } from "./client";

const okOpenai = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: "m1" }), { status: 200 });
const okAnthropic = () =>
  new Response(JSON.stringify({ content: [{ text: "Bonjour" }], usage: { input_tokens: 7, output_tokens: 3 }, model: "m2" }), { status: 200 });

describe("resolveApiKey", () => {
  it("env: 前缀读环境变量,plain: 取原文", () => {
    process.env.TEST_KEY = "abc";
    expect(resolveApiKey("env:TEST_KEY")).toBe("abc");
    expect(resolveApiKey("plain:xyz")).toBe("xyz");
    expect(resolveApiKey(null)).toBe("");
  });
});

describe("callLlm", () => {
  it("openai 协议:POST {base}/chat/completions 并解析", async () => {
    const f = vi.fn().mockResolvedValue(okOpenai());
    const r = await callLlm({ model: "m1", apiBase: "https://x/v1", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    expect(f.mock.calls[0][0]).toBe("https://x/v1/chat/completions");
    expect(r).toMatchObject({ text: "你好", tokensIn: 10, tokensOut: 5, model: "m1" });
  });
  it("anthropic 协议:POST {base}/v1/messages,system 抽出,Bearer 鉴权", async () => {
    const f = vi.fn().mockResolvedValue(okAnthropic());
    const r = await callLlm({ model: "m2", apiBase: "https://y/api/anthropic", protocol: "anthropic", apiKey: "k" },
      [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }], f as typeof fetch);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(f.mock.calls[0][0]).toBe("https://y/api/anthropic/v1/messages");
    expect(body.system).toBe("be brief");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer k");
    expect(r).toMatchObject({ text: "Bonjour", tokensIn: 7, tokensOut: 3, model: "m2" });
  });
  it("非 2xx 抛错", async () => {
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(callLlm({ model: "m", apiBase: "https://x", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch)).rejects.toThrow(/500/);
  });
  it("重试一次后成功", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("boom", { status: 502 })).mockResolvedValueOnce(okOpenai());
    const r = await callLlmWithRetry({ model: "m", apiBase: "https://x", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    expect(r.text).toBe("你好");
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("stripModelSuffix / executorLlmConfig 上下文后缀剥离", () => {
  it("stripModelSuffix:[1M] 后缀剥离,无后缀原样", async () => {
    const { stripModelSuffix } = await import("./client");
    expect(stripModelSuffix("mimo-v2.5[1M]")).toBe("mimo-v2.5");
    expect(stripModelSuffix("glm-4-flash")).toBe("glm-4-flash");
    expect(stripModelSuffix("mimo-v2.5-pro [1M]")).toBe("mimo-v2.5-pro");
  });
  it("executorLlmConfig:model 带上下文后缀时剥落后传给 API", async () => {
    const { executorLlmConfig } = await import("./client");
    const cfg = executorLlmConfig({ type: "llm", model: "mimo-v2.5[1M]", apiBase: "https://x", protocol: null, apiKeyRef: "plain:k" });
    expect(cfg.model).toBe("mimo-v2.5");
  });
});
