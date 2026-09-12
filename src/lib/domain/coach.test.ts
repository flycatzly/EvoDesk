import { describe, expect, it } from "vitest";
import { COACH_MAX_ROUNDS, coachRoundsUsed, coachSystemPrompt, isFinalPrompt } from "./coach";

describe("coach", () => {
  it("轮次提示随 roundsUsed 递减,用尽后要求直接输出最终提示词", () => {
    expect(coachSystemPrompt(0)).toContain("还剩最多 6 轮");
    expect(COACH_MAX_ROUNDS).toBe(6);
    expect(coachSystemPrompt(3)).toContain("已完成 3 轮");
    const done = coachSystemPrompt(6);
    expect(done).toContain("不再提问");
    expect(done).toContain("最终搭建提示词");
  });
  it("coachRoundsUsed 非负", () => {
    expect(coachRoundsUsed(4)).toBe(4);
    expect(coachRoundsUsed(-1)).toBe(0);
  });
  it("isFinalPrompt 识别最终提示词标记", () => {
    expect(isFinalPrompt("最终搭建提示词\n## 目标")).toBe(true);
    expect(isFinalPrompt("那么你想先解决哪个痛点?")).toBe(false);
  });
});
