// 组件空态:统一视觉,给出下一步指引
export function WidgetEmpty({ text, href, linkLabel }: { text: string; href?: string; linkLabel?: string }) {
  return (
    <div className="text-sm py-2" style={{ color: "var(--muted)" }}>
      {text}
      {href && (
        <a href={href} className="ml-1 hover:opacity-80" style={{ color: "var(--accent)" }}>
          {linkLabel ?? "去处理 →"}
        </a>
      )}
    </div>
  );
}
