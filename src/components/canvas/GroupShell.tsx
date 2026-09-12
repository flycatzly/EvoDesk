"use client";
import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CanvasWidget } from "@/lib/domain/canvas";
import { WIDGET_TYPE_LABELS } from "./widgetLabels";

export type ClientGroup = { key: string; groupTitle: string; widgets: CanvasWidget[] };

// 分组容器:编辑态 = 可拖动(标题栏为把手)+ 改名/删组/加组件;锁定态纯展示
export function GroupShell({
  group,
  index,
  editing,
  renderWidget,
  onRename,
  onDelete,
  onAddWidget,
  onRemoveWidget,
}: {
  group: ClientGroup;
  index: number;
  editing: boolean;
  renderWidget: (w: CanvasWidget) => React.ReactNode;
  onRename: (key: string, title: string) => void;
  onDelete: (key: string) => void;
  onAddWidget: (key: string, type: CanvasWidget["type"]) => void;
  onRemoveWidget: (key: string, widgetId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.key, data: { type: "group" } });
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(group.groupTitle);
  const [menuOpen, setMenuOpen] = useState(false);
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `${group.key}:drop`, data: { type: "group-drop", groupKey: group.key } });

  const commitRename = () => {
    setRenaming(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== group.groupTitle) onRename(group.key, trimmed);
    else setTitle(group.groupTitle);
  };

  return (
    <section
      ref={setNodeRef}
      className="surface p-3"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        {editing && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab shrink-0 text-xs"
            style={{ color: "var(--muted)" }}
            aria-label="拖动分组"
            title="拖动分组"
          >
            ⠿
          </button>
        )}
        {renaming ? (
          <input
            className="input text-sm flex-1 min-w-0"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setTitle(group.groupTitle); setRenaming(false); } }}
          />
        ) : (
          <h2
            className={`font-semibold text-sm truncate ${editing ? "cursor-text" : ""}`}
            title={editing ? "点击改名" : undefined}
            onClick={() => { if (editing) { setTitle(group.groupTitle); setRenaming(true); } }}
          >
            {group.groupTitle}
          </h2>
        )}
        {editing && (
          <button
            className="ml-auto shrink-0 text-xs hover:opacity-70"
            style={{ color: group.widgets.length === 0 ? "var(--danger)" : "var(--muted)" }}
            disabled={group.widgets.length > 0}
            onClick={() => onDelete(group.key)}
            title={group.widgets.length > 0 ? "仅空分组可删除" : "删除分组"}
          >
            删组
          </button>
        )}
      </div>

      <div ref={setDropRef} className={isOver && editing ? "rounded outline-2 outline-dashed" : ""} style={{ outlineColor: "var(--accent)" }}>
        <SortableContext items={group.widgets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {group.widgets.map((w) => (
              <WidgetSlot key={w.id} widget={w} groupKey={group.key} editing={editing} renderWidget={renderWidget} onRemove={onRemoveWidget} />
            ))}
          </div>
        </SortableContext>
      </div>

      {editing && (
        <div className="relative mt-2">
          <button className="ghost-btn text-xs w-full" onClick={() => setMenuOpen((v) => !v)}>
            ＋ 组件
          </button>
          {menuOpen && (
            <div className="absolute z-20 right-0 mt-1 surface p-1 grid grid-cols-3 gap-1 shadow-lg">
              {Object.entries(WIDGET_TYPE_LABELS).map(([type, label]) => (
                <button
                  key={type}
                  className="ghost-btn text-xs whitespace-nowrap"
                  onClick={() => { setMenuOpen(false); onAddWidget(group.key, type as CanvasWidget["type"]); }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <span className="hidden">{index}</span>
    </section>
  );
}

// 单个组件槽位:编辑态可拖动 + 删除;内容节点由服务端渲染后按 id 注入
function WidgetSlot({
  widget,
  groupKey,
  editing,
  renderWidget,
  onRemove,
}: {
  widget: CanvasWidget;
  groupKey: string;
  editing: boolean;
  renderWidget: (w: CanvasWidget) => React.ReactNode;
  onRemove: (groupKey: string, widgetId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    data: { type: "widget", groupKey },
    disabled: !editing,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined }}
      className="rounded p-2.5"
      {...(editing ? { ...attributes, ...listeners } : {})}
    >
      {editing && (
        <div className="flex justify-end mb-0.5">
          <button
            className="text-xs px-1 hover:opacity-70"
            style={{ color: "var(--danger)" }}
            onClick={() => onRemove(groupKey, widget.id)}
            aria-label="移除组件"
            title="移除组件"
          >
            ×
          </button>
        </div>
      )}
      {renderWidget(widget)}
    </div>
  );
}
