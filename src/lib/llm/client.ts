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
    // 120s 兜底超时:大文档 JSON 生成(如 AI 整理计划)可能超过 1 分钟。
    const res = await fetchImpl(`${cfg.apiBase}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 8192, system, messages: rest }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    // content 可能是多段(text/thinking 混合),拼接全部 text 段,避免只取 [0] 截断
    const text = (data.content ?? [])
      .filter((b: { type?: string; text?: string }) => typeof b.text === "string" && (!b.type || b.type === "text"))
      .map((b: { text: string }) => b.text)
      .join("");
    return { text, tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0, model: data.model };
  }
  const res = await fetchImpl(`${cfg.apiBase}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content ?? "", tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0, model: data.model };
}

/** 可重试错误:网络故障/超时/HTTP 5xx/408/429;4xx 鉴权或参数错误重试必然复现,不浪费配额 */
function isRetryable(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (/TimeoutError|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|socket hang up|aborted/i.test(e.message)) return true;
  const m = /^(?:anthropic|openai) (\d{3}):/.exec(e.message);
  if (!m) return true; // 非 HTTP 形态错误(本地抛出)默认可重试
  const code = Number(m[1]);
  return code >= 500 || code === 408 || code === 429;
}

export async function callLlmWithRetry(cfg: LlmConfig, messages: LlmMessage[], fetchImpl: typeof fetch = fetch): Promise<LlmResult> {
  try {
    return await callLlm(cfg, messages, fetchImpl);
  } catch (e) {
    if (!isRetryable(e)) throw e;
    await new Promise((r) => setTimeout(r, 500));
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
