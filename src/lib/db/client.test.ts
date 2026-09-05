import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { createTestDb } from "./test-util";
import { getDb, __setDbForTests } from "./client";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

// 透传 spy:默认行为与真实 migrate 完全一致,仅用于模拟迁移失败与计数
vi.mock("drizzle-orm/better-sqlite3/migrator", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("drizzle-orm/better-sqlite3/migrator")
  >();
  return { ...actual, migrate: vi.fn(actual.migrate) };
});

describe("db client", () => {
  it("createTestDb 迁移成功且可执行 SQL", () => {
    const db = createTestDb();
    const rows = db.all("select 1 as x") as { x: number }[];
    expect(rows[0].x).toBe(1);
    // 迁移必须真正生效:sqlite_master 里能看到真实的业务表
    const tables = db.all(
      "select name from sqlite_master where type='table' and name='tasks'",
    ) as { name: string }[];
    expect(tables).toHaveLength(1);
  });
  it("getDb 返回被注入的测试库", () => {
    const db = createTestDb();
    __setDbForTests(db);
    expect(getDb()).toBe(db);
    __setDbForTests(null);
  });
  it("__setDbForTests 同时写入模块单例与 dev 热重载缓存", () => {
    const db = createTestDb();
    const g = globalThis as { __evodeskDb?: unknown };
    __setDbForTests(db);
    expect(g.__evodeskDb).toBe(db);
    expect(getDb()).toBe(db);
    __setDbForTests(null);
    expect(g.__evodeskDb).toBeNull();
  });
  it("生产模式下 getDb 读取模块级单例(而非 dev 热重载缓存)", () => {
    const db = createTestDb();
    vi.stubEnv("NODE_ENV", "production");
    try {
      __setDbForTests(db);
      // 干扰项:往 dev 缓存塞一个不同的库,生产路径必须无视它
      const g = globalThis as { __evodeskDb?: unknown };
      g.__evodeskDb = createTestDb();
      const devCacheDb = g.__evodeskDb;
      expect(getDb()).toBe(db);
      expect(getDb()).not.toBe(devCacheDb);
    } finally {
      vi.unstubAllEnvs();
      __setDbForTests(null);
    }
  });
  it("migrate 失败不污染单例:关闭句柄,下次 getDb 会重试", () => {
    __setDbForTests(null);
    vi.mocked(migrate).mockClear(); // 自包含:不依赖 vitest 的 clearMocks 默认值
    vi.stubEnv("EVODESK_DB", ":memory:");
    const closeSpy = vi.spyOn(Database.prototype, "close");
    try {
      vi.mocked(migrate).mockImplementationOnce(() => {
        throw new Error("simulated migrate failure");
      });
      expect(() => getDb()).toThrow("simulated migrate failure");
      expect(migrate).toHaveBeenCalledTimes(1);
      expect(closeSpy).toHaveBeenCalledTimes(1); // 失败路径必须关闭 sqlite 句柄
      // 单例未被污染:第二次调用重新走 openDb + migrate,而不是返回未迁移的库
      const db = getDb();
      expect(migrate).toHaveBeenCalledTimes(2);
      const tables = db.all(
        "select name from sqlite_master where type='table' and name='projects'",
      ) as { name: string }[];
      expect(tables).toHaveLength(1);
      expect(closeSpy).toHaveBeenCalledTimes(1); // 成功路径不关闭
    } finally {
      closeSpy.mockRestore();
      vi.unstubAllEnvs();
      __setDbForTests(null);
    }
  });
});
