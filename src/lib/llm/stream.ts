import type { LlmConfig, LlmResult, LlmMessage } from "./client";

function sseDataLines(buffer: string): string[] {
  // 事件块可能含 event:/注释行,data: 行需按行提取;块内多行 data 按 SSE 规范以 \n 连接
  return buffer.split("\n\n").flatMap((b) => {
    const lines = b.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    return lines.length ? [lines.join("\n")] : [];
  });
}

/** 逐 delta yield 文本;生成器 return 值为聚合 LlmResult。消费者若提前退出必须 await it.return() 释放底层 reader(Task 11/16 遵约)。 */
export async function* streamLlm(
  cfg: LlmConfig, messages: LlmMessage[], fetchImpl: typeof fetch = fetch,
): AsyncGenerator<string, LlmResult, void> {
  const url = cfg.protocol === "anthropic" ? `${cfg.apiBase}/v1/messages` : `${cfg.apiBase}/chat/completions`;
  const body = cfg.protocol === "anthropic"
    ? { model: cfg.model, max_tokens: 8192, stream: true, system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || undefined, messages: messages.filter((m) => m.role !== "system") }
    : { model: cfg.model, stream: true, stream_options: { include_usage: true }, messages };
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, ...(cfg.protocol === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) throw new Error(`${cfg.protocol} ${res.status}: ${await res.text().catch(() => "")}`);
  let text = ""; let tokensIn = 0; let tokensOut = 0; let model = cfg.model;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const data of sseDataLines(blocks.join("\n\n"))) {
      if (data === "[DONE]") continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(data); } catch { continue; }
      if (cfg.protocol === "anthropic") {
        const type = evt.type as string;
        if (type === "error") throw new Error(`anthropic stream error: ${JSON.stringify(evt).slice(0, 300)}`);
        if (type === "message_start") { tokensIn = (evt as { message?: { usage?: { input_tokens?: number } } }).message?.usage?.input_tokens ?? 0; model = (evt as { message?: { model?: string } }).message?.model ?? model; }
        else if (type === "content_block_delta") { const t = (evt as { delta?: { text?: string } }).delta?.text ?? ""; if (t) { text += t; yield t; } }
        else if (type === "message_delta") { tokensOut = (evt as { usage?: { output_tokens?: number } }).usage?.output_tokens ?? tokensOut; }
      } else {
        if ((evt as { error?: unknown }).error) throw new Error(`openai stream error: ${JSON.stringify(evt).slice(0, 300)}`);
        const choices = (evt as { choices?: { delta?: { content?: string } }[] }).choices;
        const usage = (evt as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
        if (usage) { tokensIn = usage.prompt_tokens ?? tokensIn; tokensOut = usage.completion_tokens ?? tokensOut; }
        const t = choices?.[0]?.delta?.content ?? "";
        if (t) { text += t; yield t; }
        if ((evt as { model?: string }).model) model = (evt as { model: string }).model;
      }
    }
  }
  if (!text && tokensOut === 0 && tokensIn === 0) throw new Error("流式响应为空(可能非 SSE 端点或全部被过滤)");
  return { text, tokensIn, tokensOut, model };
}
