import path from "node:path";

// 标题 → vault 安全文件名:与 launch.ts sanitizeModelName 同一非法字符集(/ \ : * ? " < > | [ ])
export function toVaultFileName(title: string): string {
  return title.replace(/[[\]*?"<>|/:\\]/g, "_").slice(0, 60) || "未命名";
}

export function buildVaultPath(vaultRoot: string, subDir: string, title: string): string {
  return path.join(vaultRoot, subDir, `${toVaultFileName(title)}.md`);
}

// tags 为 DB 中的 JSON 文本(notes.tags);产出 Obsidian 友好的 md:标题/正文/标签行,trimEnd 保证无尾随空行
export function noteToMarkdown(note: { title: string; body: string; tags: string; createdAt: string }): string {
  const tags = JSON.parse(note.tags) as string[];
  return (`# ${note.title}\n\n${note.body}\n\n${tags.map((t) => `#${t}`).join(" ")}\n`).trimEnd() + "\n";
}
