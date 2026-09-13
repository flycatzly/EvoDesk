import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { settings, executors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { POST as CREATE } from "./create/route";
import { POST as INSTALL } from "./install/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);

let db: ReturnType<typeof createTestDb>;
const tmpDir = path.join(os.tmpdir(), `evodesk-skills-test-${Date.now()}`);

beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  fs.mkdirSync(path.join(tmpDir, "already"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "already", "SKILL.md"), "---\nname: already\ndescription: x\n---\nold");
  // 白名单指向临时目录(settings 行不存在则插入)
  const ups = db.update(settings).set({ value: JSON.stringify([tmpDir]) }).where(eq(settings.key, "skills_dirs")).run();
  if (ups.changes === 0) db.insert(settings).values({ key: "skills_dirs", value: JSON.stringify([tmpDir]) }).run();
  // 启用一个 llm 执行器供 create 使用
  db.update(executors).set({ enabled: true }).where(eq(executors.name, "快速模型")).run();
});

const SKILL = "---\nname: pdf-merge\ndescription: 合并 PDF 时使用\n---\n# 步骤";

describe("POST /api/skills/create", () => {
  it("AI 返回最终 SKILL.md:reply/final/rounds(mocked fetch)", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: `最终 SKILL.md\n\n\`\`\`markdown\n${SKILL}\n\`\`\`` } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 }, model: "m",
    }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    try {
      const res = await CREATE(req("/api/skills/create", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "我想做一个合并 PDF 的技能" }] }),
      }));
      const data = (await res.json()) as { reply: string; final: string | null; rounds: number };
      expect(res.status).toBe(200);
      expect(data.final).toContain("name: pdf-merge");
      expect(data.rounds).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("messages 非法 400;末条非 user 400", async () => {
    expect((await CREATE(req("/api/skills/create", { method: "POST", body: JSON.stringify({ messages: [] }) }))).status).toBe(400);
    expect((await CREATE(req("/api/skills/create", { method: "POST", body: JSON.stringify({ messages: [{ role: "assistant", content: "x" }] }) }))).status).toBe(400);
  });
});

describe("POST /api/skills/install", () => {
  it("写入白名单目录 <dir>/<name>/SKILL.md;已存在 409,overwrite 覆盖", async () => {
    const ok = await INSTALL(req("/api/skills/install", {
      method: "POST",
      body: JSON.stringify({ content: SKILL, dir: tmpDir }),
    }));
    expect(ok.status).toBe(200);
    const written = fs.readFileSync(path.join(tmpDir, "pdf-merge", "SKILL.md"), "utf8");
    expect(written).toContain("pdf-merge");
    const dup = await INSTALL(req("/api/skills/install", { method: "POST", body: JSON.stringify({ content: SKILL, dir: tmpDir }) }));
    expect(dup.status).toBe(409);
    const over = await INSTALL(req("/api/skills/install", { method: "POST", body: JSON.stringify({ content: SKILL, dir: tmpDir, overwrite: true }) }));
    expect(over.status).toBe(200);
  });
  it("白名单外目录 400;非法技能名 400;非 frontmatter 内容 400", async () => {
    expect((await INSTALL(req("/api/skills/install", { method: "POST", body: JSON.stringify({ content: SKILL, dir: "D:/not-whitelisted" }) }))).status).toBe(400);
    expect((await INSTALL(req("/api/skills/install", { method: "POST", body: JSON.stringify({ content: SKILL, dir: tmpDir, name: "Bad_Name" }) }))).status).toBe(400);
    expect((await INSTALL(req("/api/skills/install", { method: "POST", body: JSON.stringify({ content: "# no frontmatter", dir: tmpDir }) }))).status).toBe(400);
  });
});
