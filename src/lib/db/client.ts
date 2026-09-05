import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./test-util";

let instance: Db | null = null;

type DbGlobal = { __evodeskDb?: Db | null };

function currentDb(): Db | null {
  if (process.env.NODE_ENV !== "production") {
    // dev:模块会被 Turbopack 重新执行,globalThis 缓存跨重编译存活,避免泄漏 sqlite 句柄
    return (globalThis as DbGlobal).__evodeskDb ?? instance;
  }
  return instance;
}

function cacheDb(db: Db | null) {
  instance = db;
  if (process.env.NODE_ENV !== "production") {
    (globalThis as DbGlobal).__evodeskDb = db;
  }
}

export function getDb(): Db {
  const cached = currentDb();
  if (cached) return cached;
  const file = process.env.EVODESK_DB ?? path.join(process.cwd(), "data", "evodesk.db");
  return openDb(file);
}

export function openDb(file: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (fs.existsSync(migrationsFolder)) {
    try {
      // 迁移成功后才写缓存:migrate 抛错时单例保持为空,下次 getDb 重试而不是拿到未迁移的库
      migrate(db, { migrationsFolder });
    } catch (err) {
      sqlite.close(); // 失败即关句柄,避免重试场景下泄漏连接
      throw err;
    }
  }
  cacheDb(db);
  return db;
}

export function __setDbForTests(db: Db | null) {
  // 测试注入必须同时覆盖两个缓存,任何模式下 getDb 都返回注入库
  instance = db;
  (globalThis as DbGlobal).__evodeskDb = db;
}
