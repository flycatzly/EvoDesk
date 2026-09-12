import Link from "next/link";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: 1, title: "录入任务", body: "在收件箱一句话记下要做的事,或用顶栏快速新增;学习/健身等例行事项交给周期任务自动投放。" },
  { n: 2, title: "一键分诊", body: "对收件箱任务点「分诊」,AI 建议 标签 + 复杂度 + 流程模板,确认后就绪(未配置模型也可手动指派)。" },
  { n: 3, title: "开始执行", body: "就绪任务点「开始」,按步骤推进:AI 步骤流式产出,人工步骤提交材料,审核点通过/打回。" },
  { n: 4, title: "看板与复盘", body: "任务看板推进状态;「本周复盘」页看完成率、每日完成数与本周新增内容。" },
  { n: 5, title: "装点工作台", body: "首页是可拖拽画布:点「编辑布局」拖动组件/分组、2/3 栏切换,完成后「锁定布局」防误拖;「模板」可一键套用学生/职场/生活三套组合。" },
];

const MODULES = [
  { name: "待办任务", desc: "勾选完成、优先级区分紧急程度,逾期置顶提醒", href: "/tasks" },
  { name: "日历时间", desc: "月视图 + 每日任务,无需跳转外部日历", href: "/calendar" },
  { name: "内容灵感", desc: "灵感速记与学习笔记,支持标签、置顶、转任务、存知识库", href: "/notes" },
  { name: "常用链接", desc: "按分类聚合工作/学习网站,替代浏览器收藏夹,一键访问", href: "/links" },
  { name: "目标进度", desc: "读书、健身、项目目标进度条可视化,支持步进打卡", href: "/goals" },
  { name: "知识库", desc: "Obsidian vault 浏览/搜索/编辑,资料统一归档", href: "/vault" },
  { name: "AI 对话台", desc: "会话内按消息切换模型,结论一键转任务/存笔记", href: "/chat" },
  { name: "本周复盘", desc: "完成率、每日完成数量、本周新增内容一目了然", href: "/stats" },
];

const PERSONAS = [
  { name: "学生工作台", combo: "今日待办 + 课程表 + 笔记区 + 网课链接收藏 + 学习进度跟踪" },
  { name: "职场开发者工作台", combo: "工作待办 + 日程计划 + 项目笔记 + 开发常用工具链接 + 备忘" },
  { name: "生活个人工作台", combo: "每日计划 + 阅读影视清单 + 灵感笔记 + 个人目标进度 + 常用网站集合" },
];

const FAQ = [
  { q: "刷新后数据还在吗?", a: "在。所有数据存本地 SQLite 数据库文件(data/evodesk.db),不依赖浏览器缓存;但请定期用设置页的「导出/快照备份」保护数据,重要数据不要只有一份。" },
  { q: "换电脑怎么迁移?", a: "设置页一键导出 JSON 备份文件,在新机器装好 EvoDesk 后一键导入即可;或直接拷贝 data/evodesk.db 数据库文件。" },
  { q: "布局被误拖乱了怎么办?", a: "编辑完成后点「锁定布局」;需要调整时再解锁。画布支持多个工作台,不同场景分开建,不要全挤在一页。" },
];

const PRACTICES = [
  "PC 端负责编辑,手机端仅用于浏览查看。",
  "定期维护:每周清理过期任务、归档历史笔记,防止工作台信息堆积。",
  "克制添加功能:只保留真实会使用的模块,功能不是越多越好。",
  "创建多个工作台(如学习台/工作台分开),不要全部挤压在同一页面。",
  "组件堆满页面会信息过载:精简模块,只保留刚需。",
  "模板仅作底座,套用后按自己场景删减调整,不要全盘照搬。",
  "减少大体积图片素材,以简约风格为主,页面加载更快。",
];

export default function HelpPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-1">新手帮助</h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        五分钟上手你的个人信息聚合工作台:任务、日历、灵感、链接、目标,一页收口。
      </p>

      <section className="mb-8">
        <h2 className="font-semibold mb-3">快速上手五步</h2>
        <ol className="space-y-2">
          {STEPS.map((s) => (
            <li key={s.n} className="surface p-3 flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: "var(--accent)", color: "#fff" }}>{s.n}</span>
              <div>
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-sm" style={{ color: "var(--muted)" }}>{s.body}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-3">模块一览</h2>
        <div className="grid md:grid-cols-2 gap-2">
          {MODULES.map((m) => (
            <Link key={m.name} href={m.href} className="surface p-3 hover:opacity-90">
              <div className="text-sm font-medium" style={{ color: "var(--accent)" }}>{m.name} →</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{m.desc}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-3">不同人群的模块组合(首页「模板」一键套用)</h2>
        <div className="space-y-2">
          {PERSONAS.map((p) => (
            <div key={p.name} className="surface p-3">
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{p.combo}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-3">最佳实践与避坑</h2>
        <ul className="surface p-4 space-y-1.5 text-sm list-disc pl-6">
          {PRACTICES.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="font-semibold mb-3">数据安全</h2>
        <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>
          刷新不丢数据(SQLite 本地存储);浏览器清理缓存也不影响。但磁盘故障无法预测——请养成习惯:
          设置页支持 <Link href="/settings" style={{ color: "var(--accent)" }}>一键导出 JSON / 快照备份 / 恢复</Link>。
          对外分享:工作台「分享」按钮生成只读链接,可随时吊销。
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-3">常见问题</h2>
        <div className="space-y-2">
          {FAQ.map((f) => (
            <details key={f.q} className="surface p-3">
              <summary className="text-sm font-medium cursor-pointer">{f.q}</summary>
              <div className="text-sm mt-1.5" style={{ color: "var(--muted)" }}>{f.a}</div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
