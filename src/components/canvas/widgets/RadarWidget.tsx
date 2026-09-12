import { RadarCard, type RadarItem } from "@/components/RadarCard";

// 风险雷达组件:复用仪表盘 RadarCard(数据由服务端 buildRadarItems 计算)
export function RadarWidget({ items }: { items: RadarItem[] }) {
  return <RadarCard items={items} />;
}
