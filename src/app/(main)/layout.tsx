import type { ReactNode } from "react";
import { DesktopPet } from "@/components/DesktopPet";
import { MobileNav } from "@/components/MobileNav";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

// 应用外壳布局:除 /share(只读分享,独立布局)外的所有页面挂侧栏 + 顶栏 + 移动导航 + 桌宠
export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 p-4 pb-20 md:p-6">{children}</main>
      </div>
      <MobileNav />
      <DesktopPet />
    </>
  );
}
