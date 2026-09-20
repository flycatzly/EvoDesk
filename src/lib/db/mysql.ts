// MySQL 运行时数据源:仅当 DATABASE_URL 以 mysql:// 开头时启用。
// 与 client.ts(SQLite 默认路径)并列;业务代码通过 dialect-gate 的 getAnyDb() 取数据源。
// 首次连接自动执行 drizzle-mysql 迁移(建库建表,IF NOT EXISTS 语义)。
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import * as schemaMysql from "./schema-mysql";

export type MysqlDb = ReturnType<typeof createMysqlDb>["db"];

let mysqlPool: mysql.Pool | null = null;
let mysqlDb: MysqlDb | null = null;
let migrated = false;

function createMysqlDb(url: string) {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 10,
    // 时区/编码:应用层统一 UTC-ISO 字符串,连接只需 utf8mb4
    charset: "utf8mb4",
  });
  const db = drizzle(pool, { schema: schemaMysql, mode: "default" });
  return { pool, db };
}

/** 获取 MySQL drizzle 实例(单例;首次连接自动跑迁移) */
export function getMysqlDb(): MysqlDb {
  if (mysqlDb) return mysqlDb;
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("mysql")) throw new Error("DATABASE_URL 未配置为 mysql:// —— 当前应使用 SQLite 数据源");
  const { pool, db } = createMysqlDb(url);
  mysqlPool = pool;
  mysqlDb = db;
  if (!migrated) {
    const migrationsFolder = path.join(process.cwd(), "drizzle-mysql");
    if (fs.existsSync(migrationsFolder)) {
      // 迁移是异步的:调用方(await getMysqlDbAsync)负责等待
      throw new Error("请使用 getMysqlDbAsync 完成首次迁移");
    }
    migrated = true;
  }
  return db;
}

/** 异步版:首次连接自动执行 MySQL 迁移(建库建表),之后等价 getMysqlDb */
export async function getMysqlDbAsync(): Promise<MysqlDb> {
  if (mysqlDb && migrated) return mysqlDb;
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("mysql")) throw new Error("DATABASE_URL 未配置为 mysql://");
  const { pool, db } = createMysqlDb(url);
  mysqlPool = pool;
  mysqlDb = db;
  const migrationsFolder = path.join(process.cwd(), "drizzle-mysql");
  if (fs.existsSync(migrationsFolder) && !migrated) {
    await migrate(db, { migrationsFolder });
    migrated = true;
  }
  return db;
}

/** 关闭 MySQL 连接池(测试/停机用) */
export async function closeMysqlPool(): Promise<void> {
  if (mysqlPool) {
    await mysqlPool.end();
    mysqlPool = null;
    mysqlDb = null;
    migrated = false;
  }
}
