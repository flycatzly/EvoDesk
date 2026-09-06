import { describe, it, expect, vi } from "vitest";
import { streamLlm } from "./stream";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(c) { chunks.forEach((ch) => c.enqueue(encoder.encode(ch))); c.close(); },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("streamLlm", () => {
  it("openai SSE:逐 delta yield,usage 汇总,模型透传", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n",
    ]));
    const it = streamLlm({ model: "m", apiBase: "https://x/v1", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    const parts: string[] = [];
    let final;
    for (;;) {
      const r = await it.next();
      if (r.done) { final = r.value; break; }
      parts.push(r.value);
    }
    expect(parts.join("")).toBe("你好");
    expect(final).toMatchObject({ text: "你好", tokensIn: 9, tokensOut: 2, model: "m" });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
  it("anthropic SSE:message_start/content_block_delta/message_delta", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":6},"model":"m2"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Bon"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"jour"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]));
    const it = streamLlm({ model: "m2", apiBase: "https://y/api/anthropic", protocol: "anthropic", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    const parts: string[] = [];
    let final;
    for (;;) {
      const r = await it.next();
      if (r.done) { final = r.value; break; }
      parts.push(r.value);
    }
    expect(parts.join("")).toBe("Bonjour");
    expect(final).toMatchObject({ text: "Bonjour", tokensIn: 6, tokensOut: 4, model: "m2" });
  });
  it("非 2xx 抛错", async () => {
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const it = streamLlm({ model: "m", apiBase: "https://x", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    await expect(it.next()).rejects.toThrow(/500/);
  });
  it("anthropic 中途 event: error → 抛错(不静默截断成功)", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Par"}}\n\n',
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    ]));
    const it = streamLlm({ model: "m2", apiBase: "https://y/api/anthropic", protocol: "anthropic", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    expect((await it.next()).value).toBe("Par");
    await expect(it.next()).rejects.toThrow(/anthropic stream error/);
  });
  it("openai 中途 error 块 → 抛错(不静默截断成功)", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Par"}}]}\n\n',
      'data: {"error":{"message":"boom","type":"server_error"}}\n\n',
    ]));
    const it = streamLlm({ model: "m", apiBase: "https://x/v1", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    expect((await it.next()).value).toBe("Par");
    await expect(it.next()).rejects.toThrow(/openai stream error/);
  });
  it("CRLF 分隔的完整流可正常解析", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\r\n\r\n',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1}}\r\n\r\n',
      "data: [DONE]\r\n\r\n",
    ]));
    const it = streamLlm({ model: "m", apiBase: "https://x/v1", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    const parts: string[] = [];
    let final;
    for (;;) {
      const r = await it.next();
      if (r.done) { final = r.value; break; }
      parts.push(r.value);
    }
    expect(parts.join("")).toBe("Hi");
    expect(final).toMatchObject({ text: "Hi", tokensIn: 3, tokensOut: 1 });
  });
  it("单个 SSE 事件 JSON 跨 chunk 边界拆分仍可解析", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"del',
      'ta":{"content":"Split"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}]}\n\n',
    ]));
    const it = streamLlm({ model: "m", apiBase: "https://x/v1", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    const parts: string[] = [];
    let final;
    for (;;) {
      const r = await it.next();
      if (r.done) { final = r.value; break; }
      parts.push(r.value);
    }
    expect(parts.join("")).toBe("Split!");
    expect(final).toMatchObject({ text: "Split!" });
  });
});
