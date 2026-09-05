import { z } from "zod";
import { callLlmWithRetry, executorLlmConfig, type LlmConfig, type LlmMessage } from "@/lib/llm/client";

export const TriageResultSchema = z.object({
  tags: z.array(z.string().min(1)).max(5),
  complexity: z.enum(["S", "M", "L"]),
  reason: z.string(),
});
export type TriageResult = z.infer<typeof TriageResultSchema>;

export const FALLBACK_TRIAGE: TriageResult = { tags: ["事务"], complexity: "M", reason: "分诊失败,已用默认(标签=事务,复杂度=M)" };

export function buildTriagePrompt(task: { title: string; description: string }, knownTags: string[]): LlmMessage[] {
  return [
    { role: "system", content: `你是任务分诊助手。为任务建议标签与复杂度。可用标签:${knownTags.join("、")}(可新增,最多 5 个)。复杂度:S=琐事(<10 分钟)、M=常规、L=重要需深度处理。只输出 JSON:{"tags":[...],"complexity":"S|M|L","reason":"简短理由"}` },
    { role: "user", content: `任务标题:${task.title}\n任务描述:${task.description || "(无)"}` },
  ];
}

export function parseTriage(raw: string): TriageResult | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return TriageResultSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export async function triageTask(
  task: { title: string; description: string },
  knownTags: string[],
  cfg: LlmConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ result: TriageResult; degraded: boolean }> {
  if (!cfg) return { result: FALLBACK_TRIAGE, degraded: true };
  try {
    const out = await callLlmWithRetry(cfg, buildTriagePrompt(task, knownTags), fetchImpl);
    const parsed = parseTriage(out.text);
    if (parsed) return { result: parsed, degraded: false };
    console.warn("[triage] 输出无法解析,降级:", out.text.slice(0, 200));
    return { result: FALLBACK_TRIAGE, degraded: true };
  } catch (err) {
    // 降级可观测性(Task 7 评审):静默吞错会让"为什么一直是 fallback"无法排查
    console.warn("[triage] 分诊降级:", err);
    return { result: FALLBACK_TRIAGE, degraded: true };
  }
}

export { executorLlmConfig };
