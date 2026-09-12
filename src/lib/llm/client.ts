export interface LlmMessage { role: "system" | "user" | "assistant"; content: string }
export interface LlmResult { text: string; tokensIn: number; tokensOut: number; model: string }
export interface LlmConfig { model: string; apiBase: string; protocol: "openai" | "anthropic"; apiKey: string }

export function resolveApiKey(ref: string | null): string {
  if (!ref) return "";
  if (ref.startsWith("env:")) return process.env[ref.slice(4)] ?? "";
  if (ref.startsWith("plain:")) return ref.slice(6);
  return "";
}

export async function callLlm(cfg: LlmConfig, messages: LlmMessage[], fetchImpl: typeof fetch = fetch): Promise<LlmResult> {
  if (cfg.protocol === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || undefined;
    const rest = messages.filter((m) => m.role !== "system");
    // 30s 兜底超时防止单次请求挂死;按执行器 timeoutMs 的精细接线属 Plan 2。
    const res = await fetchImpl(`${cfg.apiBase}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages: rest }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { text: data.content?.[0]?.text ?? "", tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0, model: data.model };
  }
  const res = await fetchImpl(`${cfg.apiBase}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content ?? "", tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0, model: data.model };
}

export async function callLlmWithRetry(cfg: LlmConfig, messages: LlmMessage[], fetchImpl: typeof fetch = fetch): Promise<LlmResult> {
  try {
    return await callLlm(cfg, messages, fetchImpl);
  } catch {
    await new Promise((r) => setTimeout(r, 300));
    return await callLlm(cfg, messages, fetchImpl);
  }
}

/** 去除 Claude Code 式上下文提示后缀(如 mimo-v2.5[1M] → mimo-v2.5):方括号段不属于 API 模型名,原样发送会被供应商拒绝。 */
export function stripModelSuffix(model: string): string {
  return model.replace(/\[[^\]]*\]\s*$/, "").trim();
}

export function executorLlmConfig(ex: { type: string; model: string | null; apiBase: string | null; protocol: string | null; apiKeyRef: string | null }): LlmConfig {
  if (ex.type !== "llm" || !ex.model || !ex.apiBase) throw new Error(`执行器未配置模型或端点`);
  return { model: stripModelSuffix(ex.model), apiBase: ex.apiBase, protocol: ex.protocol === "anthropic" ? "anthropic" : "openai", apiKey: resolveApiKey(ex.apiKeyRef) };
}
