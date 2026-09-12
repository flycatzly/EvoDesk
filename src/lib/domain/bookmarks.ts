// 浏览器收藏夹(Chrome / Edge):读取本地 Bookmarks JSON、导入为常用链接、导出 Netscape 书签 HTML。
// 只读浏览器数据;导入去重按 URL;仅 http(s) 链接入库。
import fs from "node:fs";
import path from "node:path";

export type BookmarkItem = { title: string; url: string; folder: string };

/** Chrome/Edge 用户数据目录的默认位置(Windows 为主,兼顾 Linux/mac) */
export function defaultBookmarkRoots(): { browser: string; userDataDir: string }[] {
  const local = process.env.LOCALAPPDATA ?? path.join(os_home(), "AppData", "Local");
  const home = os_home();
  const roots: { browser: string; userDataDir: string }[] = [
    { browser: "Chrome", userDataDir: path.join(local, "Google", "Chrome", "User Data") },
    { browser: "Edge", userDataDir: path.join(local, "Microsoft", "Edge", "User Data") },
    // 非 Windows 回退
    { browser: "Chrome", userDataDir: path.join(home, ".config", "google-chrome") },
    { browser: "Edge", userDataDir: path.join(home, ".config", "microsoft-edge") },
  ];
  return roots.filter((r) => fs.existsSync(r.userDataDir));
}

function os_home(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? "~";
}

export type BookmarkProfile = {
  browser: string;
  profileName: string;
  bookmarksPath: string;
  items: BookmarkItem[];
};

/** 扫描一个浏览器 User Data 目录下所有含 Bookmarks 的 profile(Default、Profile 1…) */
export function discoverBookmarkProfiles(browser: string, userDataDir: string): BookmarkProfile[] {
  const out: BookmarkProfile[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(userDataDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const bookmarksPath = path.join(userDataDir, e.name, "Bookmarks");
    if (!fs.existsSync(bookmarksPath)) continue;
    try {
      const items = parseBookmarksJson(fs.readFileSync(bookmarksPath, "utf-8"));
      out.push({ browser, profileName: e.name, bookmarksPath, items });
    } catch {
      // 损坏的 Bookmarks 文件跳过该 profile
    }
  }
  return out;
}

/** 解析 Chrome/Edge Bookmarks JSON:递归 roots,产出扁平列表;仅保留 http(s) */
export function parseBookmarksJson(raw: string): BookmarkItem[] {
  let data: { roots?: Record<string, unknown> };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Bookmarks 文件不是合法 JSON");
  }
  if (!data.roots || typeof data.roots !== "object") throw new Error("Bookmarks 缺少 roots 段");
  const out: BookmarkItem[] = [];
  const walk = (node: unknown, folder: string) => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; name?: string; url?: string; children?: unknown[] };
    if (n.type === "url" && typeof n.url === "string" && /^https?:\/\//.test(n.url)) {
      out.push({ title: (n.name ?? n.url).slice(0, 120), url: n.url, folder });
      return;
    }
    if (Array.isArray(n.children)) {
      const sub = folder ? `${folder}/${n.name ?? ""}` : (n.name ?? "");
      for (const c of n.children) walk(c, sub);
    }
  };
  for (const root of Object.values(data.roots)) walk(root, "");
  return out;
}

/** 导入分类规则:直接父目录名;根下直接放的书签归「收藏夹」 */
export function pickCategory(folder: string): string {
  const parts = folder.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : "收藏夹";
}

const htmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 导出为 Netscape 书签 HTML(Chrome/Edge「导入收藏夹」可直接识别) */
export function toNetscapeHtml(items: { title: string; url: string; folder: string }[]): string {
  const byFolder = new Map<string, { title: string; url: string }[]>();
  for (const it of items) {
    const key = pickCategory(it.folder);
    const list = byFolder.get(key) ?? [];
    list.push({ title: it.title, url: it.url });
    byFolder.set(key, list);
  }
  const lines: string[] = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>EvoDesk 常用链接</TITLE>",
    "<H1>EvoDesk 常用链接</H1>",
    "<DL><p>",
  ];
  for (const [folder, list] of byFolder) {
    lines.push(`    <DT><H3>${htmlEscape(folder)}</H3>`);
    lines.push("    <DL><p>");
    for (const it of list) {
      lines.push(`        <DT><A HREF="${htmlEscape(it.url)}">${htmlEscape(it.title)}</A>`);
    }
    lines.push("    </DL><p>");
  }
  lines.push("</DL><p>");
  return lines.join("\n");
}
