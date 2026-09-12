import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { notes, settings, tasks } from "@/lib/db/schema";
import { GET, POST, PATCH } from "./route";
import { POST as TO_TASK } from "./[id]/to-task/route";
import { POST as TO_VAULT } from "./[id]/to-vault/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
});

type NoteRow = typeof notes.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
const insertNote = (over: Partial<typeof notes.$inferInsert> = {}): NoteRow => {
  const nowIso = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    title: "笔记",
    body: "",
    tags: "[]",
    pinned: false,
    source: "manual",
    taskId: null,
    vaultPath: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...over,
  } as typeof notes.$inferInsert;
  db.insert(notes).values(row).run();
  return row as NoteRow;
};
const getNote = (id: string): NoteRow | undefined =>
  (db.select().from(notes).all() as NoteRow[]).find((n) => n.id === id);
const getTask = (id: string): TaskRow | undefined =>
  (db.select().from(tasks).all() as TaskRow[]).find((t) => t.id === id);

// settings.vault_path 的测试替身:seed 种了真实路径,统一覆盖为临时目录 / 删除键
const setVaultPath = (value: string | null) => {
  if (value === null) {
    db.delete(settings).where(eq(settings.key, "vault_path")).run();
  } else {
    db.update(settings).set({ value: JSON.stringify(value) }).where(eq(settings.key, "vault_path")).run();
  }
};

const tmpDirs: string[] = [];
const makeVault = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-notes-vault-"));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("notes CRUD", () => {
  it("POST:201 创建;tags 过滤非字符串元素并截断 5 个;source/pinned 可选生效", async () => {
    const res = await POST(req("/api/notes", { method: "POST", body: JSON.stringify({ title: "  第一篇  ", body: "内容", tags: ["研究", 123, "事务", null, true], pinned: true }) }));
    expect(res.status).toBe(201);
    const note = (await res.json()).note as NoteRow;
    expect(note.title).toBe("第一篇");
    expect(note.body).toBe("内容");
    expect(JSON.parse(note.tags)).toEqual(["研究", "事务"]);
    expect(note.pinned).toBe(true);
    expect(note.source).toBe("manual");
    expect(note.taskId).toBeNull();
    expect(note.vaultPath).toBeNull();

    const res2 = await POST(req("/api/notes", { method: "POST", body: JSON.stringify({ title: "t2", source: "chat" }) }));
    expect(res2.status).toBe(201);
    const n2 = (await res2.json()).note as NoteRow;
    expect(n2.source).toBe("chat");
    expect(n2.pinned).toBe(false);
    expect(JSON.parse(n2.tags)).toEqual([]);

    const res3 = await POST(req("/api/notes", { method: "POST", body: JSON.stringify({ title: "t3", tags: ["a", "b", "c", "d", "e", "f", "g"] }) }));
    expect(JSON.parse(((await res3.json()).note as NoteRow).tags)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("POST:title 必填 400(缺失/空白/非字符串/非对象体)", async () => {
    expect((await POST(req("/api/notes", { method: "POST", body: JSON.stringify({ body: "x" }) }))).status).toBe(400);
    expect((await POST(req("/api/notes", { method: "POST", body: JSON.stringify({ title: "   " }) }))).status).toBe(400);
    expect((await POST(req("/api/notes", { method: "POST", body: JSON.stringify({ title: 42 }) }))).status).toBe(400);
    expect((await POST(req("/api/notes", { method: "POST", body: "not-json" }))).status).toBe(400);
  });
  it("GET:pinned 置顶,其余 updatedAt desc", async () => {
    const t0 = "2026-09-01T00:00:00.000Z";
    const t1 = "2026-09-02T00:00:00.000Z";
    const t2 = "2026-09-03T00:00:00.000Z";
    const a = insertNote({ title: "A", pinned: false, updatedAt: t2 });
    const b = insertNote({ title: "B", pinned: true, updatedAt: t0 });
    const c = insertNote({ title: "C", pinned: false, updatedAt: t1 });
    const list = (await (await GET(req("/api/notes"))).json()) as { notes: NoteRow[] };
    expect(list.notes.map((n) => n.id)).toEqual([b.id, a.id, c.id]);
  });
  it("PATCH:改 body/pinned/title/tags + updatedAt 回写;未知 id 404;无可更新字段 400;非法值 400", async () => {
    const n = insertNote({ title: "原", body: "旧", pinned: true, tags: '["旧"]' });
    const r1 = await PATCH(req("/api/notes", { method: "PATCH", body: JSON.stringify({ id: n.id, body: "新正文", pinned: false }) }));
    expect(r1.status).toBe(200);
    const updated = getNote(n.id)!;
    expect(updated.body).toBe("新正文");
    expect(updated.pinned).toBe(false);
    expect(updated.updatedAt >= updated.createdAt).toBe(true);

    const r2 = await PATCH(req("/api/notes", { method: "PATCH", body: JSON.stringify({ id: n.id, title: "新标题", tags: ["研究", 7] }) }));
    expect(r2.status).toBe(200);
    const updated2 = getNote(n.id)!;
    expect(updated2.title).toBe("新标题");
    expect(JSON.parse(updated2.tags)).toEqual(["研究"]);

    expect((await PATCH(req("/api/notes", { method: "PATCH", body: JSON.stringify({ id: "nope", body: "x" }) }))).status).toBe(404);
    expect((await PATCH(req("/api/notes", { method: "PATCH", body: JSON.stringify({ id: n.id }) }))).status).toBe(400);
    expect((await PATCH(req("/api/notes", { method: "PATCH", body: JSON.stringify({ id: n.id, title: "" }) }))).status).toBe(400);
    expect((await PATCH(req("/api/notes", { method: "PATCH", body: JSON.stringify({ id: n.id, pinned: "yes" }) }))).status).toBe(400);
    expect((await PATCH(req("/api/notes", { method: "PATCH", body: JSON.stringify({ id: n.id, tags: "不是数组" }) }))).status).toBe(400);
  });
});

describe("notes to-task", () => {
  it("201:任务落库(title/description/tags 继承,status inbox)+ notes.taskId/updatedAt 回写", async () => {
    const n = insertNote({ title: "读完结转任务", body: "要点整理", tags: '["研究","事务"]' });
    const res = await TO_TASK(req(`/api/notes/${n.id}/to-task`, { method: "POST" }), { params: Promise.resolve({ id: n.id }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { task: TaskRow & { tags: string[] }; note: NoteRow };
    expect(body.task.title).toBe("读完结转任务");
    expect(body.task.description).toBe("要点整理");
    expect(body.task.tags).toEqual(["研究", "事务"]);
    expect(body.task.status).toBe("inbox");
    expect(body.note.taskId).toBe(body.task.id);

    const dbNote = getNote(n.id)!;
    expect(dbNote.taskId).toBe(body.task.id);
    expect(dbNote.updatedAt >= dbNote.createdAt).toBe(true);
    const dbTask = getTask(body.task.id)!;
    expect(dbTask.title).toBe("读完结转任务");
    expect(JSON.parse(dbTask.tags)).toEqual(["研究", "事务"]);
  });
  it("重复转任务(已有 taskId)→ 409 该笔记已关联任务;不再创建第二个任务", async () => {
    const n = insertNote({ taskId: crypto.randomUUID() });
    const res = await TO_TASK(req(`/api/notes/${n.id}/to-task`, { method: "POST" }), { params: Promise.resolve({ id: n.id }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("该笔记已关联任务");
  });
  it("未知 id → 404", async () => {
    expect((await TO_TASK(req("/api/notes/nope/to-task", { method: "POST" }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
  });
});

describe("notes to-vault", () => {
  it("200:写入 <vault>/02_笔记/<安全文件名>.md,内容含标题/正文/标签;notes.vaultPath 回写", async () => {
    const vault = makeVault();
    setVaultPath(vault);
    const n = insertNote({ title: "设计/评审:速记", body: "今日要点", tags: '["研究","事务"]' });
    const res = await TO_VAULT(req(`/api/notes/${n.id}/to-vault`, { method: "POST" }), { params: Promise.resolve({ id: n.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { note: NoteRow; vaultPath: string };
    const expected = path.join(vault, "02_笔记", "设计_评审_速记.md");
    expect(body.vaultPath).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
    const md = fs.readFileSync(expected, "utf8");
    expect(md).toContain("# 设计/评审:速记");
    expect(md).toContain("今日要点");
    expect(md).toContain("#研究 #事务");
    expect(getNote(n.id)!.vaultPath).toBe(expected);
  });
  it("未配置 vault_path / 目录不存在 → 400 请先在设置页配置有效的 Obsidian vault 路径", async () => {
    setVaultPath(null);
    const n1 = insertNote();
    const r1 = await TO_VAULT(req(`/api/notes/${n1.id}/to-vault`, { method: "POST" }), { params: Promise.resolve({ id: n1.id }) });
    expect(r1.status).toBe(400);
    expect(((await r1.json()) as { error: string }).error).toBe("请先在设置页配置有效的 Obsidian vault 路径");

    setVaultPath("Z:/no/such/vault-qa");
    const n2 = insertNote();
    const r2 = await TO_VAULT(req(`/api/notes/${n2.id}/to-vault`, { method: "POST" }), { params: Promise.resolve({ id: n2.id }) });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { error: string }).error).toContain("请先在设置页配置");
  });
  it("vault 中已存在同名文件 → 400 且不覆盖原文件", async () => {
    const vault = makeVault();
    setVaultPath(vault);
    const a = insertNote({ title: "重复标题", body: "第一篇内容" });
    const b = insertNote({ title: "重复标题", body: "第二篇内容" });
    expect((await TO_VAULT(req(`/api/notes/${a.id}/to-vault`, { method: "POST" }), { params: Promise.resolve({ id: a.id }) })).status).toBe(200);
    const res2 = await TO_VAULT(req(`/api/notes/${b.id}/to-vault`, { method: "POST" }), { params: Promise.resolve({ id: b.id }) });
    expect(res2.status).toBe(400);
    expect(((await res2.json()) as { error: string }).error).toContain("vault 中已存在同名文件:重复标题.md");
    const md = fs.readFileSync(path.join(vault, "02_笔记", "重复标题.md"), "utf8");
    expect(md).toContain("第一篇内容");
    expect(md).not.toContain("第二篇内容");
    expect(getNote(b.id)!.vaultPath).toBeNull();
  });
  it("未知 id → 404", async () => {
    expect((await TO_VAULT(req("/api/notes/nope/to-vault", { method: "POST" }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
  });
});
