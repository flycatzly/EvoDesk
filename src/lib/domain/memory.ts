// AI 长期记忆库:对话后自动提取"关于用户的长期事实",新对话自动注入 system 提示词。
// 提取是尽力而为(无 AI/失败则跳过);注入按 pinned 优先 + 最新,条数有上限防提示词膨胀。
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { memories } from "@/lib/db/schema";

export const MEMORY_INJECT_LIMIT = 12;
const MAX_MEMORY_LEN = 200;

export function listMemories(db: Db) {
  return db.select().from(memories).orderBy(desc(memories.pinned), desc(memories.createdAt)).all() as (typeof memories.$inferSelect)[];
}

/** 注入用文本:pinned 优先 + 最新,上限 MEMORY_INJECT_LIMIT;空库返回空串 */
export function memoryContext(db: Db): string {
  const rows = db.select().from(memories).orderBy(desc(memories.pinned), desc(memories.createdAt)).limit(MEMORY_INJECT_LIMIT).all() as (typeof memories.$inferSelect)[];
  if (rows.length === 0) return "";
  return rows.map((m) => `- ${m.content}`).join("\n");
}

export function addMemory(db: Db, content: string, sourceChatId: string | null): void {
  const text = content.trim().slice(0, MAX_MEMORY_LEN);
  if (!text) return;
  // 简单去重:与现有记忆完全一致则跳过
  const dup = db.select().from(memories).where(eq(memories.content, text)).all()[0];
  if (dup) return;
  db.insert(memories).values({
    id: crypto.randomUUID(), content: text, sourceChatId,
    pinned: false, hits: 0, createdAt: new Date().toISOString(),
  }).run();
}

/** 从 AI 回复中提取记忆:约定 AI 在回复末尾输出 <memory>事实</memory> 标记(可多个)。 */
export function extractMemoryTags(text: string): string[] {
  const out: string[] = [];
  const re = /<memory>([\s\S]*?)<\/memory>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const fact = m[1].trim().slice(0, MAX_MEMORY_LEN);
    if (fact) out.push(fact);
  }
  return out.slice(0, 3); // 单轮最多 3 条,防刷屏
}

/** 对话消息是否值得提取(太短/纯问候不提取,由 system 提示词引导 AI 自律,这里是兜底) */
export const MEMORY_EXTRACT_RULE = "当对话中出现值得长期记住的稳定信息(用户偏好/长期项目背景/固定工作习惯),在回复最末尾另起一行输出 <memory>一句中文事实</memory>(最多 3 条);琐碎或一次性信息不要输出。";

/** 上限保护:超过 200 条时删除最旧的非置顶记忆 */
export function pruneMemories(db: Db, max = 200): void {
  const rows = listMemories(db);
  if (rows.length <= max) return;
  for (const m of rows.filter((x) => !x.pinned).slice(max - rows.length)) {
    db.delete(memories).where(eq(memories.id, m.id)).run();
  }
}
