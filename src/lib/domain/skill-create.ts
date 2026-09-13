// AI 辅助创建技能:逐轮追问(像需求教练),信息足够后输出可安装的 SKILL.md。
// 纯函数提示词 + 最终产物提取;LLM 调用与落盘在 API 路由层。

export const SKILL_CREATE_MAX_ROUNDS = 5;

export function skillCreateSystemPrompt(roundsUsed: number): string {
  const remaining = Math.max(0, SKILL_CREATE_MAX_ROUNDS - roundsUsed);
  const phase =
    remaining > 0
      ? `当前已完成 ${roundsUsed} 轮提问,还剩最多 ${remaining} 轮。`
      : "已达提问轮次上限,本轮不再提问,必须直接输出最终 SKILL.md。";
  return [
    "你是 EvoDesk 工作台的「技能教练」。用户想要创建一个本地 Agent Skill(一个目录,内含 SKILL.md 文件)。",
    "你的任务:通过逐轮提问澄清技能的目标,最终产出一个完整、可直接安装使用的 SKILL.md。",
    "规则:",
    "1. 每轮只问一个问题(技能的用途/触发时机/操作步骤/边界与注意事项/输出格式),可给 2-4 个选项示例;禁止一次抛出一堆问题。",
    `2. ${phase}`,
    "3. 信息足够(或轮次用尽)时,先输出一行「最终 SKILL.md」,然后给出一个 ```markdown 代码围栏,围栏内是完整文件内容:",
    "   以 YAML frontmatter 开头(--- 包裹),必含 name(小写英文与连字符,≤64 字符)与 description(一句话说明何时使用,中文);",
    "   正文用 markdown 分节:用途 / 使用时机 / 操作步骤(编号、可执行、具体到命令或提示词)/ 注意事项。",
    "4. 语言:简体中文;语气:简洁、教练式。",
  ].join("\n");
}

/** 判断一条 assistant 回复是否已包含最终 SKILL.md,并提取围栏内容;不是最终产物返回 null */
export function extractSkillMd(text: string): string | null {
  if (!text.includes("最终 SKILL.md")) return null;
  const fenced = /```(?:markdown|md)?\s*\r?\n([\s\S]*?)```/.exec(text);
  const body = fenced?.[1]?.trim();
  if (!body || !body.startsWith("---")) return null;
  return body;
}

/** 从 SKILL.md frontmatter 取 name;非法字符回退 slug */
export function skillNameFromMd(md: string, fallback: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const line = m ? m[1].split(/\r?\n/).find((l) => /^name\s*:/.test(l)) ?? "" : "";
  const name = line.slice(line.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
  return slugify(name) || fallback;
}

/** 技能目录名约束:小写字母/数字/连字符,1-64 位 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function isValidSkillSlug(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
}
