import { describe, it, expect } from "vitest";
import { tzToday } from "./tz";

describe("tzToday", () => {
  it("IANA 名返回合法 yyyy-mm-dd", () => {
    expect(tzToday("Asia/Shanghai")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("非法时区回退 UTC 不抛", () => {
    expect(tzToday("Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("null/undefined 跟随系统不抛", () => {
    expect(tzToday(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tzToday(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
