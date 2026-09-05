import { describe, it, expect } from "vitest";
import { canTransition } from "./status";

describe("task status machine", () => {
  it("inbox → triaging/ready/canceled 合法", () => {
    expect(canTransition("inbox", "triaging")).toBe(true);
    expect(canTransition("inbox", "ready")).toBe(true);
    expect(canTransition("inbox", "canceled")).toBe(true);
  });
  it("inbox → running 非法", () => {
    expect(canTransition("inbox", "running")).toBe(false);
  });
  it("done → archived 合法,archived 终态", () => {
    expect(canTransition("done", "archived")).toBe(true);
    expect(canTransition("archived", "done")).toBe(false);
  });
  it("canceled 可回 inbox(重新打开)", () => {
    expect(canTransition("canceled", "inbox")).toBe(true);
  });
  it("review → done 合法,running → review 非法(须经 waiting_human 之外路径允许取消)", () => {
    expect(canTransition("review", "done")).toBe(true);
    expect(canTransition("running", "review")).toBe(false);
  });
});
