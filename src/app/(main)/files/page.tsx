import { FileOrganizerView } from "@/components/FileOrganizerView";

export const dynamic = "force-dynamic";

// 本地文件整理:白名单目录的类型统计、智能分类移动、同内容去重(移入重复区,不删除)
export default function FilesPage() {
  return <FileOrganizerView />;
}
