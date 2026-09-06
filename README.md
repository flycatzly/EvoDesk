# EvoDesk · EvoFlow 式个人 AI 工作台

本地优先的个人工作台:任务收口 → AI 分诊路由 → 流程化执行(后续里程碑)→ 数据反哺流程进化。
设计文档见 `docs/superpowers/specs/`,实施计划见 `docs/superpowers/plans/`。

## 启动

```bash
npm install
npm run dev        # http://localhost:3000
```

数据存于 `data/evodesk.db`(SQLite,WAL)。首次启动自动建表并写入种子数据(示例任务/项目/周期规则/流程模板)。

## 测试

```bash
npm test           # vitest 单测 + API 集成测试
npm run build      # 生产构建
```

## 当前里程碑(M1+M2)能力

- 收件箱:快速录入、AI 一键分诊(标签/复杂度/流程模板,失败自动降级)、确认就绪
- 任务看板:状态分列、项目过滤、手动流转(状态机保护)
- 仪表盘:核心数据、今日清单(延期置顶)、项目进度
- 周期任务:每日/工作日/每周规则,到点自动投放,错过补齐
- 设置:主题(深色默认+蓝紫强调)、成本预算、Obsidian vault 路径、待人工阈值
- 顶栏:实时时钟、每日语句、全局快速新增

## 接入 AI(可选)

分诊默认降级可用。启用 AI 分诊:在数据库或后续"执行器"页配置模型执行器后启用,
或设置环境变量后启用种子执行器(快速模型 `EVODESK_FAST_KEY` / 强模型 `EVODESK_STRONG_KEY`,
默认指向 OpenAI 兼容端点,可改 apiBase 为 Z.ai/DeepSeek/MiMo 等任何兼容端点;
Anthropic 协议端点同样支持)。

## 后续里程碑

M3 执行引擎(runner/SSE/script 安全门)+ AI 对话台;M4 流程库/进化引擎/快捷指令/知识库;M5 风险雷达/日历/统计。
