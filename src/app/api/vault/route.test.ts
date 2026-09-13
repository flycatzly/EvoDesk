import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { settings } from "@/lib/db/schema";
import { GET as TREE } from "./tree/route";
import { GET as GET_FILE, PUT as PUT_FILE } from "./file/route";
import { GET as SEARCH } from "./search/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
let vault: string;
const tmpDirs: string[] = [];

// settings.vault_path 的测试替身:seed 种了真实路径,统一覆盖为临时目录 / 删除键(同 notes route.test)
const setVaultPath = (value: string | null) => {
  if (value === null) {
    db.delete(settings).where(eq(settings.key, "vault_path")).run();
  } else {
    db.update(settings).set({ value: JSON.stringify(value) }).where(eq(settings.key, "vault_path")).run();
  }
};

beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-vault-api-"));
  tmpDirs.push(vault);
  fs.mkdirSync(path.join(vault, "02_笔记"));
  fs.writeFileSync(path.join(vault, "02_笔记", "想法.md"), "关于 vault 白名单的思考", "utf8");
  fs.writeFileSync(path.join(vault, "readme.md"), "# 使用说明", "utf8");
});
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("vault 入口守卫", () => {
  it("未配置 vault_path → 400 请先在设置页配置 Obsidian vault 路径", async () => {
    setVaultPath(null);
    for (const res of [
      await TREE(req("/api/vault/tree")),
      await GET_FILE(req("/api/vault/file?path=readme.md")),
      await PUT_FILE(req("/api/vault/file", { method: "PUT", body: JSON.stringify({ path: "a.md", content: "x" }) })),
      await SEARCH(req("/api/vault/search?q=x")),
    ]) {
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("请先在设置页配置 Obsidian vault 路径");
    }
  });
  it("vault 目录不存在 → 400 vault 目录不存在,请检查设置", async () => {
    setVaultPath("Z:/no/such/vault-qa");
    const res = await TREE(req("/api/vault/tree"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("vault 目录不存在,请检查设置");
  });
});

describe("GET /api/vault/tree", () => {
  it("根列表:dir 前 + md/file 标注正确", async () => {
    setVaultPath(vault);
    const res = await TREE(req("/api/vault/tree"));
    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as { entries: { name: string; type: string }[] };
    expect(entries).toEqual([
      { name: "02_笔记", type: "dir" },
      { name: "readme.md", type: "md" },
    ]);
  });
  it("path=../x → 403 路径越界;子目录列表正常", async () => {
    setVaultPath(vault);
    const bad = await TREE(req(`/api/vault/tree?path=${encodeURIComponent("../x")}`));
    expect(bad.status).toBe(403);
    expect(((await bad.json()) as { error: string }).error).toContain("路径越界");

    const sub = await TREE(req(`/api/vault/tree?path=${encodeURIComponent("02_笔记")}`));
    expect(sub.status).toBe(200);
    expect(((await sub.json()) as { entries: { name: string; type: string }[] }).entries).toEqual([
      { name: "想法.md", type: "md" },
    ]);
  });
});

describe("GET/PUT /api/vault/file", () => {
  it("GET 往返:读取 md 内容 {path, content}", async () => {
    setVaultPath(vault);
    const res = await GET_FILE(req(`/api/vault/file?path=${encodeURIComponent("02_笔记/想法.md")}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "02_笔记/想法.md", content: "关于 vault 白名单的思考" });
  });
  it("GET 不存在 → 400;非 md → 400;.. → 403", async () => {
    setVaultPath(vault);
    const missing = await GET_FILE(req("/api/vault/file?path=ghost.md"));
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toContain("文件不存在");

    // data.json 现为在线可读文本(200);真正不可读的扩展(如 myBase 的 nyf)才 400
    fs.writeFileSync(path.join(vault, "database.nyf"), "binary", "utf8");
    const notText = await GET_FILE(req("/api/vault/file?path=database.nyf"));
    expect(notText.status).toBe(400);
    expect(((await notText.json()) as { error: string }).error).toContain("仅支持文本类文件");

    const escape = await GET_FILE(req(`/api/vault/file?path=${encodeURIComponent("../evil.md")}`));
    expect(escape.status).toBe(403);
    expect(((await escape.json()) as { error: string }).error).toContain("路径越界");
  });
  it("PUT 新建含子目录 + 覆盖写 → {ok:true};非 md → 400", async () => {
    setVaultPath(vault);
    const r1 = await PUT_FILE(req("/api/vault/file", { method: "PUT", body: JSON.stringify({ path: "03_日志/2026-09-12.md", content: "第一版" }) }));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(vault, "03_日志", "2026-09-12.md"), "utf8")).toBe("第一版");

    await PUT_FILE(req("/api/vault/file", { method: "PUT", body: JSON.stringify({ path: "03_日志/2026-09-12.md", content: "第二版" }) }));
    expect(fs.readFileSync(path.join(vault, "03_日志", "2026-09-12.md"), "utf8")).toBe("第二版");

    const bad = await PUT_FILE(req("/api/vault/file", { method: "PUT", body: JSON.stringify({ path: "x.json", content: "{}" }) }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("仅支持写入 md/txt");
  });
});

describe("GET /api/vault/search", () => {
  it("命中返回 path + snippet;空 q → 400 q 必填", async () => {
    setVaultPath(vault);
    const res = await SEARCH(req(`/api/vault/search?q=${encodeURIComponent("白名单")}`));
    expect(res.status).toBe(200);
    const { hits } = (await res.json()) as { hits: { path: string; snippet: string }[] };
    expect(hits.map((h) => h.path)).toEqual(["02_笔记/想法.md"]);
    expect(hits[0].snippet).toContain("白名单");

    const empty = await SEARCH(req("/api/vault/search?q="));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toBe("q 必填");
  });
});
