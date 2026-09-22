# 数据源切换指南(SQLite ⇄ MySQL)

EvoDesk 默认使用 **SQLite**(零配置,数据在 `data/evodesk.db`),可通过环境变量切换到 **MySQL**。
本文是完整的切换操作手册。

---

## 一、能力现状(先读这个)

| 能力 | SQLite(默认) | MySQL |
|---|---|---|
| 任务全流程(收件箱/分诊/执行/看板/日历/目标) | ✅ | ✅ |
| 对话台/记忆库/流程库/执行器/供应商档案 | ✅ | ✅ |
| 常用链接/笔记速记/剪藏/周期规则/统计 | ✅ | ✅ |
| 设置/随记接入/TTS 语音合成/自愈中心 | ✅ | ✅ |
| JSON 全量备份(导出/导入,跨方言通用) | ✅ | ✅ |
| SQLite 文件级快照/恢复 | ✅ | ❌ 设计不支持(用 JSON 备份代替) |
| 首次启动自动建表 + 种子数据 | ✅ | ✅(自动执行 drizzle-mysql 迁移) |
| SQLite → MySQL 数据迁移工具 | — | ✅(设置页卡片) |

> 说明:知识库文件类操作(读写 md 文件)本就不依赖数据库,两种模式下行为一致;
> 极少数未适配 MySQL 的旧入口在被访问时会**明确报错**提示"应使用 getAnyDb()",不会静默写坏数据。

---

## 二、全新部署直接用 MySQL(推荐顺序)

1. **准备 MySQL 8**(或 5.7+,建议 8.0),创建数据库:

```sql
CREATE DATABASE evodesk DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'evodesk'@'%' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON evodesk.* TO 'evodesk'@'%';
FLUSH PRIVILEGES;
```

2. **项目根目录建 `.env`**(或设置系统环境变量):

```env
DATABASE_URL=mysql://evodesk:你的密码@127.0.0.1:3306/evodesk
```

3. **启动**(首次连接自动建全部 22 张表 + 写入种子数据):

```bash
npm install
npm run build
NODE_USE_SYSTEM_CA=1 PORT=3001 npm start   # Windows Git Bash
# 或开发模式: npm run dev
```

4. 验证:打开 `http://localhost:3001/api/db/dialect`,应返回 `{"dialect":"mysql"}`;
   设置页顶部「数据源迁移」卡片会显示"当前数据源:MySQL"。

---

## 三、已有 SQLite 数据迁移到 MySQL(不停机操作)

前提:已在 `.env` 配置 `DATABASE_URL` 并用 MySQL 模式重启(此时旧 SQLite 文件原样保留在 `data/evodesk.db`)。

**方式 A:设置页图形界面(推荐)**

1. 打开 `设置` 页 → 「数据源迁移(SQLite → MySQL)」卡片(仅 MySQL 模式显示)。
2. 确认 SQLite 文件路径(默认 `data/evodesk.db`)。
3. 可选勾选「先清空 MySQL 目标表」(默认不勾,增量合并)。
4. 点「开始迁移」→ 完成后显示逐表行数对比。

**方式 B:API 调用**

```bash
curl -X POST http://localhost:3001/api/db/migrate-from-sqlite \
  -H "content-type: application/json" \
  -d '{"sqlitePath": "data/evodesk.db", "truncate": false}'
# 返回 { ok: true, perTable: { tasks: 15, links: 1241, ... } }
```

5. **校验**:迁移后抽查几页(收件箱/常用链接/笔记速记),行数应与 SQLite 时代一致;
   也可再跑一次迁移工具看行数是否稳定(幂等)。

---

## 四、MySQL 切回 SQLite(回退)

1. 删除/注释 `.env` 中的 `DATABASE_URL`(或改回 sqlite)。
2. 重启服务。数据回到 `data/evodesk.db`,一切如旧。
3. 若在 MySQL 期间产生了新数据要带回 SQLite:用 `设置 → 备份` 的
   **JSON 全量导出**(MySQL 模式)→ 切回 SQLite → **JSON 导入**,即可把数据带回来。

---

## 五、备份策略(两种模式不同)

| 模式 | 推荐备份方式 |
|---|---|
| SQLite | 设置页「创建快照」(秒级 .db 文件)或直接复制 `data/` 目录 |
| MySQL | 设置页「导出 JSON 备份」(包含全部 18 张业务表);或用 mysqldump |

JSON 备份文件跨方言通用:SQLite 导出的 JSON 可以导入 MySQL,反之亦然(密钥列默认剥离,导入后需重配)。

---

## 六、常见问题

- **启动报 `请使用 getMysqlDbAsync 完成首次迁移`**:请求没走异步入口,确认通过 `npm start`/`npm run dev` 启动而非直接调用内部模块。
- **MySQL 模式下某些页面报 "应使用 getAnyDb()"**:该入口尚未完成 MySQL 适配(设计如此,响亮报错防止写坏数据),请在 GitHub 提 issue 或切回 SQLite。
- **连接失败 `ECONNREFUSED 3306`**:MySQL 未启动或地址/端口不对;`mysql -h 127.0.0.1 -u evodesk -p` 先手动验证。
- **中文乱码**:建库时务必 `utf8mb4`(见上文建库语句);连接层已固定 utf8mb4。
- **迁移工具提示文件不存在**:`sqlitePath` 是相对项目根目录的路径,或改用绝对路径。
- **时间戳**:全库统一 UTC-ISO 字符串(text 列),两种方言行为完全一致,无需担心时区。

---

## 七、技术实现索引(给维护者)

- 方言网关:`src/lib/db/data-source.ts`(`getAnyDb()`,按 `DATABASE_URL` 前缀分流)
- MySQL 连接/自动迁移/自动播种:`src/lib/db/mysql.ts` + `src/lib/db/seed-mysql.ts`
- 双 schema:`src/lib/db/schema.ts`(SQLite)/ `src/lib/db/schema-mysql.ts`(MySQL),一致性由 `schema-parity.test.ts` 守护
- MySQL 迁移 SQL:`drizzle-mysql/`(由 `drizzle-mysql.config.ts` 生成,`npm run db:generate:mysql` 可再生成)
- 迁移工具 API:`src/app/api/db/migrate-from-sqlite/route.ts`(原生 SQL 双侧读写,保持 snake_case 备份格式)
- 备份:`src/lib/domain/backup.ts`(导出/导入双方言;快照/恢复仅 SQLite,MySQL 下 501)
