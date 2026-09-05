import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./test-util";

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) return instance;
  const file = process.env.EVODESK_DB ?? path.join(process.cwd(), "data", "evodesk.db");
  return openDb(file);
}

export function openDb(file: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  instance = drizzle(sqlite);
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (fs.existsSync(migrationsFolder)) {
    migrate(instance, { migrationsFolder });
  }
  return instance;
}

export function __setDbForTests(db: Db | null) {
  instance = db;
}
