import { getDb } from "@/lib/db/client";
import { readSettingsKv } from "@/lib/db/read-settings";
import { SettingsForm } from "@/components/SettingsForm";
import { ThemeToggle } from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const kv = readSettingsKv(getDb());
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
