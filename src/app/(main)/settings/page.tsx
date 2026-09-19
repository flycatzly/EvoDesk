import { getDb } from "@/lib/db/client";
import { readSettingsKv } from "@/lib/db/read-settings";
import { SettingsForm } from "@/components/SettingsForm";
import { ThemePicker } from "@/components/ThemePicker";
import { BackupForm } from "@/components/BackupForm";
import { NotifySettings } from "@/components/NotifySettings";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const kv = readSettingsKv(getDb());
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-4">设置</h1>
      <div className="surface p-4 mb-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm">主题风格</span>
        <ThemePicker />
        <span className="text-xs" style={{ color: "var(--muted)" }}>7 套预设即时生效,保存在浏览器;重要数据请定期在下方备份。</span>
      </div>
      <SettingsForm initial={kv} />
      <div className="mt-4">
        <NotifySettings initial={kv.notify} />
      </div>
      <div className="mt-4">
        <BackupForm />
      </div>
    </div>
  );
}
