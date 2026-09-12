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
  it("review → done 合法,running → review 合法(runner 完成聚合驱动,规格 §6),archived 终态", () => {
    expect(canTransition("review", "done")).toBe(true);
    expect(canTransition("running", "review")).toBe(true);
    expect(canTransition("waiting_human", "review")).toBe(true);
    expect(canTransition("archived", "done")).toBe(false);
  });
  it("勾选完成:inbox/triaging/ready → done 合法;done → ready 恢复合法", () => {
    expect(canTransition("inbox", "done")).toBe(true);
    expect(canTransition("triaging", "done")).toBe(true);
    expect(canTransition("ready", "done")).toBe(true);
    expect(canTransition("done", "ready")).toBe(true);
  });
  it("running/waiting_human 不可直达 done(防孤儿 flow_run)", () => {
    expect(canTransition("running", "done")).toBe(false);
    expect(canTransition("waiting_human", "done")).toBe(false);
  });
});
