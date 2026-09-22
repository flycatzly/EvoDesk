import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema";
import * as mysqlSchema from "@/lib/db/schema-mysql";

/** 数据源切换完整性(SQLite ⇄ MySQL):
 *  双 schema 的表名/列名必须一一对应,否则迁移工具(migrate-from-sqlite)会丢表丢列。
 *  本测试在任何一端加表/加列而忘记同步另一端时失败。 */

const isTable = (v: unknown): v is object =>
  typeof v === "object" && v !== null && Object.getOwnPropertySymbols(v as object).some((s) => (s.description ?? "").startsWith("drizzle:"));

/** drizzle 表对象的真实表名(存于 Symbol(drizzle:BaseName/TableName)) */
function tableNameOf(table: object): string {
  const sym = Object.getOwnPropertySymbols(table).find(
    (s) => s.description === "drizzle:BaseName" || s.description === "drizzle:TableName",
  );
  return sym ? String((table as Record<symbol, string>)[sym]) : "";
}

describe("双 schema 奇偶校验(SQLite ⇄ MySQL)", () => {
  const sqliteTables = Object.entries(sqliteSchema).filter(([, v]) => isTable(v)) as [string, object][];
  const mysqlByName = new Map<string, object>();
  for (const [, v] of Object.entries(mysqlSchema).filter(([, v]) => isTable(v))) {
    const name = tableNameOf(v);
    if (name) mysqlByName.set(name, v);
  }

  it("两端都有表可枚举(自检)", () => {
    expect(sqliteTables.length).toBeGreaterThan(15);
    expect(mysqlByName.size).toBeGreaterThan(15);
  });

  it("sqlite 每张表在 mysql schema 都有同名表且列名集合一致", () => {
    const missing: string[] = [];
    const drift: string[] = [];
    for (const [, table] of sqliteTables) {
      const name = tableNameOf(table);
      const mTable = mysqlByName.get(name);
      if (!mTable) {
        missing.push(name);
        continue;
      }
      const sCols = Object.keys(getTableColumns(table as never)).sort();
      const mCols = Object.keys(getTableColumns(mTable as never)).sort();
      const onlySqlite = sCols.filter((c) => !mCols.includes(c));
      const onlyMysql = mCols.filter((c) => !sCols.includes(c));
      if (onlySqlite.length || onlyMysql.length) {
        drift.push(`${name}: 仅SQLite=[${onlySqlite.join(",")}] 仅MySQL=[${onlyMysql.join(",")}]`);
      }
    }
    expect(missing, "mysql schema 缺少同名表").toEqual([]);
    expect(drift, "列集合漂移").toEqual([]);
  });
});
