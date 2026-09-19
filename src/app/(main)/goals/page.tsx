import { CheckinHeatmap } from "@/components/CheckinHeatmap";
import { GoalsView } from "@/components/GoalsView";

export const dynamic = "force-dynamic";

export default function GoalsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">目标进度</h1>
      <CheckinHeatmap />
      <GoalsView />
    </div>
  );
}
