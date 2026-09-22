import { describe, it, expect, afterEach } from "vitest";
import { dbDialect, getDb } from "./client";

// 数据源网关(回归:2026-09-23 完善切换数据源)
describe("dbDialect 与 getDb 网关", () => {
  const ORIGINAL = process.env.DATABASE_URL;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL;
  });

  it("未配置/非 mysql 前缀 → sqlite 方言", () => {
    delete process.env.DATABASE_URL;
    expect(dbDialect()).toBe("sqlite");
    process.env.DATABASE_URL = "postgresql://x/y";
    expect(dbDialect()).toBe("sqlite");
  });
  it("mysql:// 前缀 → mysql 方言;且 getDb 响亮报错引导走方言网关", () => {
    process.env.DATABASE_URL = "mysql://user:pass@127.0.0.1:3306/evodesk";
    expect(dbDialect()).toBe("mysql");
    expect(() => getDb()).toThrow(/getAnyDb/);
  });
});
