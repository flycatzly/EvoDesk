// 数据源网关:按 DATABASE_URL 统一供给任意方言的 drizzle 实例。
// SQLite(默认)→ client.ts 同步实例;mysql:// → mysql.ts 异步池。
// 业务代码约定:所有读写一律 `await q.all/one/run(builder)`(q = @/lib/db/q)。
import { getDb, dbDialect } from "@/lib/db/client";
import { getMysqlDbAsync } from "@/lib/db/mysql";

type SqliteRuntime = ReturnType<typeof getDb>;

// 泛型化:调用方以 getAnyDb<typeof tasks.$inferSelect>() 或直接按 SQLite 实例使用。
// 两个方言的 query builder 均为 QueryPromise,调用面(链式方法+await)一致;
// 这里仅在运行时选择实例,类型侧由调用方标注(约束:只用跨方言共同方法)。
export async function getAnyDb<T = SqliteRuntime>(): Promise<T> {
  if (dbDialect() === "mysql") return (await getMysqlDbAsync()) as unknown as T;
  return getDb() as unknown as T;
}

export { dbDialect };
