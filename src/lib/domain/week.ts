// 周口径:一周 = 本地时区的周一 00:00 至下周一 00:00。
// DB 存储恒为 UTC-ISO(与 tz.ts 约定一致),此模块只决定"本周"的边界,不改存储。
// DST 说明:偏移按周一锚点处的当日偏移计算,跨夏令时切换的周末边界可能有 ±1h 误差,个人工具可接受。

/** ISO 时间 → IANA 时区下的 yyyy-mm-dd(非法时区回退 UTC 日) */
export function localDateIso(iso: string, timezone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** 该时区在 instant 处的偏移(本地墙钟 - UTC,毫秒)。非法时区回退 0(即按 UTC)。 */
function tzOffsetMs(instant: Date, timezone?: string | null): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(instant);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return wallAsUtc - instant.getTime();
  } catch {
    return 0;
  }
}

/** 本地"周一 00:00"对应的 UTC 时刻(ISO 字符串)。非法时区时按 UTC 日历周一 00:00。 */
export function weekStartInstant(nowIso: string, timezone?: string | null): string {
  const localDate = localDateIso(nowIso, timezone); // yyyy-mm-dd
  const [y, m, d] = localDate.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const dow = (probe.getUTCDay() + 6) % 7; // 周一=0 … 周日=6
  probe.setUTCDate(probe.getUTCDate() - dow);
  const offset = tzOffsetMs(probe, timezone);
  return new Date(probe.getTime() - offset).toISOString();
}

/** 本周 7 个本地日(yyyy-mm-dd,周一 → 周日) */
export function weekDates(nowIso: string, timezone?: string | null): string[] {
  const [y, m, d] = localDateIso(nowIso, timezone).split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const dow = (probe.getUTCDay() + 6) % 7;
  probe.setUTCDate(probe.getUTCDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(probe);
    dt.setUTCDate(dt.getUTCDate() + i);
    return dt.toISOString().slice(0, 10);
  });
}

/** iso 是否落在本周(本地周一 00:00 含、下周一 00:00 排) */
export function inWeek(iso: string, nowIso: string, timezone?: string | null): boolean {
  const start = new Date(weekStartInstant(nowIso, timezone)).getTime();
  const end = start + 7 * 86_400_000;
  const t = new Date(iso).getTime();
  return t >= start && t < end;
}
