import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { GET as SCAN } from "./scan/route";
import { POST as CLASSIFY } from "./classify/route";
import { POST as DEDUPE } from "./dedupe/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);

let db: ReturnType<typeof createTestDb>;
let dir: string;
const cleanup: string[] = [];

beforeEach(() => {
  db = createTestDb();
  __setDbForTests(db);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-files-"));
  cleanup.push(dir);
  const value = JSON.stringify([dir]);
  const ups = db.update(settings).set({ value }).where(eq(settings.key, "organize_dirs")).run();
  if (ups.changes === 0) db.insert(settings).values({ key: "organize_dirs", value }).run();
});
afterEach(() => {
  while (cleanup.length) fs.rmSync(cleanup.pop()!, { recursive: true, force: true });
});

describe("files scan/classify/dedupe", () => {
  it("scan:类型统计 + 同内容哈希去重分组(忽略路径/时间差异)", async () => {
    fs.writeFileSync(path.join(dir, "a.png"), "IMGDATA");
    fs.writeFileSync(path.join(dir, "b.png"), "IMGDATA"); // 同内容
    fs.writeFileSync(path.join(dir, "c.png"), "OTHER");
    fs.writeFileSync(path.join(dir, "note.md"), "# n");
    const data = (await (await SCAN(req(`/api/files/scan?dir=${encodeURIComponent(dir)}&dupes=1`))).json()) as {
      stats: Record<string, number>; duplicateGroups: { files: { relPath: string }[] }[];
    };
    expect(data.stats["图片"]).toBe(3);
    expect(data.stats["文档"]).toBe(1);
    expect(data.duplicateGroups).toHaveLength(1);
    expect(data.duplicateGroups[0].files.map((f) => f.relPath).sort()).toEqual(["a.png", "b.png"]);
  });
  it("classify 预览不动文件;apply 移动到分类子目录且重名加序号", async () => {
    fs.writeFileSync(path.join(dir, "a.png"), "1");
    fs.mkdirSync(path.join(dir, "图片"), { recursive: true });
    fs.writeFileSync(path.join(dir, "图片/a.png"), "2");
    const preview = (await (await CLASSIFY(req("/api/files/classify", { method: "POST", body: JSON.stringify({ dir }) }))).json()) as { planned: number };
    expect(preview.planned).toBe(1);
    expect(fs.existsSync(path.join(dir, "a.png"))).toBe(true); // 预览不动
    const applied = (await (await CLASSIFY(req("/api/files/classify", { method: "POST", body: JSON.stringify({ dir, apply: true }) }))).json()) as { applied: number };
    expect(applied.applied).toBe(1);
    expect(fs.existsSync(path.join(dir, "图片/a.png"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "图片/a(1).png"))).toBe(true); // 重名加序号
  });
  it("dedupe apply:保留最早修改,其余移入 _重复文件/<时间戳>/", async () => {
    fs.writeFileSync(path.join(dir, "old.txt"), "same");
    const future = new Date(Date.now() + 60_000);
    fs.writeFileSync(path.join(dir, "new.txt"), "same");
    fs.utimesSync(path.join(dir, "new.txt"), future, future);
    const apply = (await (await DEDUPE(req("/api/files/dedupe", { method: "POST", body: JSON.stringify({ dir, apply: true }) }))).json()) as { moved: number; dest: string };
    expect(apply.moved).toBe(1);
    expect(fs.existsSync(path.join(dir, "old.txt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "_重复文件", apply.dest.split("/")[1], "new.txt"))).toBe(true);
  });
  it("白名单外目录 400", async () => {
    const res = await SCAN(req("/api/files/scan?dir=D:/not-whitelisted"));
    expect(res.status).toBe(400);
  });
});
