// 数据备份:JSON 全量导出/导入(默认剥离密钥,双方言可用)+ better-sqlite3 backup API 快照/恢复(仅 SQLite)。
// 安全边界:导入前强制校验(zod + 白名单表),恢复前强制快照,快照文件名只允许安全字符。
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Pool as MysqlPool } from "mysql2/promise";
import type { Db } from "@/lib/db/test-util";
import { openDb, dbDialect } from "@/lib/db/client";

/** MySQL 模式下不支持文件级快照/恢复时抛出;路由层映射为 501 */
export class SnapshotUnsupportedError extends Error {}

export const EXPORT_TABLES = [
  "tasks", "projects", "notes", "chats", "chat_messages", "links", "goals", "canvases",
  "recurring_rules", "quick_actions", "quick_action_runs", "flow_templates", "flow_runs",
  "step_runs", "evolution_events", "executors", "provider_profiles", "settings",
] as const;

// 密钥列:默认导出时置空串(导入端语义 = 未配置,需重新填写;UI 明示)
const SECRET_COLS: Record<string, string[]> = {
  provider_profiles: ["api_key_ref"],
  executors: ["api_key_ref"],
};

export type BackupFile = {
  version: 1;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
};

type RawClient = Database.Database;
const clientOf = (db: Db): RawClient => (db as unknown as { $client: RawClient }).$client;

export function backupDir(): string {
  return path.join(process.cwd(), "data", "backups");
}

const sqliteClientOf = (db: Db): RawClient => (db as unknown as { $client: RawClient }).$client;
const mysqlPoolOf = (db: Db): MysqlPool => (db as unknown as { $client: MysqlPool }).$client;

/** 原生 SELECT *(snake_case 列名,双方言同形,保证备份文件格式跨库一致) */
async function rawSelectAll(db: Db, table: string): Promise<Record<string, unknown>[]> {
  if (dbDialect() === "mysql") {
    const [rows] = await mysqlPoolOf(db).query(`SELECT * FROM \`${table}\``);
    return rows as Record<string, unknown>[];
  }
  return sqliteClientOf(db).prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
}

export async function exportData(db: Db, opts: { includeSecrets?: boolean } = {}): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};
  for (const t of EXPORT_TABLES) {
    const rows = await rawSelectAll(db, t);
    const secrets = opts.includeSecrets ? [] : (SECRET_COLS[t] ?? []);
    tables[t] = secrets.length === 0 ? rows : rows.map((r) => {
      const copy = { ...r };
      for (const c of secrets) copy[c] = "";
      return copy;
    });
  }
  return { version: 1, exported_at: new Date().toISOString(), tables };
}

const backupSchema = z.object({
  version: z.literal(1),
  exported_at: z.string(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

/** 校验并解析备份文件;任何不合法都抛错(消息含原因),绝不部分导入 */
export function parseBackup(raw: string): BackupFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("备份文件不是合法 JSON");
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue && issue.path.includes("version")) throw new Error("备份版本不支持(需要 version=1)");
    if (issue && issue.path.includes("tables")) throw new Error("备份缺少 tables 数据段");
    throw new Error(`备份结构非法:${issue?.message ?? "未知错误"}`);
  }
  const unknown = Object.keys(parsed.data.tables).filter((t) => !(EXPORT_TABLES as readonly string[]).includes(t));
  if (unknown.length > 0) throw new Error(`备份包含未知表:${unknown.join("、")}`);
  return parsed.data;
}

/** 全量替换导入:单事务逐表 delete+insert(列取交集,行值做布尔→0/1 收敛);任一失败整体回滚 */
export async function importData(db: Db, file: BackupFile): Promise<{ perTable: Record<string, number> }> {
  if (dbDialect() === "mysql") return importDataMysql(db, file);
  const client = clientOf(db);
  const perTable: Record<string, number> = {};
  // drizzle 的 transaction 立即执行:回调内任一步抛错即整体回滚
  db.transaction(() => {
    for (const t of EXPORT_TABLES) {
      const rows = file.tables[t];
      if (!rows) continue;
      const cols = (client.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      client.prepare(`DELETE FROM ${t}`).run();
      const usable = cols.filter((c) => rows.every((r) => !(c in r) || r[c] === undefined || typeof r[c] !== "object"));
      const insert = client.prepare(
        `INSERT INTO ${t} (${usable.join(",")}) VALUES (${usable.map((c) => `@${c}`).join(",")})`,
      );
      for (const raw of rows) {
        const row: Record<string, unknown> = {};
        for (const c of usable) {
          const v = raw[c];
          row[c] = typeof v === "boolean" ? (v ? 1 : 0) : (v ?? null);
        }
        insert.run(row);
      }
      perTable[t] = rows.length;
    }
  });
  return { perTable };
}

/** MySQL 分支:专用连接 + 手动事务;SHOW COLUMNS 取列交集,? 占位批量插入 */
async function importDataMysql(db: Db, file: BackupFile): Promise<{ perTable: Record<string, number> }> {
  const pool = mysqlPoolOf(db);
  const conn = await pool.getConnection();
  const perTable: Record<string, number> = {};
  try {
    await conn.beginTransaction();
    for (const t of EXPORT_TABLES) {
      const rows = file.tables[t];
      if (!rows) continue;
      const [colRows] = await conn.query(`SHOW COLUMNS FROM \`${t}\``);
      const cols = (colRows as { Field: string }[]).map((c) => c.Field);
      await conn.query(`DELETE FROM \`${t}\``);
      const usable = cols.filter((c) => rows.every((r) => !(c in r) || r[c] === undefined || typeof r[c] !== "object"));
      if (usable.length === 0) { perTable[t] = rows.length; continue; }
      const sql = `INSERT INTO \`${t}\` (${usable.map((c) => `\`${c}\``).join(",")}) VALUES (${usable.map(() => "?").join(",")})`;
      for (const raw of rows) {
        const values = usable.map((c) => {
          const v = raw[c];
          return typeof v === "boolean" ? (v ? 1 : 0) : (v ?? null);
        });
        await conn.query(sql, values);
      }
      perTable[t] = rows.length;
    }
    await conn.commit();
    return { perTable };
  } catch (err) {
    try { await conn.rollback(); } catch { /* 连接已坏时回滚失败可忽略,原数据由事务保证 */ }
    throw err;
  } finally {
    conn.release();
  }
}

/** 快照:better-sqlite3 backup API 写 .db 文件;返回文件名。内存库同样可备份。MySQL 模式不支持(抛 SnapshotUnsupportedError)。 */
export async function createSnapshot(db: Db, dir: string = backupDir(), prefix = "evodesk"): Promise<string> {
  if (dbDialect() === "mysql") {
    throw new SnapshotUnsupportedError("MySQL 模式不支持文件级快照;请使用 JSON 导出/导入备份数据");
  }
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const name0 = `${prefix}-${stamp}.db`;
  const dest0 = path.join(dir, name0);
  // 同一秒内多次快照:加随机后缀避免互相覆盖
  const dest = fs.existsSync(dest0) ? path.join(dir, `${prefix}-${stamp}-${Math.random().toString(16).slice(2, 6)}.db`) : dest0;
  const name = path.basename(dest);
  await clientOf(db).backup(dest);
  return name;
}

/** 从快照恢复:关当前连接 → 覆盖库文件 → 重开并刷新单例;调用方需提示用户"数据已恢复"。MySQL 模式不支持。 */
export function restoreSnapshotFile(db: Db, snapshotPath: string): void {
  if (dbDialect() === "mysql") {
    throw new SnapshotUnsupportedError("MySQL 模式不支持文件级恢复;请使用 JSON 导出/导入迁移数据");
  }
  const client = clientOf(db);
  const target = client.name;
  if (target === ":memory:") throw new Error("内存数据库不支持文件恢复(测试环境请使用文件库)");
  client.close();
  try {
    fs.copyFileSync(snapshotPath, target);
  } finally {
    openDb(target); // 重开并接管单例缓存
  }
}

export function listSnapshots(dir: string = backupDir()): { name: string; sizeBytes: number; ts: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, sizeBytes: st.size, ts: st.mtime.toISOString() };
    })
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

/** 只保留最近 keep 份快照(按修改时间) */
export function cleanSnapshots(keep = 20, dir: string = backupDir()): void {
  const list = listSnapshots(dir);
  for (const s of list.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, s.name));
    } catch {
      // 单个清理失败不阻断其余
    }
  }
}

/** 恢复入口的文件名白名单:只允许目录内的 .db 文件,拒绝任何路径穿越 */
export function resolveSnapshotName(name: string, dir: string = backupDir()): string {
  if (!/^[a-zA-Z0-9._-]+\.db$/.test(name)) throw new Error("非法快照文件名");
  const full = path.join(dir, name);
  if (path.dirname(full) !== path.resolve(dir)) throw new Error("非法快照路径");
  if (!fs.existsSync(full)) throw new Error("快照不存在");
  return full;
}
