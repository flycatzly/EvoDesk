import { PermissionView } from "@/components/PermissionView";

export const dynamic = "force-dynamic";

// 权限管控:模块展示控制(全局开关 + 工作台差异化白名单)
export default function PermissionsPage() {
  return <PermissionView />;
}
