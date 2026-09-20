// 方言代理:让同一份业务代码在 SQLite(同步)与 MySQL(异步)下都能工作。
//
// 原理:Drizzle 的所有 query builder 都是 QueryPromise(then-able)。本模块把
// 「取数据源 → 执行查询 → await」统一封装成 rpc 风格帮助函数,业务代码只调用:
//   await q.all<T>(db.select().from(tasks).where(...))   // 行数组(T 由调用方标注)
//   await q.one<T>(db.select().from(tasks).where(...))   // 单行或 undefined
//   await q.run(db.insert(tasks).values(...))             // 写入,返回 { changes }
// SQLite 下这些 await 立即完成(同步驱动),性能无损;MySQL 下走 mysql2 池。

type AnyQuery = Promise<unknown> & { execute?: () => unknown; all?: () => unknown; run?: () => unknown };

async function exec<T>(query: AnyQuery): Promise<T> {
  return query as Promise<T>;
}

export const q = {
  /** 行数组(select)。T 由调用方标注(与 drizzle 行类型一致) */
  async all<T>(query: AnyQuery): Promise<T[]> {
    const r = await exec<unknown>(query);
    // mysql execute 返回 [rows, fields];sqlite then 返回行数组
    if (Array.isArray(r)) return r as T[];
    if (Array.isArray((r as { 0?: unknown })?.[0])) return (r as unknown as [T[], unknown])[0];
    return (r as T[]) ?? [];
  },
  /** 单行(select … limit 1 / where 主键) */
  async one<T>(query: AnyQuery): Promise<T | undefined> {
    const r = await exec<unknown>(query);
    if (Array.isArray(r)) return (r as T[])[0];
    if (r && typeof r === "object" && Array.isArray((r as { 0?: unknown })?.[0])) {
      const rows = (r as unknown as [T[], unknown])[0];
      return rows[0];
    }
    return (r as T) ?? undefined;
  },
  /** 写入(insert/update/delete)。changes 跨方言统一:sqlite 取 .changes,mysql 取 affectedRows */
  async run(query: AnyQuery): Promise<{ changes: number }> {
    const r = (await exec<unknown>(query)) as { changes?: number; rowsAffected?: number } | [unknown, unknown];
    if (Array.isArray(r)) {
      const first = r[0] as { affectedRows?: number } | undefined;
      return { changes: first?.affectedRows ?? 0 };
    }
    return { changes: (r as { changes?: number })?.changes ?? (r as { rowsAffected?: number })?.rowsAffected ?? 0 };
  },
};
