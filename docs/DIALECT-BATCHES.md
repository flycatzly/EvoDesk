# MySQL 方言化批次执行计划(B7-B10)

> 目标:把剩余 60 个 SQLite 直连入口全部转为方言网关(`getAnyDb()` + await 模式),
> 使 `DATABASE_URL=mysql://…` 下全站可用。逐批执行、逐批回归、逐批提交。

## 转换模式(每文件统一)

1. `import { getDb } from "@/lib/db/client"` → `import { getAnyDb } from "@/lib/db/data-source"`
2. `const db = getDb()` → `const db = await getAnyDb()`(handler 已是 async)
3. 查询改造(drizzle 双方言都是 then-able):
   - `db.select()....all()` → `await db.select()...`(删 `.all()`)
   - `....all()[0]` → `(await ...)[0]`
   - `....all() as T[]` → `(await ...) as T[]`
   - `db.insert/update/delete(...).run()` → `await ...`(删 `.run()`)
   - `.changes` → `(await ...)` 结果的 `.changes`(sqlite)——统一走 `q.run()` 更稳
4. 事务:sqlite 同步回调 + `{behavior:"immediate"}`;mysql 分支 async 回调(见 runner.ts startRun 范式)
5. 原生 SQLite client(`$client.prepare`/PRAGMA)与文件级快照:保留 SQLite-only,加方言守卫(参考 backup.ts)

## 批次与文件清单

### B7 — SSR 页面层(14 文件)
`(main)/page.tsx`、`calendar/page.tsx`、`chat/page.tsx`、`executors/page.tsx`、`flows/page.tsx`、
`inbox/page.tsx`、`notes/page.tsx`、`settings/page.tsx`、`stats/page.tsx`、`tasks/page.tsx`、
`tasks/[id]/page.tsx`、`vault/page.tsx`、`share/[token]/page.tsx`、`(main)/help` 相关联
验证:`npm run dev` 后逐页打开无报错;`/api/db/dialect` 配 mysql 时整站可用。

### B8 — 内容类 API(20 文件)
`api/vault/`:tree/search/graph/roots/index/file/qa/backup/ai-organize;
`api/notes/[id]/route.ts`、`to-task`、`to-vault`、`inbound`;
`api/links/export-bookmarks`、`export-json`;`api/skills/create`、`export`、`install`、`scan`;`api/guide/route.ts`
验证:对应 API 冒烟(qa 提问、notes 增删改、链接导出)。

### B9 — 执行类 API(18 文件)
`api/jobs`(route/runs/cancel/export)、`api/quick-actions`(route/runs/[id]/confirm)、
`api/runs/[id]/cancel`、`feedback`、`steps/[n]/stream`、`api/executors/[id]/test`、
`api/provider-profiles`(import/derive)、`api/recurring-rules/tick`、`api/evolution`(events/analyze)、
`api/briefing`、`api/stats`、`api/search`、`api/clip`
注意:`stream` 路由的 SSE 循环与 `jobs` 的 spawn 回调内同步 `.run()` 需逐处改 await。

### B10 — 复杂尾款(8 文件)+ 真机验证
`api/guide/export`、`api/backup`(已双方言,核对)、`api/files/scan`(PRAGMA)、
`api/db/migrate-from-sqlite`(读侧 SQLite 是设计使然)、`api/settings`(已改)复查;
装 MySQL 8 → 建库 → `.env` 切换 → 全站冒烟 → 迁移工具实搬数据 → 回滚演练。

## 每批收尾协议(不可跳过)

```bash
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
git add -A && git commit -m "feat(db): dialect-portable batch Bx — <范围>" && git push gitee develop && git push origin develop
```

测试无需 MySQL:`getAnyDb()` 在无 `DATABASE_URL` 时回落到注入的 SQLite 测试库,
452+ 用例全绿即证明转换在语义上等价。
