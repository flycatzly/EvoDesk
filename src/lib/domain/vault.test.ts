import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { resolveVaultPath, listTree, readNoteFile, writeNoteFile, searchNotes, getVaultRoot } from "./vault";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { settings } from "@/lib/db/schema";

let vault: string;
const tmpDirs: string[] = [];
beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-vault-domain-"));
  tmpDirs.push(vault);
});
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("resolveVaultPath", () => {
  it("合法相对路径解析为 vault 内绝对路径;空串=根", () => {
    expect(resolveVaultPath(vault, "a/b.md")).toBe(path.resolve(vault, "a/b.md"));
    expect(resolveVaultPath(vault, "")).toBe(path.resolve(vault));
  });
  it(".. 穿越 → 抛路径越界", () => {
    expect(() => resolveVaultPath(vault, "../escape.md")).toThrow(/路径越界/);
    expect(() => resolveVaultPath(vault, "sub/../../escape.md")).toThrow(/路径越界/);
  });
  it("绝对路径(vault 外)→ 抛路径越界", () => {
    expect(() => resolveVaultPath(vault, path.join(os.tmpdir(), "outside-vault-target"))).toThrow(/路径越界/);
  });
});

describe("listTree", () => {
  it("dir 前,同类型按名称排序;md/file 类型标注正确", () => {
    fs.mkdirSync(path.join(vault, "02_笔记"));
    fs.writeFileSync(path.join(vault, "readme.md"), "# r", "utf8");
    fs.writeFileSync(path.join(vault, "data.json"), "{}", "utf8");
    fs.writeFileSync(path.join(vault, "a.md"), "x", "utf8");
    const entries = listTree(vault, "");
    expect(entries.map((e) => e.name)).toEqual(["02_笔记", "a.md", "readme.md", "data.json"]);
    expect(entries.map((e) => e.type)).toEqual(["dir", "md", "md", "file"]);
  });
  it("目录不存在 / 指向文件 → 空数组", () => {
    expect(listTree(vault, "no-such-dir")).toEqual([]);
    fs.writeFileSync(path.join(vault, "f.md"), "x", "utf8");
    expect(listTree(vault, "f.md")).toEqual([]);
  });
});

describe("readNoteFile", () => {
  it("往返:写入后读回原内容", () => {
    fs.mkdirSync(path.join(vault, "sub"));
    fs.writeFileSync(path.join(vault, "sub", "n.md"), "正文内容", "utf8");
    expect(readNoteFile(vault, "sub/n.md")).toBe("正文内容");
  });
  it("不存在 → 抛文件不存在", () => {
    expect(() => readNoteFile(vault, "ghost.md")).toThrow(/文件不存在/);
  });
  it("非在线可读扩展(如 myBase 的 nyf)→ 抛仅支持文本类文件", () => {
    fs.writeFileSync(path.join(vault, "database.nyf"), "binary-ish", "utf8");
    expect(() => readNoteFile(vault, "database.nyf")).toThrow(/仅支持文本类文件/);
  });
  it("超过 1MB → 抛文件超过 1MB(真实写 1MB 文件,非秒级)", () => {
    fs.writeFileSync(path.join(vault, "big.md"), "a".repeat(1_048_577), "utf8");
    expect(() => readNoteFile(vault, "big.md")).toThrow(/1MB/);
  });
  it(".. 穿越 → 抛路径越界(白名单先于扩展检查)", () => {
    expect(() => readNoteFile(vault, "../evil.md")).toThrow(/路径越界/);
  });
});

describe("writeNoteFile", () => {
  it("新建含子目录(递归创建)+ 覆盖写", () => {
    writeNoteFile(vault, "sub/dir/new.md", "第一版");
    expect(fs.readFileSync(path.join(vault, "sub", "dir", "new.md"), "utf8")).toBe("第一版");
    writeNoteFile(vault, "sub/dir/new.md", "第二版");
    expect(fs.readFileSync(path.join(vault, "sub", "dir", "new.md"), "utf8")).toBe("第二版");
  });
  it("非 md/txt 扩展 → 抛仅支持写入 md/txt 文件", () => {
    expect(() => writeNoteFile(vault, "x.json", "{}")).toThrow(/仅支持写入 md\/txt/);
  });
  it("内容超过 1MB → 抛内容超过 1MB 上限", () => {
    expect(() => writeNoteFile(vault, "big.md", "a".repeat(1_048_577))).toThrow(/1MB/);
  });
  it(".. 穿越 → 抛路径越界,不落盘", () => {
    expect(() => writeNoteFile(vault, "../evil.md", "x")).toThrow(/路径越界/);
    expect(fs.existsSync(path.resolve(vault, "../evil.md"))).toBe(false);
  });
});

describe("searchNotes", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(vault, "02_笔记"));
    fs.writeFileSync(path.join(vault, "02_笔记", "a.md"), "前面铺垫词进化引擎后续内容", "utf8");
    fs.writeFileSync(path.join(vault, "b.md"), "这里也有进化引擎的记录", "utf8");
    fs.writeFileSync(path.join(vault, "c.md"), "毫无相关", "utf8");
  });
  it("命中返回 POSIX 风格相对路径 + 带 30/50 上下文的 snippet", () => {
    const hits = searchNotes(vault, "进化引擎");
    expect(hits.map((h) => h.path)).toEqual(["02_笔记/a.md", "b.md"]);
    expect(hits[0].snippet).toContain("进化引擎");
    expect(hits[0].snippet.length).toBeLessThanOrEqual("进化引擎".length + 30 + 50);
  });
  it("空查询 → 不命中(q 空直接返回空)", () => {
    expect(searchNotes(vault, "")).toEqual([]);
  });
  it("limit 截断命中数", () => {
    expect(searchNotes(vault, "进化引擎", 1)).toHaveLength(1);
  });
});

describe("getVaultRoot", () => {
  it("读取 settings.vault_path(JSON 字符串)", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    db.update(settings).set({ value: JSON.stringify("D:/work/vault") }).where(eq(settings.key, "vault_path")).run();
    expect(getVaultRoot(db)).toBe("D:/work/vault");
  });
  it("键缺失 / 损坏 JSON / 空白串 / 非字符串 → null(视为未配置)", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    db.delete(settings).where(eq(settings.key, "vault_path")).run();
    expect(getVaultRoot(db)).toBeNull();
    db.insert(settings).values({ key: "vault_path", value: "{broken" }).run();
    expect(getVaultRoot(db)).toBeNull();
    db.update(settings).set({ value: '"   "' }).where(eq(settings.key, "vault_path")).run();
    expect(getVaultRoot(db)).toBeNull();
    db.update(settings).set({ value: "42" }).where(eq(settings.key, "vault_path")).run();
    expect(getVaultRoot(db)).toBeNull();
  });
});

// ---------- 资料库(多根):智能分类 / 索引 / 备份清单 ----------
import { vaultRoots, resolveVaultRoot, categoryForFile, indexLibrary, libraryManifest, VIEWABLE_TEXT_EXTS } from "./vault";

describe("vault 多根与分类", () => {
  it("vaultRoots = 主 vault_path + vault_roots 数组(去重保序);resolveVaultRoot 白名单校验", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    const upsert = (key: string, value: string) => {
      const r = db.update(settings).set({ value }).where(eq(settings.key, key)).run();
      if (r.changes === 0) db.insert(settings).values({ key, value }).run();
    };
    upsert("vault_path", JSON.stringify("D:\docs\obsidian"));
    upsert("vault_roots", JSON.stringify(["E:\apifox-export", "D:\docs\obsidian", "D:\data\myBase"]));
    expect(vaultRoots(db)).toEqual(["D:\docs\obsidian", "E:\apifox-export", "D:\data\myBase"]);
    expect(resolveVaultRoot(db, "E:\apifox-export")).toBe("E:\apifox-export");
    expect(resolveVaultRoot(db, "D:\elsewhere")).toBeNull();
    expect(resolveVaultRoot(db, null)).toBe("D:\docs\obsidian");
  });
  it("categoryForFile 按扩展智能分类", () => {
    expect(categoryForFile("笔记.md")).toBe("文档");
    expect(categoryForFile("截图.PNG")).toBe("图片");
    expect(categoryForFile("数据.csv")).toBe("表格数据");
    expect(categoryForFile("main.ts")).toBe("代码");
    expect(categoryForFile("config.yaml")).toBe("数据配置");
    expect(categoryForFile("归档.zip")).toBe("压缩包");
    expect(categoryForFile("数据库.nyf")).toBe("其他");
  });
});

describe("indexLibrary / libraryManifest", () => {
  it("递归索引:分类统计正确,跳过隐藏目录,容量截断生效", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-lib-"));
    tmpDirs.push(root);
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    fs.mkdirSync(path.join(root, ".hidden"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.md"), "# hello");
    fs.writeFileSync(path.join(root, "pic.png"), "x");
    fs.writeFileSync(path.join(root, "sub", "b.json"), "{}");
    fs.writeFileSync(path.join(root, ".hidden", "c.md"), "y");
    const idx = indexLibrary(root);
    expect(idx.stats["文档"]).toBe(1);
    expect(idx.stats["图片"]).toBe(1);
    expect(idx.stats["数据配置"]).toBe(1);
    expect(idx.entries.every((e) => !e.relPath.includes(".hidden"))).toBe(true);
    const small = indexLibrary(root, { maxEntries: 2 });
    expect(small.truncated).toBe(true);
  });
  it("备份清单:文本内联、二进制只留元数据", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-manifest-"));
    tmpDirs.push(root);
    fs.writeFileSync(path.join(root, "a.md"), "# hello");
    fs.writeFileSync(path.join(root, "pic.png"), "x");
    const m = libraryManifest(root);
    expect(m.total).toBe(2);
    const md = m.files.find((f) => f.path === "a.md")!;
    expect(md.content).toBe("# hello");
    const png = m.files.find((f) => f.path === "pic.png")!;
    expect(png.content).toBeUndefined();
    expect(png.category).toBe("图片");
  });
  it("在线可读扩展覆盖代码与配置", () => {
    expect(VIEWABLE_TEXT_EXTS).toContain("json");
    expect(VIEWABLE_TEXT_EXTS).toContain("md");
    expect(VIEWABLE_TEXT_EXTS).toContain("csv");
  });
});
