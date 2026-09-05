import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-util";

describe("test-util", () => {
  it("createTestDb 开启外键约束(与生产 openDb 一致)", () => {
    const db = createTestDb();
    const row = db.get("pragma foreign_keys") as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });
});
