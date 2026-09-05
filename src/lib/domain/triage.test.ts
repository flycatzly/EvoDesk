import { describe, it, expect, vi } from "vitest";
import { buildTriagePrompt, parseTriage, triageTask, FALLBACK_TRIAGE, executorLlmConfig } from "./triage";

describe("parseTriage", () => {
  it("解析纯 JSON", () => {
    expect(parseTriage('{"tags":["写作"],"complexity":"M","reason":"r"}')).toEqual({ tags: ["写作"], complexity: "M", reason: "r" });
  });
  it("容忍围栏文本", () => {
    expect(parseTriage('好的:```json\n{"tags":[],"complexity":"S","reason":"x"}\n```')).toEqual({ tags: [], complexity: "S", reason: "x" });
  });
  it("非法返回 null", () => {
    expect(parseTriage("不是 JSON")).toBeNull();
    expect(parseTriage('{"tags":"写作","complexity":"M"}')).toBeNull();
  });
});

describe("triageTask", () => {
  const cfg = { model: "m", apiBase: "https://x", protocol: "openai" as const, apiKey: "k" };
  it("成功:解析 LLM 输出", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"tags":["研究"],"complexity":"L","reason":"ok"}' } }], usage: {}, model: "m" }), { status: 200 }));
    const r = await triageTask({ title: "写论文", description: "AI 方向" }, ["写作", "研究"], cfg, f as typeof fetch);
    expect(r.result.tags).toEqual(["研究"]);
    expect(r.degraded).toBe(false);
  });
  it("两次失败 → 降级 fallback(固定恰好重试 1 次)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
      const r = await triageTask({ title: "x", description: "" }, [], cfg, f as typeof fetch);
      expect(r.degraded).toBe(true);
      expect(r.result).toEqual(FALLBACK_TRIAGE);
      expect(f).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
  it("cfg 为 null(未配模型)→ 直接降级且不调接口", async () => {
    const f = vi.fn();
    const r = await triageTask({ title: "x", description: "" }, [], null, f as typeof fetch);
    expect(r.degraded).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("buildTriagePrompt", () => {
  it("包含任务与已知标签,要求 JSON 输出", () => {
    const msgs = buildTriagePrompt({ title: "t", description: "d" }, ["写作", "开发"]);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("写作");
    expect(msgs[1].content).toContain("t");
  });
});

describe("executorLlmConfig(经 re-export 覆盖)", () => {
  it("type 非 llm 抛错", () => {
    expect(() => executorLlmConfig({ type: "manual", model: "m", apiBase: "https://x", protocol: null, apiKeyRef: null })).toThrow();
  });
  it("缺 model 或 apiBase 抛错", () => {
    expect(() => executorLlmConfig({ type: "llm", model: null, apiBase: "https://x", protocol: null, apiKeyRef: null })).toThrow();
    expect(() => executorLlmConfig({ type: "llm", model: "m", apiBase: null, protocol: null, apiKeyRef: null })).toThrow();
  });
  it("protocol 缺省为 openai,anthropic 透传;apiKeyRef 解析", () => {
    expect(executorLlmConfig({ type: "llm", model: "m", apiBase: "https://x", protocol: null, apiKeyRef: "plain:k" })).toEqual({ model: "m", apiBase: "https://x", protocol: "openai", apiKey: "k" });
    expect(executorLlmConfig({ type: "llm", model: "m", apiBase: "https://y", protocol: "anthropic", apiKeyRef: null }).protocol).toBe("anthropic");
  });
});
