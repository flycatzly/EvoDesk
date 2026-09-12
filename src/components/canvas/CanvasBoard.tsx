"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { GroupShell, type ClientGroup } from "./GroupShell";
import { WIDGET_TYPE_LABELS } from "./widgetLabels";
import { newWidgetId, type CanvasLayout, type CanvasWidget, type WidgetType } from "@/lib/domain/canvas";

type CanvasMeta = { id: string; name: string; columns: string; locked: boolean };
type CanvasListItem = { id: string; name: string };
type TemplateItem = { id: string; name: string };

const stripKeys = (groups: ClientGroup[]): CanvasLayout =>
  groups.map((g) => ({ groupTitle: g.groupTitle, widgets: g.widgets.map((w) => ({ id: w.id, type: w.type, config: w.config })) }));

// 布局结构的客户端校验副本(不引 zod 到 client bundle,只做结构性防御)
const isWidgetType = (v: unknown): v is WidgetType =>
  typeof v === "string" && Object.keys(WIDGET_TYPE_LABELS).includes(v);

export function CanvasBoard({
  canvas,
  layout,
  widgetNodes,
  canvases,
  templates,
  readOnly = false,
}: {
  canvas: CanvasMeta;
  layout: CanvasLayout;
  widgetNodes: Record<string, React.ReactNode>;
  canvases: CanvasListItem[];
  templates: TemplateItem[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [groups, setGroups] = useState<ClientGroup[]>(() =>
    layout.map((g, i) => ({ key: `g${i}_${Math.random().toString(36).slice(2, 8)}`, groupTitle: g.groupTitle, widgets: g.widgets })),
  );
  const [editing, setEditing] = useState(false);
  const [locked, setLocked] = useState(canvas.locked);
  const [columns, setColumns] = useState(canvas.columns);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [tplMenu, setTplMenu] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2500);
  };

  // —— 持久化:乐观更新,失败回滚 ——
  const persist = async (nextGroups: ClientGroup[]) => {
    const prev = groups;
    setGroups(nextGroups);
    try {
      const res = await fetch(`/api/canvases/${canvas.id}`, {
        method: "PUT",
        body: JSON.stringify({ layout: stripKeys(nextGroups) }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setGroups(prev);
      flash("布局保存失败,已回滚");
    }
  };

  const patchCanvas = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/canvases/${canvas.id}`, { method: "PUT", body: JSON.stringify(body) });
    if (res.ok) startTransition(() => router.refresh());
    else flash("保存失败");
  };

  // —— 拖拽:跨组搬运(onDragOver)+ 落定持久化(onDragEnd)——
  const findGroupOf = (key: string) => {
    const gi = groups.findIndex((g) => g.widgets.some((w) => w.id === key));
    return gi === -1 ? null : gi;
  };

  const moveWidget = (activeId: string, overId: string) => {
    const from = findGroupOf(activeId);
    if (from === null) return;
    let to = groups.findIndex((g) => g.widgets.some((w) => w.id === overId));
    let insertAt = to >= 0 ? groups[to].widgets.findIndex((w) => w.id === overId) : 0;
    if (to === -1) {
      // 落点是分组本身/分组投放区(id 形如 gX_drop 或分组 key)
      const gi = groups.findIndex((g) => g.key === overId || `${g.key}:drop` === overId);
      if (gi === -1) return;
      to = gi;
      insertAt = groups[gi].widgets.length;
    }
    if (to === -1) return;
    const next = groups.map((g) => ({ ...g, widgets: [...g.widgets] }));
    const [widget] = next[from].widgets.splice(next[from].widgets.findIndex((w) => w.id === activeId), 1);
    next[to].widgets.splice(insertAt, 0, widget);
    setGroups(next); // 搬运过程即时反映,真正持久化在 onDragEnd
  };

  const onDragOver = (e: DragOverEvent) => {
    if (!editing || !e.active.data.current || e.over === null) return;
    const activeType = e.active.data.current.type;
    const activeId = String(e.active.id);
    const overId = String(e.over.id);
    if (activeType === "widget" && activeId !== overId) moveWidget(activeId, overId);
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!editing || e.over === null) return;
    const activeType = e.active.data.current?.type;
    const activeId = String(e.active.id);
    const overId = String(e.over.id);
    if (activeType === "widget") {
      const current = findGroupOf(activeId);
      if (current !== null) {
        const target = groups[current];
        const from = target.widgets.findIndex((w) => w.id === activeId);
        const to = target.widgets.findIndex((w) => w.id === overId);
        if (from !== -1 && to !== -1 && from !== to) {
          const next = groups.map((g) => ({ ...g, widgets: [...g.widgets] }));
          const [w] = next[current].widgets.splice(from, 1);
          next[current].widgets.splice(to, 0, w);
          void persist(next);
          return;
        }
      }
      void persist(groups); // 跨组搬运已就位,落定即保存
    } else if (activeType === "group" && activeId !== overId) {
      const from = groups.findIndex((g) => g.key === activeId);
      const to = groups.findIndex((g) => g.key === overId || `${g.key}:drop` === overId);
      if (from !== -1 && to !== -1 && from !== to) {
        const next = [...groups];
        const [g] = next.splice(from, 1);
        next.splice(to, 0, g);
        void persist(next);
      }
    }
  };

  // —— 结构编辑 ——
  const addWidget = (groupKey: string, type: WidgetType) => {
    const w: CanvasWidget = { id: newWidgetId(), type, config: type === "todo" ? { scope: "today" } : {} };
    const next = groups.map((g) => (g.key === groupKey ? { ...g, widgets: [...g.widgets, w] } : g));
    void persist(next).then(() => startTransition(() => router.refresh())); // 新组件内容需服务端注入
  };
  const removeWidget = (groupKey: string, widgetId: string) => {
    void persist(groups.map((g) => (g.key === groupKey ? { ...g, widgets: g.widgets.filter((w) => w.id !== widgetId) } : g)));
  };
  const addGroup = () => {
    const key = `g_new_${Math.random().toString(36).slice(2, 8)}`;
    void persist([...groups, { key, groupTitle: "新分组", widgets: [] }]);
  };
  const renameGroup = (key: string, groupTitle: string) => {
    void persist(groups.map((g) => (g.key === key ? { ...g, groupTitle } : g)));
  };
  const deleteGroup = (key: string) => {
    void persist(groups.filter((g) => g.key !== key));
  };

  // —— 画布级操作 ——
  const toggleLock = async () => {
    const next = !locked;
    const res = await fetch(`/api/canvases/${canvas.id}`, { method: "PUT", body: JSON.stringify({ locked: next }) });
    if (res.ok) {
      setLocked(next);
      if (next) setEditing(false);
    } else flash("操作失败");
  };
  const createCanvas = async (fromTemplateId?: string) => {
    const res = await fetch("/api/canvases", {
      method: "POST",
      body: JSON.stringify(fromTemplateId ? { name: "新工作台", from_template: fromTemplateId } : { name: "新工作台" }),
    });
    const data = (await res.json().catch(() => null)) as { canvas?: { id: string } } | null;
    const newId = data?.canvas?.id;
    if (res.ok && newId) startTransition(() => router.push(`/?c=${newId}`));
    else flash("创建失败");
  };
  const deleteCanvas = async () => {
    if (canvases.length <= 1) {
      flash("至少保留一个工作台");
      return;
    }
    if (!window.confirm(`删除工作台「${canvas.name}」?其布局不可恢复。`)) return;
    const res = await fetch(`/api/canvases/${canvas.id}`, { method: "DELETE" });
    if (res.ok) startTransition(() => router.push("/"));
    else flash(res.status === 400 ? "内置模板不可删除" : "删除失败");
  };
  const genShare = async (revoke = false) => {
    const res = await fetch(`/api/canvases/${canvas.id}/share${revoke ? "?revoke=1" : ""}`, { method: "POST" });
    const data = (await res.json().catch(() => null)) as { shareToken?: string | null } | null;
    if (!res.ok) {
      flash("操作失败");
      return;
    }
    setShareUrl(data?.shareToken ? `${window.location.origin}/share/${data.shareToken}` : null);
  };
  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      flash("已复制分享链接");
    } catch {
      flash("复制失败,请手动选择链接");
    }
  };

  const renderWidget = (w: CanvasWidget) => {
    if (isWidgetType(w.type) && widgetNodes[w.id] !== undefined) return widgetNodes[w.id];
    return <div className="text-sm py-2" style={{ color: "var(--muted)" }}>组件加载中,刷新页面后显示。</div>;
  };

  const gridClass = useMemo(() => (columns === "3" ? "md:grid-cols-3" : "md:grid-cols-2"), [columns]);
  const canEdit = !locked && !readOnly;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
      {!readOnly && (
        <>
          <select
            className="input text-sm max-w-40"
            value={canvas.id}
            onChange={(e) => startTransition(() => router.push(`/?c=${e.target.value}`))}
            aria-label="切换工作台"
          >
            {canvases.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="ghost-btn text-xs" onClick={() => void createCanvas()}>＋ 新建</button>
          <div className="relative">
            <button className="ghost-btn text-xs" onClick={() => setTplMenu((v) => !v)}>模板</button>
            {tplMenu && (
              <div className="absolute z-20 left-0 mt-1 surface p-1 shadow-lg min-w-40">
                {templates.length === 0 && <div className="text-xs p-1.5" style={{ color: "var(--muted)" }}>暂无模板</div>}
                {templates.map((t) => (
                  <button
                    key={t.id}
                    className="ghost-btn text-xs w-full text-left"
                    onClick={() => { setTplMenu(false); void createCanvas(t.id); }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="ghost-btn text-xs" onClick={() => void deleteCanvas()}>删除</button>
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        {!readOnly && (
          <>
            <button
              className="ghost-btn text-xs"
              onClick={() => { const next = columns === "2" ? "3" : "2"; setColumns(next); void patchCanvas({ columns: next }); }}
              title="切换栏数"
            >
              {columns} 栏
            </button>
            {canEdit && (
              <button className="accent-btn text-xs" onClick={() => setEditing((v) => !v)}>
                {editing ? "完成编辑" : "编辑布局"}
              </button>
            )}
            <button
              className="ghost-btn text-xs"
              onClick={() => void toggleLock()}
              title={locked ? "布局已锁定,点击解锁" : "锁定布局,防止误拖拽"}
            >
              {locked ? "🔒 已锁定" : "🔓 未锁定"}
            </button>
            <button className="ghost-btn text-xs" onClick={() => { setShareUrl(null); void genShare(); }} title="生成只读分享链接">
              分享
            </button>
          </>
        )}
      </div>
      {editing && (
        <button className="ghost-btn text-xs" onClick={addGroup}>＋ 分组</button>
      )}
    </div>
  );

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-xl font-bold">{readOnly ? canvas.name : "工作台"}</h1>
        {locked && !readOnly && <span className="text-xs" style={{ color: "var(--muted)" }}>布局已锁定</span>}
        {notice && <span className="text-xs" style={{ color: "var(--warn)" }}>{notice}</span>}
      </div>
      {toolbar}
      {shareUrl !== null && (
        <div className="surface p-3 mb-4 text-sm">
          <div className="mb-1 font-medium">分享链接(只读)</div>
          {shareUrl ? (
            <>
              <div className="text-xs break-all mb-2" style={{ color: "var(--muted)" }}>{shareUrl}</div>
              <div className="flex gap-2">
                <button className="accent-btn text-xs" onClick={() => void copyShare()}>复制链接</button>
                <button className="ghost-btn text-xs" onClick={() => void genShare(true)}>吊销</button>
                <button className="ghost-btn text-xs" onClick={() => setShareUrl(null)}>关闭</button>
              </div>
            </>
          ) : (
            <div className="flex gap-2 items-center">
              <span className="text-xs" style={{ color: "var(--muted)" }}>当前无分享链接</span>
              <button className="accent-btn text-xs" onClick={() => void genShare()}>生成</button>
              <button className="ghost-btn text-xs" onClick={() => setShareUrl(null)}>关闭</button>
            </div>
          )}
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={groups.map((g) => g.key)} strategy={rectSortingStrategy}>
          <div className={`grid grid-cols-1 gap-4 ${gridClass}`}>
            {groups.map((g) => (
              <GroupShell
                key={g.key}
                group={g}
                index={groups.indexOf(g)}
                editing={editing}
                renderWidget={renderWidget}
                onRename={renameGroup}
                onDelete={deleteGroup}
                onAddWidget={addWidget}
                onRemoveWidget={removeWidget}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {groups.length === 0 && (
        <div className="surface p-6 text-center text-sm" style={{ color: "var(--muted)" }}>
          空画布 —— {canEdit ? "点击「＋ 分组」开始搭建你的信息聚合页,参考 新手帮助 页的最佳实践。" : "请让工作台主人添加内容。"}
        </div>
      )}
      {readOnly && (
        <div className="mt-6 text-center text-xs" style={{ color: "var(--muted)" }}>
          由 <Link href="/" style={{ color: "var(--accent)" }}>EvoDesk 工作台</Link> 分享 · 只读页面
        </div>
      )}
    </div>
  );
}
