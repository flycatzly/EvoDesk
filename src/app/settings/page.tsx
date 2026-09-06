import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { SettingsForm } from "@/components/SettingsForm";
import { ThemeToggle } from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const rows = getDb().select().from(settings).all() as { key: string; value: string }[];
  const kv: Record<string, unknown> = {};
  for (const r of rows) { try { kv[r.key] = JSON.parse(r.value); } catch { kv[r.key] = r.value; } }
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-4">设置</h1>
      <div className="surface p-4 mb-4 flex items-center gap-3">
        <span className="text-sm">外观主题</span>
        <ThemeToggle />
        <span className="text-xs" style={{ color: "var(--muted)" }}>深色为默认;切换会保存在浏览器。</span>
      </div>
      <SettingsForm initial={kv} />
    </div>
  );
}
