// 分工:recurring.ts 的 due 生成逻辑不变,仍按 UTC-midnight 生成(DB 存储恒为 UTC-ISO);
// "今天"的分桶边界由展示层 tzToday 按用户时区决定——存储不变、边界本地化。

/** 按 IANA 时区名(空/undefined/null=系统本地)返回 yyyy-mm-dd 的"今天"。DB 存储恒为 UTC-ISO,此函数只影响展示/分桶边界。 */
export function tzToday(timeZone?: string | null): string {
  try {
    return new Date().toLocaleDateString("en-CA", timeZone ? { timeZone } : undefined);
  } catch {
    return new Date().toISOString().slice(0, 10); // 非法 IANA 名回退 UTC 日期
  }
}
