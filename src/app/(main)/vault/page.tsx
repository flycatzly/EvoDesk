import { getDb } from "@/lib/db/client";
import { getVaultRoot } from "@/lib/domain/vault";
import { VaultView } from "@/components/VaultView";

export const dynamic = "force-dynamic";

// 不在服务端读 vault:可能未配置/目录不存在,全部由客户端经 API 加载并在 UI 呈现空态/错误态;
// 这里仅判断 settings.vault_path 是否已配置,供引导文案使用。
export default function VaultPage() {
  const vaultConfigured = getVaultRoot(getDb()) !== null;
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">知识库</h1>
      <VaultView vaultConfigured={vaultConfigured} />
    </div>
  );
}
