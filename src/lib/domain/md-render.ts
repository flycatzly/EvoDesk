// 轻量 Markdown → HTML 渲染(无依赖,浏览器/服务端均可)。
// 覆盖:标题/粗体/行内代码/代码块/列表/引用/链接/段落;用于阅读面板与 HTML 导出预览。
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  let inQuote = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("```")) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else {
        if (inList) { out.push("</ul>"); inList = false; }
        if (inQuote) { out.push("</blockquote>"); inQuote = false; }
        out.push("<pre><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) { out.push(escapeHtml(raw)); continue; }
    if (/^>\s?/.test(line)) {
      if (!inQuote) { out.push("<blockquote>"); inQuote = true; }
      out.push(inline(line.replace(/^>\s?/, "")));
      continue;
    }
    if (inQuote) { out.push("</blockquote>"); inQuote = false; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""))}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (!line.trim()) continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inQuote) out.push("</blockquote>");
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

/** 单篇导出 HTML 文档(内联样式,浏览器直接打开) */
export function docToHtml(title: string, md: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font-family:'Segoe UI','Microsoft YaHei UI',sans-serif;max-width:860px;margin:0 auto;padding:32px 20px;line-height:1.7;color:#24292f}
h1,h2,h3,h4{line-height:1.3;border-bottom:1px solid #eaecef;padding-bottom:.3em}
code{background:#f6f8fa;padding:2px 6px;border-radius:4px;font-size:.9em}
pre{background:#f6f8fa;padding:14px;border-radius:8px;overflow:auto}
pre code{padding:0;background:none}
a{color:#0969da}
blockquote{border-left:4px solid #d0d7de;margin:0;padding:0 1em;color:#57606a}
</style>
</head>
<body>
${markdownToHtml(md)}
</body>
</html>`;
}
