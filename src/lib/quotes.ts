const QUOTES = [
  "专注当下的一件事,胜过计划十件事。",
  "把大象放进冰箱,也需要先打开门。",
  "今天的三个小步,胜过明天的一个大跃进。",
  "完成,好过完美。",
  "复杂度自适应:琐事快跑,大事深耕。",
  "记录它,然后放下它。",
  "进化来自复盘,不来自重复。",
  "先捕获,再分诊,后执行。",
  "你不需要更多工具,需要更少的犹豫。",
  "休息也是任务队列的一部分。",
];

export function quoteOfDay(d = new Date()): string {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((d.getTime() - start) / 86_400_000);
  return QUOTES[dayOfYear % QUOTES.length];
}
