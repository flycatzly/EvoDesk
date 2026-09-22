import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import type { Db as SqliteDb } from "./test-util";
import { seedIfEmpty } from "./seed";

// ---------- 类型:双方言 union ----------
// SQLite 驱动是同步的(.all()/.run() 返回行/结果),MySQL 驱动是 then-able(需 await)。
// 统一用法:所有查询/写入一律 `await`(SQLite 下 await 同步结果无损,语义不变)。
export type SqliteDbKind = SqliteDb;
export type Db = SqliteDb;
export type { SqliteDb };

export type Dialect = "sqlite" | "mysql";

/** 当前数据源方言(由 DATABASE_URL 前缀决定;默认 sqlite) */
export function dbDialect(): Dialect {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("mysql") ? "mysql" : "sqlite";
}

let instance: SqliteDb | null = null;

type DbGlobal = { __evodeskDb?: SqliteDb | null };

function currentDb(): SqliteDb | null {
  if (process.env.NODE_ENV !== "production") {
    // dev:模块会被 Turbopack 重新执行,globalThis 缓存跨重编译存活,避免泄漏 sqlite 句柄
    return (globalThis as DbGlobal).__evodeskDb ?? instance;
  }
  return instance;
}

function cacheDb(db: SqliteDb | null) {
  instance = db;
  if (process.env.NODE_ENV !== "production") {
    (globalThis as DbGlobal).__evodeskDb = db;
  }
}

export function getDb(): SqliteDb {
  // MySQL 模式下 getDb 属于未适配调用点:与其静默读写本地 SQLite 造成双库数据分叉,
  // 不如响亮报错引导走 getAnyDb()(方言网关)。SQLite 默认路径不受影响。
  if (dbDialect() === "mysql") {
    throw new Error("当前为 MySQL 数据源,此处应使用 getAnyDb() 方言网关(getDb 仅限 SQLite 路径)");
  }
  const cached = currentDb();
  if (cached) return cached;
  const file = process.env.EVODESK_DB ?? path.join(process.cwd(), "data", "evodesk.db");
  return openDb(file);
}

export function openDb(file: string): SqliteDb {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzleSqlite(sqlite);
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (fs.existsSync(migrationsFolder)) {
    try {
      // 迁移成功后才写缓存:migrate 抛错时单例保持为空,下次 getDb 重试而不是拿到未迁移的库
      migrateSqlite(db, { migrationsFolder });
    } catch (err) {
      sqlite.close(); // 失败即关句柄,避免重试场景下泄漏连接
      throw err;
    }
  }
  // 迁移成功后补种示例数据(幂等,仅空库生效);种子失败只警告不阻断,空库仍可正常使用
  try {
    seedIfEmpty(db);
  } catch (err) {
    console.warn("[db] 种子数据写入失败,跳过:", err);
  }
  cacheDb(db);
  return db;
}

export function __setDbForTests(db: SqliteDb | null) {
  // 测试注入必须同时覆盖两个缓存,任何模式下 getDb 都返回注入库
  instance = db;
  (globalThis as DbGlobal).__evodeskDb = db;
}
