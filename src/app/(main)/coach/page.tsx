import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// 需求教练已并入对话台(/chat):教练会话在对话台「🏃 教练对话」按钮创建,
// 会话管理中带 🏃 标记;旧入口重定向到对话台。
export default function CoachPage() {
  redirect("/chat");
}
