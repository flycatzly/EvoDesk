// SQLite → MySQL 一次性数据迁移:逐表读 SQLite 全量 → 批量插入 MySQL。
// 顺序按 schema 依赖;可选先清空目标表;行数对比报告。仅 MySQL 模式可用。
import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import fs from "node:fs";
import { dbDialect } from "@/lib/db/client";
import { getMysqlDbAsync } from "@/lib/db/mysql";
import { q } from "@/lib/db/q";
import * as schemaSqlite from "@/lib/db/schema";
import * as schemaMysql from "@/lib/db/schema-mysql";
import { getTableColumns } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 外键依赖序:独立表在前,引用表在后(settings/issues/memories 无依赖)
const TABLE_ORDER: { name: string; sqlite: keyof typeof schemaSqlite; mysql: keyof typeof schemaMysql }[] = [
  { name: "projects", sqlite: "projects", mysql: "projects" },
  { name: "flow_templates", sqlite: "flowTemplates", mysql: "flowTemplates" },
  { name: "executors", sqlite: "executors", mysql: "executors" },
  { name: "provider_profiles", sqlite: "providerProfiles", mysql: "providerProfiles" },
  { name: "settings", sqlite: "settings", mysql: "settings" },
  { name: "recurring_rules", sqlite: "recurringRules", mysql: "recurringRules" },
  { name: "notes", sqlite: "notes", mysql: "notes" },
  { name: "links", sqlite: "links", mysql: "links" },
  { name: "goals", sqlite: "goals", mysql: "goals" },
  { name: "canvases", sqlite: "canvases", mysql: "canvases" },
  { name: "quick_actions", sqlite: "quickActions", mysql: "quickActions" },
  { name: "memories", sqlite: "memories", mysql: "memories" },
  { name: "tasks", sqlite: "tasks", mysql: "tasks" },
  { name: "chats", sqlite: "chats", mysql: "chats" },
  { name: "jobs", sqlite: "jobs", mysql: "jobs" },
  { name: "flow_runs", sqlite: "flowRuns", mysql: "flowRuns" },
  { name: "step_runs", sqlite: "stepRuns", mysql: "stepRuns" },
  { name: "chat_messages", sqlite: "chatMessages", mysql: "chatMessages" },
  { name: "quick_action_runs", sqlite: "quickActionRuns", mysql: "quickActionRuns" },
  { name: "evolution_events", sqlite: "evolutionEvents", mysql: "evolutionEvents" },
  { name: "jobs_runs", sqlite: "jobsRuns", mysql: "jobsRuns" },
  { name: "issues", sqlite: "issues", mysql: "issues" },
];

/** SQLite boolean 存 0/1,MySQL boolean 列也要 0/1(驱动自动处理 boolean 类型);行值直传。 */
export async function POST(req: NextRequest) {
  if (dbDialect() !== "mysql") {
    return NextResponse.json({ error: "当前是 SQLite 模式:设置 DATABASE_URL=mysql://… 并重启后再执行迁移" }, { status: 400 });
  }
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const sqlitePath = body && typeof body.sqlitePath === "string" ? body.sqlitePath.trim() : "";
  const truncate = body?.truncate === true;
  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    return NextResponse.json({ error: "sqlitePath 无效(本地 SQLite 文件路径)" }, { status: 400 });
  }

  const mysql = await getMysqlDbAsync();

  // 打开源 SQLite(只读)
  let src: Database.Database;
  try {
    src = new Database(sqlitePath, { readonly: true });
  } catch (e) {
    return NextResponse.json({ error: `无法打开源文件:${e instanceof Error ? e.message : e}` }, { status: 400 });
  }

  const report: { table: string; source: number; imported: number }[] = [];
  const errors: string[] = [];
  try {
    for (const t of TABLE_ORDER) {
      const mTable = (schemaMysql as unknown as Record<string, unknown>)[t.mysql] as never;
      if (!mTable) { errors.push(`${t.name}: schema 缺失,跳过`); continue; }

      // 读源
      let rows: Record<string, unknown>[] = [];
      try {
        rows = src.prepare(`SELECT * FROM ${t.name}`).all() as Record<string, unknown>[];
      } catch (e) {
        errors.push(`${t.name}: 源读取失败(${e instanceof Error ? e.message.slice(0, 60) : e})`);
        continue;
      }
      const sourceCount = rows.length;

      // 清空目标(可选)
      if (truncate) {
        try { await q.run(mysql.delete(mTable)); } catch { /* 空表删除报错可忽略 */ }
      }

      // sqlite 行的列名是 snake_case;mysql schema 对象键是 camelCase
      // 映射:遍历 mysql schema 列定义取列名
      const colDefs = getTableColumns(mTable) as Record<string, { name: string }>;
      let imported = 0;
      for (const row of rows) {
        try {
          const values: Record<string, unknown> = {};
          for (const [key, def] of Object.entries(colDefs)) {
            const colName = (def as { name: string }).name;
            if (colName && row[colName] !== undefined) values[key] = row[colName];
          }
          if (Object.keys(values).length === 0) continue;
          await q.run(mysql.insert(mTable).values(values));
          imported++;
        } catch (e) {
          errors.push(`${t.name}: 行写入失败(${e instanceof Error ? e.message.slice(0, 60) : e})`);
        }
      }
      report.push({ table: t.name, source: sourceCount, imported });
    }
  } finally {
    src.close();
  }

  return NextResponse.json({ ok: true, report, errors: errors.slice(0, 20) });
}
