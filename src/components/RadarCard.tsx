import Link from "next/link";

// 风险项由 page.tsx(RSC)计算后传入;kind 用于类别徽章,href 可选(无跳转目标则不渲染链接)
export type RadarItem = { kind: string; label: string; href?: string; detail: string };

// kind → 徽章短标签;未知 kind 兜底显示原始值
const KIND_LABEL: Record<string, string> = { overdue: "延期", timeout: "超时", budget: "预算", performance: "绩效" };

// 纯展示服务端组件(无交互):无风险显示绿色「一切正常」,有则逐行 ⚠ + 类别徽章 + 描述 + 可选链接
export function RadarCard({ items }: { items: RadarItem[] }) {
  return (
    <section className="mb-6">
      <h2 className="font-semibold mb-2">风险雷达</h2>
      {items.length === 0 ? (
        <div className="surface p-4 text-sm" style={{ color: "var(--ok)" }}>✓ 一切正常</div>
      ) : (
        <div className="surface p-3">
          {items.map((it) => (
            <div key={it.kind} className="flex items-center gap-2 py-1.5 text-sm">
              <span style={{ color: "var(--warn)" }}>⚠</span>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
                {KIND_LABEL[it.kind] ?? it.kind}
              </span>
              <span className="font-medium">{it.label}</span>
              <span className="min-w-0 truncate" style={{ color: "var(--muted)" }} title={it.detail}>{it.detail}</span>
              {it.href && (
                <Link href={it.href} className="ml-auto shrink-0 text-xs hover:opacity-80" style={{ color: "var(--accent)" }}>
                  查看 →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
