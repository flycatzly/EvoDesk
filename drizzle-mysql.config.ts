import { defineConfig } from "drizzle-kit";

// MySQL 方言迁移配置:src/lib/db/schema-mysql.ts → drizzle-mysql/
// 生成:npm run db:generate:mysql(提交前检查 drizzle-mysql/*.sql)
export default defineConfig({
  dialect: "mysql",
  schema: "./src/lib/db/schema-mysql.ts",
  out: "./drizzle-mysql",
});
