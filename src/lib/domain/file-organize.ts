// 本地文件整理:按扩展类型智能分类、同内容去重(哈希),只做「移动到分类子目录/重复文件区」,
// 不直接删除任何文件;目标目录白名单 + 纯函数规划先行,应用前可预览。
export const CATEGORY_DIRS = ["图片", "文档", "表格数据", "代码", "数据配置", "音频视频", "压缩包", "其他"] as const;
export type FileCategory = (typeof CATEGORY_DIRS)[number];

const EXT_MAP: [FileCategory, string[]][] = [
  ["图片", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "heic"]],
  ["文档", ["md", "txt", "pdf", "doc", "docx", "rtf", "html", "htm", "epub", "ppt", "pptx"]],
  ["表格数据", ["xls", "xlsx", "csv", "tsv"]],
  ["代码", ["ts", "tsx", "js", "jsx", "py", "java", "c", "cpp", "h", "go", "rs", "sql", "sh", "bat", "ps1", "css"]],
  ["数据配置", ["json", "xml", "yaml", "yml", "ini", "cfg", "toml", "env", "nyf"]],
  ["音频视频", ["mp4", "mov", "avi", "mkv", "mp3", "wav", "flac", "m4a"]],
  ["压缩包", ["zip", "rar", "7z", "tar", "gz"]],
];

/** 整理功能的输出目录(再扫描时跳过,避免二次整理自己) */
export const PROTECTED_DIRS = ["_分类", "_重复文件"];
export const isProtectedDir = (name: string): boolean => PROTECTED_DIRS.includes(name);

export function categoryForExtension(name: string): FileCategory {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  for (const [cat, exts] of EXT_MAP) {
    if (exts.includes(ext)) return cat;
  }
  return "其他";
}

export type PlanItem = { from: string; toDir: string; category: FileCategory };

/** 分类规划:仅根目录下的散文件(不含目录),移动到 <dir>/<分类>/ */
export function planClassification(files: { name: string; isFile: boolean }[]): PlanItem[] {
  return files
    .filter((f) => f.isFile && !f.name.startsWith("."))
    .map((f) => ({ from: f.name, toDir: categoryForExtension(f.name), category: categoryForExtension(f.name) }))
    .filter((p) => p.toDir !== "其他" || true); // 「其他」同样收拢,保持根目录干净
}

/** 移动目标重名时追加序号:report.pdf → report(1).pdf */
export function dedupeTargetName(existing: Iterable<string>, name: string): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}(${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}
