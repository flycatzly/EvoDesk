import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-util";
import { getDb, __setDbForTests } from "./client";

describe("db client", () => {
  it("createTestDb 迁移成功且可执行 SQL", () => {
    const db = createTestDb();
    const rows = db.all("select 1 as x") as { x: number }[];
    expect(rows[0].x).toBe(1);
  });
  it("getDb 返回被注入的测试库", () => {
    const db = createTestDb();
    __setDbForTests(db);
    expect(getDb()).toBe(db);
    __setDbForTests(null);
  });
});
