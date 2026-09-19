// 知识库结构化:frontmatter 属性/标签解析、[[双链]]提取、图谱数据构建。
// 全部纯函数;对 md 文本的解析容忍坏格式(无 frontmatter/无链接返回空)。
export type Frontmatter = { tags: string[]; props: Record<string, string> };

/** 解析 YAML-lite frontmatter:只取平铺的 key: value 行与 tags(支持 [a,b] / 逗号 / 多行 - 列表) */
export function parseFrontmatter(content: string): Frontmatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return { tags: [], props: {} };
  const tags = new Set<string>();
  const props: Record<string, string> = {};
  let inTags = false;
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^tags\s*:$/i.test(line)) { inTags = true; continue; }
    if (inTags && /^-\s*/.test(line)) {
      const t = line.replace(/^-\s*/, "").trim();
      if (t) tags.add(t);
      continue;
    }
    inTags = false;
    const kv = /^([A-Za-z_\-\u4e00-\u9fa5]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (key.toLowerCase() === "tags") {
      const inner = value.replace(/^\[/, "").replace(/\]$/, "");
      for (const t of inner.split(/[,，]/)) if (t.trim()) tags.add(t.trim());
    } else if (value) {
      props[key] = value;
    }
  }
  return { tags: [...tags], props };
}

/** 提取 [[双链]] 目标(支持 [[笔记]] 与 [[笔记|别名]]),按出现顺序去重 */
export function extractWikiLinks(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const target = m[1].trim();
    if (target && !seen.has(target)) { seen.add(target); out.push(target); }
  }
  return out;
}

export type GraphNode = { id: string; name: string; tags: string[]; degree: number };
export type GraphEdge = { source: string; target: string };

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; orphanCount: number };

/**
 * 图谱数据:每个 md 文件 = 节点(带标签);正文 [[链接]] → 边(按文件名解析目标节点;
 * 悬空链接指向不存在的文件时,自动创建占位节点——与 Obsidian 行为一致)。
 * 上限 maxFiles 防超大库。
 */
export function buildGraph(files: { relPath: string; name: string; content: string }[], maxFiles = 800): GraphData {
  const docs = files.slice(0, maxFiles).map((f) => ({
    id: f.relPath,
    name: f.name.replace(/\.md$/i, ""),
    content: f.content,
    fm: parseFrontmatter(f.content),
    links: extractWikiLinks(f.content),
  }));
  const byName = new Map(docs.map((d) => [d.name, d]));
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);

  for (const d of docs) {
    nodes.set(d.id, { id: d.id, name: d.name, tags: d.fm.tags, degree: 0 });
  }
  for (const d of docs) {
    for (const target of d.links) {
      let targetId = byName.get(target)?.id;
      if (!targetId) {
        // 悬空链接 → 占位节点
        targetId = `__virtual__:${target}`;
        if (!nodes.has(targetId)) nodes.set(targetId, { id: targetId, name: target, tags: [], degree: 0 });
      }
      if (targetId !== d.id) {
        edges.push({ source: d.id, target: targetId });
        bump(d.id);
        bump(targetId);
      }
    }
  }
  for (const n of nodes.values()) n.degree = degree.get(n.id) ?? 0;
  return { nodes: [...nodes.values()], edges, orphanCount: [...nodes.values()].filter((n) => n.degree === 0).length };
}

/** 标签索引:tag → 文件相对路径列表(供标签筛选与标签图谱) */
export function buildTagIndex(files: { relPath: string; content: string }[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const f of files) {
    for (const tag of parseFrontmatter(f.content).tags) {
      const list = idx.get(tag) ?? [];
      list.push(f.relPath);
      idx.set(tag, list);
    }
  }
  return idx;
}
