# EvoDesk —— EvoFlow 式个人 AI 工作台设计文档

- 日期:2026-09-06
- 状态:设计定稿(待用户最终确认后进入实施计划)
- 交付形态:本地全栈 Web 应用(Next.js),数据全存本地 SQLite 单文件

## 1. 背景与参考源

| 参考源 | 借鉴内容 |
|---|---|
| **EvoFlow**(arXiv:2502.07373,进化式多智能体工作流框架) | 工作流模板"种群"、标签 niching 分派、复杂度自适应、成本-绩效感知、流程进化(变异/选择/淘汰) |
| **Maka**(本地优先桌面 AI 工作台) | 本地优先、以用户为中心三问、模块克制(5–9 个)、信息可寻性、浅/深主题、侧边栏+卡片流布局 |
| **Agent-OS**(多模型路由 AI 任务系统) | 模型路由层:统一 OpenAI 兼容接入 DeepSeek / Qwen / MiniMax / GLM / Moonshot / Ollama 等 |
| **新增需求(用户,2026-09-06)** | 工作台需能操作本地电脑:执行脚本/命令、打开应用与网页、整理文件;配套本地执行安全模型(§10.2) |

**一句话定位**:本地优先的个人"数字驾驶舱"——任务从收件箱进来,按"标签 × 复杂度"路由到流程模板,由异构执行器(AI / 人工 / 本地脚本)逐步处理,并能安全地操作本地电脑;执行数据反哺流程进化,越用越顺手。

## 2. 设计原则与落地承诺

| 原则 | 本设计中的落地 |
|---|---|
| 以用户为中心(每天打开最想解决什么?今天最重要的 3 件事?哪些任务有风险?) | 仪表盘首屏 = 核心数据 + 今日清单 + 风险雷达,一一对应三问 |
| 信息可寻性 | 固定侧边栏 ≤8 项;全局 ⌘K 命令面板直达任意任务/页面(v1.1,先用侧边栏+看板筛选) |
| 降低记忆负担 | 快速新增、一键分诊、继续执行三个高频动作常驻最显眼位置 |
| 保持简洁(核心模块 5–9 个) | 完整版 7 个视图;MVP 只上 5 个,先减法后加法 |
| 个性与灵活 | 浅色 / 深色 / 跟随系统主题;卡片流布局;侧边栏导航 |
| 本地优先 | 数据全部在本地 SQLite 单文件(`data/evodesk.db`);无云端依赖;可安全执行本地命令/脚本;AI 不可用时整体降级为手动模式仍可用 |

## 3. 核心概念映射(EvoFlow → 工作台)

| EvoFlow 概念 | 工作台对应物 |
|---|---|
| 异构 Agent(不同 LLM) | **执行器 Executor**:不同模型的 AI 角色(分诊/规划/执行/审查/复盘)+ 人工 |
| 工作流种群 | **流程模板库**:轻量 / 标准 / 深度多套模板共存,各有适用标签领域(niche) |
| Tag-based niching | 任务打标签 → 路由器按"标签 × 复杂度 × 绩效"选模板 |
| 复杂度自适应 | S / M / L 三级 → 轻量通道 / 标准流程 / 深度流程 |
| 成本-绩效感知 | 每步记录成本/耗时/质量,统计驱动模板选择与并列决胜 |
| 进化(变异/选择) | **复盘引擎**:分析执行记录 → LLM 生成流程变体 → 实验验证 → 晋升/淘汰 |

## 4. 技术栈与架构

- **框架**:Next.js 15(App Router)+ TypeScript
- **数据**:better-sqlite3 + Drizzle ORM(WAL 模式),数据文件 `data/evodesk.db`
- **UI**:Tailwind CSS;recharts(统计图);zod(API 与 LLM 结构化输出校验)
- **LLM**:原生 fetch 实现 OpenAI 兼容 chat completions 客户端(不引 SDK),`api_base` 可配,流式 SSE
- **启动**:`npm run dev` 开发;`npm run build && npm start` 生产(单进程)

分层:

```
UI 层     Server Components 直读 DB + Client 组件(SSE 流式、交互)
API 层    Route Handlers:/api/tasks · runs · templates · executors · evolution · stats · settings
领域层    router(路由器) · runner(执行引擎) · evolution(进化引擎) · llm(模型客户端) · stats(聚合)
数据层    Drizzle ORM + SQLite(WAL)
```

## 5. 数据模型(9 张表)

### 5.1 tasks(任务)
```
id TEXT PK · title · description(默认'') · tags(JSON 数组)
complexity('S'|'M'|'L') · priority 0-3 · due_date?(ISO)
status('inbox','triaging','ready','running','waiting_human','review','done','archived','canceled')
flow_template_id FK?(路由选定,start 前可改) · created_at · updated_at
```

### 5.2 flow_templates(流程模板)
```
id · name · description · tags(适用标签 niche,空=通用) · complexity('S'|'M'|'L')
version · lineage_id(同谱系共享,择优比较范围) · parent_id?(进化来源)
origin('seed'|'manual'|'evolution') · status('active'|'experimental'|'retired')
steps(JSON,单一事实来源) · created_at · updated_at
-- 聚合绩效缓存(run 数据刷新):stat_runs · stat_success_rate ·
-- stat_avg_cost_usd · stat_avg_duration_ms · stat_avg_satisfaction · stat_last_used_at
```

steps JSON 结构(v1 为线性序列,模板内不做分支/循环——多样性由模板种群承担):

```json
[
  { "name": "任务规划", "type": "llm", "executor_id": "exe_flash_planner",
    "prompt": "…{{task.title}}…{{task.description}}…{{prev_output}}", "optional": false },
  { "name": "收集素材", "type": "manual", "instruction": "整理参考资料并粘贴到下方" },
  { "name": "生成本地命令", "type": "llm", "executor_id": "exe_flash_planner",
    "prompt": "为完成「{{task.title}}」生成一条 PowerShell 命令,只输出 JSON {\"command\": \"…\"}" },
  { "name": "执行本地命令", "type": "script", "executor_id": "exe_pwsh",
    "command": "{{prev_output.command}}", "timeout_ms": 60000 },
  { "name": "交付审核", "type": "checkpoint", "instruction": "对照完成标准检查产出" }
]
```

步骤类型:`llm`(调执行器)· `manual`(人工提交)· `checkpoint`(审核:通过/打回)· `script`(执行本地命令,须过 §10.2 安全门)。`optional` 步骤可跳过。

### 5.3 flow_runs(执行实例)
```
id · task_id FK · template_id FK · template_version
status('running','waiting_human','review','done','failed','canceled')
started_at · finished_at · total_cost_usd · total_duration_ms
satisfaction?(1-5,评审时填) · outcome_note
```

### 5.4 step_runs(步骤执行记录)
```
id · run_id FK · step_index · step_name · executor_type('llm','manual','checkpoint') · model?
status('pending','awaiting_confirmation','running','done','skipped','failed')
input(渲染后 prompt) · output · error?
cost_usd · tokens_in · tokens_out · duration_ms
attempt(重跑次数,默认1) · rejected(checkpoint 打回标记)
feedback?('up'|'down') · feedback_note? · started_at · finished_at
```

### 5.5 executors(执行器/模型注册表 —— 即 Agent-OS 式模型路由层 + 本地执行器)
```
id · name(如'快速模型'、'PowerShell 本地执行') · type('llm','manual','script')
role('triage','planner','executor','reviewer','evolution')
-- type = llm 时:
model?(如 'glm-4-flash'、'deepseek-chat'、'qwen-flash')
api_base?(OpenAI 兼容端点;Ollama 填 http://localhost:11434/v1)
api_key_ref('env:ZAI_API_KEY' 或 'plain:…')
cost_per_1k_input · cost_per_1k_output
-- type = script 时:
shell('powershell'|'cmd'|'bash'|'python',默认 powershell)
command_template?(静态命令模板,可含 {{task.*}} 变量)
working_dir(工作目录,白名单之一) · timeout_ms(默认 60000) · auto_approve(默认 false)
-- 公共:
enabled · created_at
```

统一接入:DeepSeek / Qwen(百炼)/ MiniMax / GLM(Z.ai)/ Moonshot / Ollama 均走 OpenAI 兼容协议,换模型 = 换 `model` + `api_base` 两项配置。

### 5.6 quick_actions + quick_action_runs(快捷指令,操作本地电脑的直达入口)
```
quick_actions:  id · name · type('command'|'url') · payload(命令模板或 URL)
                shell?(仅 command) · icon? · sort · enabled · created_at
quick_action_runs: id · action_id FK · rendered_payload · output(截断至 64KB)
                   exit_code? · status('ok','failed','timeout','canceled') · duration_ms · ts
```
快捷指令不走任务流,从仪表盘一键触发;`command` 类型同样过 §10.2 安全门。

### 5.7 evolution_events(进化日志)
```
id · ts · kind('variant_created','promoted','retired','analysis_run')
template_id? · related_template_id? · reason · detail(JSON)
```

### 5.8 settings(KV)
JSON value:主题、成本预算、复盘触发阈值、路由默认偏好、**本地执行白名单目录**、**待人工超时阈值**等。

### 5.9 种子数据
- 模板 3 条:S 轻量通道(快速执行→交付确认,2 步)/ M 标准流程(任务澄清→执行→自检→交付审核)/ L 深度流程(规划→执行→审查→修订→交付审核,可含 manual 步骤)
- 执行器:人工;快速模型(任一便宜模型,role=triage/executor);强模型(role=planner/reviewer/evolution);**PowerShell 本地执行器(script,auto_approve=false,工作目录默认 `data/sandbox`)**
- 快捷指令示例:**打开 Z.ai 控制台(url)**、**打开工作目录(command,explorer %WORKSPACE%)**、**打开 EvoDesk 数据文件夹(url)**
- 标签集:写作 / 研究 / 事务 / 开发 / 生活 等常用标签

## 6. 任务处理全流程(状态机)

```
捕获 inbox → 分诊 triaging → 就绪 ready → 执行 running ⇄ 待人工 waiting_human
                                   ↓                              ↓
                              取消 canceled                  评审 review → 完成 done → 归档 archived
```

1. **捕获**:收件箱一句话录入;支持 `POST /api/tasks` 供外部投递;全局快速新增任意页面可用。
2. **分诊(复杂度自适应路由)**:见 §7。产出 tags + complexity + 流程模板,确认后任务就绪。
3. **执行**:由模板实例化 flow_run,逐步推进,见 §8。
4. **评审/完成**:末位 checkpoint 通过 → 评分(1–5)+ 结果备注 → done;可归档。
5. **复盘进化**:见 §9。

**本地操作挂点**:流程模板中的 `script` 步骤承担任务内本地操作(命令可静态编写,也可由前置 llm 步骤生成后渲染进来);仪表盘**快捷指令**则是不挂任务的直达本地操作(开网页/开目录/常用命令)。

对应"用户三问":每天打开看仪表盘(核心数据);今天最重要的 3 件事 = 今日清单(优先级×截止日排序);风险 = 风险雷达。

## 7. 路由器(复杂度自适应 + niching)

1. **分诊输入**:task 标题/描述;用户手动填过的字段(标签/复杂度/模板)跳过对应自动步骤。
2. **LLM 分诊**(role=triage,快速模型):输出 `{tags[], complexity, reason}`,zod 校验;失败重试 1 次;再失败 → fallback(通用标签 + M 复杂度),不阻塞。
3. **模板匹配打分**(在 active 模板中):
   ```
   score = 标签交集数×3 + (complexity 相等?2:0) + stat_success_rate×1 + (30 天内用过?+0.5:0)
   ```
   最高分胜出;**并列取平均成本低者**(成本-绩效感知);无候选 → fallback 种子标准模板;确认页可一键改选任何模板。
4. **优先级**:手动指定 > 标签规则打分 > LLM 建议 > 默认标准流程。

## 8. 执行引擎与兜底

- **start**:校验模板 active → 创建 flow_run(running)+ 全部 step_runs(pending)→ task=running。
- **advance 动作**(`POST /api/runs/[id]/steps/[n]/advance`):
  - llm 步骤:`execute` → SSE 流式产出 → 成功记 cost/tokens/时长;失败记 error
  - manual 步骤:`submit{output}` → done;该步成为当前步时 run/task = waiting_human
  - checkpoint:`approve` / `reject{note, target_index?}`(rejected=1,打回目标默认为前面最近可执行步骤,置回 pending 重跑)
  - script 步骤:`execute` → 渲染命令 → 若需确认(见 §10.2)则置 `awaiting_confirmation` 并返回渲染后完整命令与风险标记 → 用户 `confirm` 后 child_process 真正执行,stdout/stderr/退出码记入 output;非零退出/超时/输出超限 → failed
  - optional 步骤:`skip`;failed 步骤:`retry`(attempt+1)
  - **manual_override**:任何 llm 步骤可人工直接填产出 → done(兜底)
- **自动推进**:llm 步骤成功后自动串行执行后续 llm 步骤,遇 manual/checkpoint 停;此时 run/task = waiting_human。
- **失败兜底链**:LLM 失败 → 自动重试 1 次(指数退避)→ 仍失败 → 步骤 failed,提供 4 个选项:重试 / 手动填 / 跳过(仅 optional)/ 取消 run。API key 缺失 → 直接 failed 并给配置入口。run 永不因单步失败而崩。
- **完成**:末位 checkpoint approve → run=done、task=review → 评分弹窗 → task=done。
- **一致性**:better-sqlite3 单连接同步事务;SSE 执行期间步骤锁 running,重复 advance 拒绝。

## 9. 进化引擎(复盘 → 变体 → 验证 → 晋升/淘汰)

**统计口径**(全文档统一):
- run **成功** = flow_run.status 到达 done;**成功率** = done / (done + failed)
- **打回率**(步骤级)= rejected=1 的 checkpoint 步骤 / checkpoint 步骤总数
- **人工接管率** = manual_override 的 llm 步骤 / llm 步骤总数
- **待人工超时** = task 处于 waiting_human 超过 24 小时(阈值可配)


- **触发**:自上次分析后新完成 run ≥5(阈值可配)→ 仪表盘"可复盘"提示;任何模板可手动触发。
- **复盘输入**(role=evolution,强模型):
  1. 模板 steps 定义;2. 聚合绩效;3. 步骤级热点(每步打回率/失败率/平均 attempt/人工接管率/成本);4. 最近 3 个不满意 run(satisfaction≤2)摘要(标题+失败步骤+打回备注)。
- **复盘输出**(zod 校验):
  ```json
  { "diagnosis": "…",
    "variants": [ { "name": "…",
                    "changes": [
                      { "op": "remove_step", "index": 2 },
                      { "op": "add_step", "after_index": 1, "step": { "name": "…", "type": "llm", "executor_id": "…", "prompt": "…" } },
                      { "op": "replace_executor", "index": 0, "executor_id": "…" },
                      { "op": "edit_prompt", "index": 1, "prompt": "…" },
                      { "op": "reorder", "from": 3, "to": 1 }
                    ],
                    "rationale": "…" } ],
    "retire_suggestions": [ { "template_id": "…", "reason": "…" } ] }
  ```
  add_step 的 step 与 5.2 节 steps JSON 元素结构一致;越界/非法 op 由 zod 拒绝并整单放弃该变体。
- **变体落地**:changes 以纯函数应用到 steps JSON → 新模板(origin=evolution、parent_id 指原版、lineage_id 继承、version+1、status=experimental);流程库提供原版/变体步骤 diff 对照,由用户审阅。
- **验证闭环**:experimental 不进自动路由;用户手动指任务试用,满 3 次 run 且成功率达标 → 提示晋升;批准后 active,**同 lineage_id + 同 complexity 默认只留一个 active**,旧版自动 retired。
- **淘汰**:stat_runs≥5 且成功率<50% 且 30 天未用 → 建议退役,用户确认后软删(retired,历史可查)。
- **多样性**:晋升/淘汰只在同 lineage_id + 同 complexity 内比较;不同标签 niche 互不干扰。
- 全程写 evolution_events,时间线在流程库页展示。

## 10. 模型路由层与本地执行

### 10.1 模型路由(Agent-OS 式)

- executors 表即模型注册表;role 决定用途(分诊用快模型,规划/审查/复盘用强模型)。
- OpenAI 兼容统一客户端:DeepSeek / Qwen / MiniMax / GLM / Moonshot / Ollama 换配置即换模型。
- 流式 SSE;tokens × 单价实时记成本;预算(settings 成本上限)超限 → 仪表盘风险雷达提示。
- 密钥:`api_key_ref = 'env:XXX'`(推荐)或 `'plain:…'`(存本地文件,界面提示风险)。

### 10.2 本地执行安全模型(script 执行器与快捷指令共用)

安全边界 = **确认门 + 白名单 + 全量留痕**,不提供进程级沙箱隔离(个人本地工具,明示风险)。

1. **确认门(默认开启)**:执行前在界面显示渲染后的完整命令,用户点击确认才执行。
2. **auto_approve 例外**:执行器可设 `auto_approve=true` 跳过确认,**但仅对不含渲染变量的纯静态命令生效**;命令中含 `{{prev_output.*}}` 等 AI 产出变量 → 强制走确认门(AI 生成命令必须人工过目)。
3. **破坏性模式启发式告警**:渲染后命令命中 `del /s`、`rd /s`、`rmdir /s`、`rm -rf`、`format`、`Remove-Item -Recurse -Force`、`reg delete`、`shutdown` 等模式 → 警示色 + 输入任务名二次确认;启发式仅为提示,不是安全保证,文档明示。
4. **目录白名单**:settings 维护可执行工作目录列表(默认 `data/sandbox` + 用户添加);`working_dir` 不在白名单 → 拒绝执行。
5. **资源限制**:timeout_ms(默认 60s,可按执行器配置)· 输出截断 64KB · 单次执行不交互(禁用交互式命令,stdin 关闭)。
6. **全量留痕**:任务内 script 步骤记 step_runs;快捷指令记 quick_action_runs(命令、输出、退出码、耗时);执行视图可回看历史输出。
7. **Shell 支持**:powershell(默认,`-NoProfile -Command`)· cmd · bash(Git Bash)· python。

## 11. UI 设计

**布局**:左侧固定侧边栏(Logo + 导航 + 快速新增按钮)+ 主内容卡片流;遵循 Z 型阅读;配色 ≤4 色 + 1 强调色;重要信息(已延期、待人工)用强调色突出;合理留白。

**视图清单(完整版 7 个,MVP 加粗 5 个)**:

1. **仪表盘**(MVP 简版:核心数据 + 今日清单;M5 加入风险雷达与可复盘提示):核心数据(今日待办/执行中/待人工/本周成本)· 今日清单(已延期/今天截止/即将截止三态,延期置顶)· **快捷操作卡片(快捷指令:一键开网页/开目录/跑常用命令,command 类走确认门)** · 风险雷达(延期任务/待人工超时/成本预算超限/低绩效模板,阈值可配)· 可复盘提示
2. **收件箱**(MVP):快速录入 + 分诊队列(一键 LLM 分诊 → 确认标签/复杂度/模板 → 就绪)
3. **任务看板**(MVP):按状态分列(就绪/执行中/待人工/评审/完成),卡片带标签/复杂度/成本徽章,点卡进执行视图
4. **任务执行视图**(MVP):左侧步骤时间线(当前步高亮、完成步可展开看产出/成本),右侧当前步骤操作区(AI 流式输出 / 手动输入 / 审核通过-打回 / 重试-手动兜底 / **script:命令预览+确认执行+输出控制台**)
5. **流程库**(MVP):模板卡片(版本谱系、绩效徽章:成功率/平均成本/耗时、活跃/实验/退役状态)、步骤预览、克隆/退役、进化事件时间线
6. 执行器管理:模型/人工/**脚本**执行器 CRUD(llm:模型/端点/单价;script:shell/工作目录/超时/自动批准开关;**白名单目录管理**)
7. 设置:主题切换、成本预算、复盘阈值、密钥配置指引

**全局**:`⌘K` 命令面板(搜任务/页面/新建任务,v1.1);全局快速新增(MVP);浅色/深色/跟随系统(MVP)。

**v1.1**:统计图表页(趋势、模板绩效对比)、⌘K 面板、模板 diff 视图增强、复盘自动提醒频次优化。

## 12. API 一览(Route Handlers)

```
GET/POST   /api/tasks                    列表(状态/标签/复杂度筛选) · 新建
GET/PATCH  /api/tasks/[id]               详情 · 更新(含取消/归档)
POST       /api/tasks/[id]/triage        LLM 分诊(建议 tags/complexity/模板)
POST       /api/tasks/[id]/start         由模板创建 flow_run
GET        /api/runs/[id]                run + 步骤详情
POST       /api/runs/[id]/steps/[n]/advance   execute/submit/approve/reject/skip/retry/manual_override
POST       /api/runs/[id]/feedback       满意度 + 备注
POST       /api/runs/[id]/steps/[n]/stream    SSE 流式(AI 步骤执行输出)
GET/POST   /api/templates                模板库 · 新建/克隆
GET/PATCH  /api/templates/[id]           详情 · 编辑/退役/晋升
POST       /api/evolution/analyze        触发复盘分析
GET        /api/evolution/events         进化事件时间线
GET/POST/PATCH /api/quick-actions        快捷指令 CRUD
POST       /api/quick-actions/[id]/preview    渲染命令 + 风险标记(不执行)
POST       /api/quick-actions/[id]/confirm    确认后真正执行,返回运行记录
GET        /api/quick-actions/runs       快捷指令执行历史
GET/POST   /api/executors                执行器 CRUD
POST       /api/executors/[id]/test      连通性/试运行测试(模型 ping、脚本 echo)
GET        /api/stats                    仪表盘/统计聚合
GET/PUT    /api/settings                 设置 KV
```

## 13. 测试策略

- **单元(vitest)**:路由器打分与 fallback、进化统计聚合(打回率/成功率/人工接管率)、steps 变更纯函数(remove/add/replace/reorder/edit_prompt)、提示词变量渲染、任务状态机流转合法性
- **集成**:Route Handlers 对临时 SQLite 库;LLM 用 mock server(流式/失败/重试路径);**script 执行器(超时终止、非零退出码、输出截断、确认门拦截/放行、白名单外目录拒绝、破坏性模式告警)**
- **冒烟**:创建任务 → 分诊(mock)→ start → 逐步执行(含一次打回、一次手动兜底、一次 script 步骤确认执行)→ 评分完成 全链路 API 测试

## 14. 范围边界(v1 不做,架构预留)

拖拽看板(dnd-kit)、XL 任务拆子任务、日历视图、IM/邮件消息聚合、多用户与鉴权、桌面打包(Electron/Tauri,v2 可选)、移动端、**定时任务与文件监控(script 的 cron/watch 触发,v2)**、**远程机器控制(仅本机)**、**进程级沙箱隔离**(安全边界为确认门+白名单+留痕,见 §10.2)。

## 15. 实施里程碑

| 里程碑 | 内容 |
|---|---|
| M1 | 项目骨架 + 数据层(Drizzle schema + 迁移)+ 种子数据 + 主题骨架 |
| M2 | 收件箱 + 分诊(LLM 分诊 + 路由器)+ 任务 CRUD |
| M3 | 执行引擎(runner、SSE、兜底链)+ 任务执行视图 + 模型路由层 + **script 执行器与安全门** |
| M4 | 流程库 + 进化引擎(复盘/变体/diff/晋升/淘汰)+ **快捷指令** |
| M5 | 仪表盘 + 风险雷达 + 统计 + 打磨(空态/加载态/错误态)|

## 16. 变更记录

- **2026-09-06 v1**:初稿定稿。
- **2026-09-06 v1.1**:应用户要求新增"操作本地电脑"能力——script 执行器(executors 表扩展 shell/working_dir/timeout/auto_approve)、流程模板新增 script 步骤类型与 awaiting_confirmation 状态、快捷指令模块(quick_actions + quick_action_runs,表数量 7→9)、本地执行安全模型(§10.2:确认门/白名单/资源限制/全量留痕);相应更新执行引擎、UI、API、测试与里程碑。
