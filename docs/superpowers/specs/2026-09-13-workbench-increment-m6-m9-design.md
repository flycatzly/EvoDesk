# EvoDesk 工作台增量批次(M6–M9)设计文档

- 日期:2026-09-13
- 来源:`docs/新建 文本文档.txt`(新增模块需求清单)+ `docs/1.png`(风格参考:7 套内置风格)
- 前置:2026-09-06 EvoDesk 设计文档(M1–M5 已全部实现)
- 状态:设计定稿,进入实施

## 1. 需求概要与差距分析

新需求核心:**以拖拽组件画布为首页的个人信息聚合工作台**,外加 4 个独立增量。对照现状:

| 新需求 | 现状 | 差距 |
|---|---|---|
| 拖拽组件画布(待办/日历/笔记/链接/目标/知识库,2/3 栏,分组容器,布局锁定) | 首页为固定仪表盘 | **全新**:画布数据模型 + 拖拽编辑 + 锁定 |
| 常用链接收藏(分组、一键访问、替代收藏夹) | 无(quick_actions 是命令/启动,非收藏夹) | **全新**:links 表 + 管理 UI + 链接组件 |
| 目标进度(读书/健身/项目,进度条可视化) | projects 有任务完成率,无独立目标 | **全新**:goals 表 + 管理 UI + 目标组件 |
| 知识库收纳组件 | /vault 已有 Obsidian 浏览 | **组件化**:vault 概览小部件 |
| 首页指标(今日任务/逾期/灵感数量/项目进度) | 今日/逾期/项目进度已有 | 补"灵感数量"计数,指标组件化 |
| 页面:首页/任务/内容灵感/本周复盘/新手帮助 | 首页/任务/笔记(notes)/统计已有 | 新增 /help;"内容灵感"= notes 页(导航标签改名);本周复盘= stats 页扩展 |
| 本周复盘(完成率、每日完成数量、本周新增内容) | stats 有每日完成/成本趋势 | 补:完成率、本周新增(任务/笔记按创建日聚合) |
| 7 套主题风格(1.png 清单)并扩展 | 仅深/浅两色 | **主题系统重做**:7 套预设色板 |
| 布局锁定 / 私有 / 公开分享链接 | 无 | 画布 locked 开关;/share/[token] 只读页 |
| 工作台模板复用(学生/职场/生活组合) | 无 | 预置 3 套画布模板,一键套用 |
| 一键导出/导入/备份(数据不只放浏览器) | 无 | JSON 全量导出/导入 + SQLite 快照备份,导入前自动备份 |
| 需求教练(AI 逐轮提问→生成搭建提示词) | 对话台已可复用 | chats 增加 coach 模式页面 |
| 本地 Skill 汇总管理(技能地图) | 无 | 扫描本地 skills 目录、解析 SKILL.md、分类/搜索 |
| BOSS直聘 CDP 岗位抓取集成 | 无 | 托管外部 Python CDP 脚本 + jobs 表 + 管理页 |

**分解为 4 个里程碑**(按需求文档自身顺序,画布优先):

- **M6 聚合工作台**:画布 + 链接 + 目标 + 帮助页 + 本周复盘扩展(本批次核心)
- **M7 主题与数据安全**:7 套主题 + 一键导出/导入/备份
- **M8 AI 增强**:需求教练 + 本地 Skill 地图
- **M9 求职雷达**:BOSS直聘 CDP 集成

## 2. 关键方案取舍(M6)

### 2.1 画布数据模型:JSON 文档 vs 规范化表

- **选定:单表 JSON 文档**。`canvases(id, name, layout_json, locked, columns, is_template, share_token, …)`,layout_json = `[{groupTitle, widgets:[{id, type, config}]}]`。
- 理由:拖拽重排 = 一次整存,原子、简单;模板套用 = JSON 深拷贝;组件内容数据(任务/链接/目标)仍在各自表里,布局与数据解耦。
- 备选(规范化 canvases/groups/widgets 三表)被否:三次级联写入换来的是没有收益的复杂度;画布是单用户低频写的整体文档。

### 2.2 拖拽实现:dnd-kit vs 原生 HTML5 DnD

- **选定:@dnd-kit/core + @dnd-kit/sortable**。跨分组移动、键盘可达性、触摸支持(手机)开箱即用,是 React 生态事实标准。
- 备选(HTML5 draggable)被否:移动端不工作——需求明确要求手机适配。

### 2.3 首页:画布替换固定仪表盘

- **选定:首页 = 画布渲染器**。默认画布的预置组件**完整覆盖现有仪表盘能力**(指标卡、快捷指令、今日清单、项目进度、风险雷达),旧首页退役,无能力回退。
- 理由:需求把"信息聚合页"定义为首页;保留两套首页会造成数据与维护双份。
- 固定仪表盘的各卡片改造为组件(见 §3.3),RadarCard/QuickActionsCard 等复用。

## 3. M6 详细设计

### 3.1 数据模型(3 张新表,drizzle 迁移 0003)

```
links:    id · title · url · category(分组名,默认'常用') · sort · created_at
goals:    id · title · category('reading','fitness','project','custom') · target(数值)
          · current(默认0) · unit(如'本','次','%') · deadline?(yyyy-mm-dd)
          · color(默认accent) · archived(默认0) · created_at · updated_at
canvases: id · name · columns('2'|'3',默认'2') · locked(默认0) · layout(JSON)
          · is_template(默认0) · share_token?(唯一) · created_at · updated_at
```

layout JSON 结构(单一事实来源,应用层 zod 校验):

```json
[
  { "groupTitle": "今日焦点", "widgets": [
      { "id": "w_x1", "type": "counters", "config": {} },
      { "id": "w_x2", "type": "todo", "config": { "scope": "today" } } ] },
  { "groupTitle": "资料与链接", "widgets": [
      { "id": "w_y1", "type": "links", "config": {} } ] }
]
```

widget type 全集:`counters`(今日待办/逾期/灵感数量/项目进度概览)· `todo`(勾选完成、优先级标色、逾期置顶;config.scope: today|all)· `calendar`(当月迷你日历+今日高亮)· `notes`(最近笔记+快速灵感录入)· `links`(按 category 分组一键访问)· `goals`(进度条列表)· `vault`(知识库统计:目录数/最近笔记)· `radar`(风险雷达)· `quickactions`(快捷指令按钮组)。

### 3.2 种子画布

- 默认画布"我的工作台":3 个分组——"今日焦点"(counters + todo + calendar)、"灵感与笔记"(notes + vault)、"链接与目标"(links + goals),另含 radar + quickactions,完整覆盖旧首页。
- 3 套模板(is_template=1,不出现在首页切换器,仅在模板抽屉展示):**学生工作台**(今日待办/课程笔记/网课链接收藏/学习进度)、**职场开发者工作台**(工作待办/日程计划/项目笔记/开发工具链接/备忘)、**生活个人工作台**(每日计划/阅读影视清单/灵感笔记/个人目标/常用网站)。套用 = 深拷贝模板 layout 为新画布。

### 3.3 首页画布交互(客户端组件 CanvasBoard)

- **模式**:`locked`(默认,纯浏览,无拖拽手柄)⇄ `editing`(拖拽 + 增删)。切换按钮常驻画布右上角;locked 时按钮置灰锁形图标,防误拖。
- **拖拽**:分组内组件排序、跨分组移动(dnd-kit SortableContext per group)、分组整体排序(分组标题栏为 handle)。编辑模式下,分组标题可改、可删分组/组件;每分组底部"+ 添加组件"按类型菜单插入。
- **布局**:页面级 2/3 栏切换(存 columns);分组为 CSS grid 项,组内组件纵向堆叠;移动端(<768px)强制单栏、隐藏拖拽(仅浏览),符合"PC 编辑、手机浏览"最佳实践。
- **多画布**:顶栏画布切换器(名称下拉)+ 新建/重命名/删除;每画布独立 locked/columns。
- **分享**:画布菜单"生成分享链接"→ 生成随机 token 存 share_token → `/share/<token>` 只读渲染同一画布(隐藏编辑入口,不显示 locked 控件);可随时吊销(置空 token)。本地部署下该链接在内网/公网映射后可访问,页面自带"由 EvoDesk 分享"脚注。

### 3.4 新页面与导航

| 页面 | 内容 |
|---|---|
| `/`(改) | 画布工作台(见 §3.3) |
| `/links`(新) | 常用链接管理:分类分组、增删改、排序、一键打开 |
| `/goals`(新) | 目标管理:进度条 + current 步进/直接编辑、归档、按类别筛选 |
| `/help`(新) | 新手帮助:快速上手 5 步、模块一览、三套人群模板说明、最佳实践与避坑(来自需求文档§6)、数据备份指引、FAQ |
| `/stats`(改) | 顶部新增"本周复盘"卡:本周完成率(done/(done+新增未完成)? 采用口径:本周截止任务完成数/本周应完成数,简化口径见下)、每日完成数量柱状图(本周)、本周新增内容(任务/笔记计数 + 列表入口);原 14 天趋势保留 |
| 导航(改) | 核心组:+链接、+目标;资产组 notes 标签改"内容灵感";系统组 +新手帮助(/help);stats 标签改"本周复盘" |

**本周完成率口径**(避免歧义,统一为):`本周完成数 / (本周完成数 + 本周截止且未完成数)`,无应完成任务时显示 `—`;"本周" = timezone 感知(复用 tz.ts)周一 00:00 至今。

### 3.5 API(Route Handlers)

```
GET/POST     /api/canvases            画布列表(含模板标记)· 新建(可从模板复制)
GET/PUT/DELETE /api/canvases/[id]     详情/整存 layout/重命名/栏数/锁定 · 删除
POST         /api/canvases/[id]/share      生成/吊销分享 token
GET          /api/canvases/by-token/[token] 分享只读取画布(仅返回 layout/name/columns)
GET/POST     /api/links               链接列表 · 新建
PATCH/DELETE /api/links/[id]          改(含 sort)· 删
GET/POST     /api/goals               目标列表(含 archived 筛选)· 新建
PATCH/DELETE /api/goals/[id]          改(含 current 步进、归档)· 删
GET          /api/stats               扩展:week 复盘段(完成率/每日完成/新增任务/新增笔记)
```

zod 校验:layout 结构(groupTitle string、widgets type 枚举、config record)、link url 必须为 http(s)、goal target>0 且 0≤current≤target*10(允许超额但不允许负)。

### 3.6 服务端组件数据流

首页为 RSC(`force-dynamic`):读默认画布 + 并行取组件数据源(tasks 今日/逾期、notes 最近、links 全部、goals 未归档、vault 统计、radar 数据、quick_actions),一次性传给 `<CanvasBoard>`(client)序列化 props;编辑操作只写 layout_json,数据组件刷新走 `router.refresh()`。

## 4. M7 主题与数据安全

### 4.1 7 套主题(1.png 清单落色)

主题 = 完整 CSS 变量组(bg/surface/surface-2/text/muted/border/accent/accent-2),localStorage `evodesk-theme` 存预设 id,layout.tsx 启动脚本按 id 注入(替换现 dark class 机制,`dark` id 映射为深色科技保证兼容):

| id | 名称 | 定位(来自 1.png) |
|---|---|---|
| pink-ins | 粉色 Ins 风 | 日常计划/生活方式/温柔效率;低饱和粉+奶白 |
| mint-fresh | 薄荷清新风 | 学习/阅读/打卡;薄荷绿+白 |
| cream-journal | 奶油手账风 | 日记/复盘/家庭;奶油黄+棕 |
| blue-study | 蓝白学习风 | 学生/备考/数据看板;蓝+白 |
| minimal-pro | 极简效率风 | 工作流/项目/会议;灰白+黑强调 |
| xfc | xfc 风 | 白纸感、橙色主强调、灰绿辅助(内容运营/知识库/skill 工作台) |
| dark-tech | 深色科技风 | 开发者/AI 工具库/数据看板(现深色版微调) |

- ThemeToggle → **ThemePicker**(色板下拉,每项双色预览圆点),TopBar 与设置页都可用;色板定义集中在 `src/lib/theme.ts`(预设表 + 变量应用函数),可继续扩展(需求"并扩展")。
- 低饱和原则:全部预设 satura≤60%,accent 仅用于强调(需求 §配色方案)。

### 4.2 导出 / 导入 / 备份

- **导出 JSON**(设置页 + /help 指引):`GET /api/backup/export` → 下载 `evodesk-backup-<ts>.json`,内容 `{version:1, exported_at, tables:{tasks, projects, notes, chats, chat_messages, links, goals, canvases, recurring_rules, quick_actions, quick_action_runs, flow_templates, flow_runs, step_runs, evolution_events, executors, provider_profiles, settings}}`。**默认剥离密钥**:provider_profiles/executors 的 `api_key_ref` 置空,请求参数 `?include_secrets=1` 显式携带。
- **导入**:`POST /api/backup/import`(multipart 文件)→ zod 校验 version/结构 → **先自动快照当前库** → 单事务内逐表 delete+insert(全量替换语义)→ 返回导入统计;校验失败拒绝且不落库。
- **快照备份**:`POST /api/backup/snapshot` 用 better-sqlite3 `db.backup()` 写 `data/backups/evodesk-<ts>.db`;`GET /api/backup/snapshots` 列表;`POST /api/backup/restore` 从指定快照恢复(同样先自动快照);保留最近 20 份,超出清理。
- 单元测试:导出剥离密钥、导入校验拒绝坏文件、恢复流程先备份。

## 5. M8 AI 增强

### 5.1 需求教练(/coach)

- 复用 chats/chat_messages 与 llm 流式客户端;chats 增加 `mode` 列(`'chat'|'coach'`,默认 chat,迁移同 0003)。
- 教练系统提示词(内置,role=planner 执行器):不写代码,逐轮只问**一个**问题(先目标人群与场景→再核心模块取舍→再数据与迁移→再风格与布局),最多 6 轮后主动总结并输出**最终搭建提示词**(结构化 markdown:目标/模块清单/布局/数据/风格/验收),界面提供"复制提示词"与"存为笔记"(复用 notes API)。
- 页面复用 ChatView 加 mode=coach 分支(轮次计数、结束条件、生成物高亮)。

### 5.2 本地 Skill 地图(/skills)

- settings 新增 `skills_dirs`(JSON 数组,默认 `~/.agents/skills`、`~/.claude/skills`,设置页可改)。
- `GET /api/skills/scan`:在白名单目录内递归找 `SKILL.md`,解析 frontmatter(name/description/允许的元字段),返回 `{path, name, description, category(一级父目录名), mtime}`;路径穿越与白名单外一律拒绝(复用 vault 的 isPathWithin 模式)。
- 页面:分类折叠列表、关键字搜索、星标/备注(本地 settings KV `skills_meta`,path→{star,note});"一键梳理"= 重新扫描并按类别归并展示。
- 明确只读:不写入、不执行任何 skill 内容。

## 6. M9 求职雷达(BOSS直聘 CDP 集成)

- **形态**: dedicated `/jobs` 页 + 后端进程托管,**不自行实现爬虫逻辑**——按需求文档方案 vendor 外部脚本 `scripts/boss_cdp_raw.py`(单一 Python 文件,从 github.com/eatmoreduck/boss-zhipin-scraper 获取;不可得时按文档技术方案实现同等脚本并在 UI 明示"未对线上接口验证")。
- 新表 `jobs`(job_id 唯一 · title · salary_desc · city · company · scale · tags JSON · jd · url · fetched_at · search_json)。
- 页面能力:参数表单(关键词/城市/页数≤10/筛选)→ 后端 spawn python 脚本(同 quick-actions 的进程管理模式,stdout 流式进度)→ 按 job_id upsert 入库 → 列表(筛选/搜索/导出 CSV UTF-8 BOM);`--setup-chrome/--check` 环境操作按钮;每次运行记录 jobs_runs(命令、状态、计数)。
- **守门(默认内置,不可关闭)**:单次≤10 页、页间随机 12–22s 延迟、隔离 profile、仅本人已登录会话、页面常驻"仅限个人求职研究"提示。
- 运行依赖 Python3 + Chrome,未安装时给出指引且不影响其他功能。

## 7. 测试策略(vitest,沿用 colocated 模式)

- 领域:layout zod 校验(合法/非法 widget type/越权 config)、模板深拷贝、完成率口径(tz 感知周边界)、导出剥离密钥、导入校验与全量替换、快照清理保留 20 份、skills frontmatter 解析(坏文件跳过)、jobs upsert 去重。
- API:canvases CRUD/share/by-token、links/goals CRUD、backup export/import/snapshot/restore、stats week 段、skills scan(白名单外拒绝)、coach 模式消息流。
- 冒烟:新库种子后首页画布可渲染全部 9 类组件(组件数据源为空时显示空态)。

## 8. 范围边界(本批次不做)

- 多用户/鉴权(分享链接为只读快照语义,不含权限体系);画布组件级权限;组件拖拽缩放(col-span 固定);移动端拖拽编辑(仅浏览);RSS/资讯自动抓取;Obsidian 双链图谱;BOSS 详情页每日全自动定时抓取(手动触发);单 HTML 交付版。

## 9. 里程碑验收标准

1. 首页为可拖拽画布:编辑模式拖动组件/分组立即生效,刷新后保持;锁定后无法拖动;2/3 栏可切换;手机宽度下单栏只读。
2. 链接与目标:增删改、分组、一键打开、进度条更新,刷新后保持;首页对应组件同步。
3. 新手帮助页完整可读;本周复盘显示完成率/每日完成数/本周新增。
4. 7 套主题一键切换即时生效、刷新后保持;新预设不影响现有组件可读性。
5. 一键导出 JSON 不含密钥;导入校验失败不落库;导入/恢复前自动快照,可从快照恢复。
6. 需求教练能完成逐轮提问并输出可复制的搭建提示词;Skill 地图能扫描预设目录并分类展示。
7. 求职雷达在配置好环境后可跑通一次真实抓取入库并在页面筛选导出;未配置环境时给出明确指引。
8. `npm run test`、`npm run lint`、`npm run build` 全绿。

## 10. 变更记录

- 2026-09-13 v1:初稿(M6-M9 分解 + M6 详细设计 + M7/M8/M9 设计)。
