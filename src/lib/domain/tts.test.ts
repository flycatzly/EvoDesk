import { describe, it, expect } from "vitest";
import { splitTextForTts, concatWavs } from "./tts";

function makeWav(pcmBytes: number): Buffer {
  const b = Buffer.alloc(44 + pcmBytes);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + pcmBytes, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24);
  b.writeUInt32LE(44100 * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(pcmBytes, 40);
  return b;
}

describe("splitTextForTts(回归:2026-09-23 转语音文字未全部转换)", () => {
  it("长文本按句切分为 ≤140 字的分段,内容不丢失", () => {
    const text = "第一句话。第二句话!第三句话?" + "很长的句子".repeat(40);
    const chunks = splitTextForTts(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 140)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });
  it("短文本不分段;换行内容不丢失", () => {
    expect(splitTextForTts("你好。")).toEqual(["你好。"]);
    const twoLines = `第一行
第二行`;
    expect(splitTextForTts(twoLines)).toEqual([twoLines]);
  });
  it("换行是切分点:合计超限的两行拆成两段", () => {
    const long = `${"甲".repeat(100)}\n${"乙".repeat(100)}`;
    const chunks = splitTextForTts(long);
    expect(chunks.length).toBe(2);
    expect(chunks[0].endsWith("甲")).toBe(true);
    expect(chunks[1].startsWith("乙")).toBe(true);
  });
});

describe("concatWavs", () => {
  it("同格式 WAV 拼接:data 块合并,头重建为总长", () => {
    const a = makeWav(1000);
    const b = makeWav(2000);
    const out = concatWavs([a, b]);
    expect(out.slice(0, 4).toString()).toBe("RIFF");
    expect(out.readUInt32LE(40)).toBe(3000);
    expect(out.length).toBe(44 + 3000);
  });
  it("单个 WAV 原样返回", () => {
    const a = makeWav(500);
    expect(concatWavs([a])).toBe(a);
  });
});
