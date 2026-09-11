import { describe, it, expect } from "vitest";
import { parseProfileText, importProfilesFromDir, deriveExecutors } from "./profiles";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { providerProfiles, executors } from "@/lib/db/schema";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROFILE = JSON.stringify({
  env: {
    ANTHROPIC_AUTH_TOKEN: "sk-test-token",
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    ANTHROPIC_MODEL: "glm-5.3-flash",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3",
    ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "glm-5.3",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3-flash",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.2",
  },
  hooks: { PreToolUse: [] },
});

describe("parseProfileText", () => {
  it("提取 env/候选/档位,别名不进候选,检测失效段落", () => {
    const p = parseProfileText("My-Zhipu", PROFILE);
    expect(p.protocol).toBe("anthropic");
    expect(p.apiBase).toBe("https://api.z.ai/api/anthropic");
    expect(p.apiKeyRef).toBe("plain:sk-test-token");
    expect(p.candidates.map((c) => c.tier)).toEqual(["primary", "opus", "sonnet", "haiku"]);
    expect(p.candidates.every((c) => !c.model.includes("_NAME"))).toBe(true);
    expect(p.candidates[1]).toMatchObject({ model: "glm-5.3", alias: "glm-5.3", tier: "opus" });
    expect(p.staleSections).toContain("hooks");
  });
  it("缺 env 或缺 token 抛错", () => {
    expect(() => parseProfileText("x", "{}")).toThrow();
    expect(() => parseProfileText("x", JSON.stringify({ env: {} }))).toThrow();
  });
  it("非 anthropic 端点识别为 openai", () => {
    expect(parseProfileText("x", JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "k", ANTHROPIC_BASE_URL: "https://api.openai.com/v1" } })).protocol).toBe("openai");
  });
});

describe("importProfilesFromDir / deriveExecutors", () => {
  it("导入目录:成功+坏 JSON 跳过;同名跳过;派生创建禁用执行器", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-profiles-"));
    fs.writeFileSync(path.join(dir, "A.txt"), PROFILE);
    fs.writeFileSync(path.join(dir, "B.txt"), "{ broken");
    const r1 = importProfilesFromDir(db, dir);
    expect(r1.imported).toEqual(["A"]);
    expect(r1.skipped).toEqual([{ name: "B", reason: expect.stringContaining("JSON") }]);
    const r2 = importProfilesFromDir(db, dir);
    expect(r2.imported).toHaveLength(0);
    expect(r2.skipped[0].reason).toContain("已存在");
    const prof = (db.select().from(providerProfiles).all() as (typeof providerProfiles.$inferSelect)[])[0];
    const created = deriveExecutors(db, prof.id, [
      { tier: "opus", role: "planner" },
      { tier: "haiku", role: "triage" },
    ]);
    expect(created.length).toBe(2);
    const rows = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    const planner = rows.find((e) => e.name.includes("opus"))!;
    expect(planner.enabled).toBe(false);
    expect(planner.model).toBe("glm-5.3");
    expect(planner.role).toBe("planner");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
