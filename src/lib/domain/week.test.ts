import { describe, expect, it } from "vitest";
import { localDateIso, weekStartInstant, weekDates, inWeek } from "./week";

describe("week", () => {
  // 2026-09-13 是周日;Asia/Shanghai 本周周一 00:00(本地)= 2026-09-06T16:00Z
  it("weekStartInstant 返回本地周一 00:00 对应的 UTC 时刻", () => {
    expect(weekStartInstant("2026-09-13T10:00:00Z", "Asia/Shanghai")).toBe("2026-09-06T16:00:00.000Z");
    // 纽约(UTC-4):本地周一 00:00 = 周一 04:00Z
    expect(weekStartInstant("2026-09-13T10:00:00Z", "America/New_York")).toBe("2026-09-07T04:00:00.000Z");
  });
  it("weekDates 返回 7 个本地日(周一 → 周日)", () => {
    const dates = weekDates("2026-09-13T10:00:00Z", "Asia/Shanghai");
    expect(dates[0]).toBe("2026-09-07");
    expect(dates[6]).toBe("2026-09-13");
    expect(dates).toHaveLength(7);
  });
  it("inWeek 按本地周边界判断(起点含、下周起点排)", () => {
    const now = "2026-09-13T10:00:00Z";
    expect(inWeek("2026-09-08T02:00:00Z", now, "Asia/Shanghai")).toBe(true); // 周二 10:00 本地
    expect(inWeek("2026-09-06T16:00:00Z", now, "Asia/Shanghai")).toBe(true); // 周一 00:00 本地(含)
    expect(inWeek("2026-09-06T15:59:59Z", now, "Asia/Shanghai")).toBe(false); // 周日 23:59:59 本地(上周)
    expect(inWeek("2026-09-13T16:00:00Z", now, "Asia/Shanghai")).toBe(false); // 下周一 00:00 本地(排)
    expect(inWeek("2026-09-01T02:00:00Z", now, "Asia/Shanghai")).toBe(false);
  });
  it("localDateIso 非法时区回退 UTC 日", () => {
    expect(localDateIso("2026-09-13T10:00:00Z", "Not/AZone")).toBe("2026-09-13");
  });
});
