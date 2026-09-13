import { describe, it, expect } from "vitest";
import { parseMcpServers } from "./mcp";
import { extractSkillMd, skillNameFromMd, slugify, isValidSkillSlug } from "./skill-create";

describe("parseMcpServers", () => {
  it("解析 mcpServers 段(name/command/args)", () => {
    const raw = JSON.stringify({
      mcpServers: {
        "filesystem": { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "D:\\docs"] },
        "weather": { command: "python", args: ["weather.py"] },
      },
      otherKey: 1,
    });
    const servers = parseMcpServers(raw);
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({ name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "D:\\docs"] });
  });
  it("无 mcpServers / 坏 JSON / 非对象条目 → 空或跳过", () => {
    expect(parseMcpServers("{}")).toEqual([]);
    expect(parseMcpServers("not json")).toEqual([]);
    const partial = parseMcpServers(JSON.stringify({ mcpServers: { bad: { foo: 1 }, ok: { command: "x" } } }));
    expect(partial).toEqual([{ name: "ok", command: "x", args: [] }]);
  });
});

describe("skill-create 提取", () => {
  const SKILL = ['---', 'name: pdf-merge', 'description: 合并 PDF 时使用', '---', '', '# PDF 合并', '步骤…'].join("\n");
  it("extractSkillMd:含「最终 SKILL.md」标记 + 围栏 → 提取围栏内容", () => {
    const reply = `好的,信息足够了。\n\n最终 SKILL.md\n\n\`\`\`markdown\n${SKILL}\n\`\`\``;
    expect(extractSkillMd(reply)).toBe(SKILL);
  });
  it("未到最终轮(无标记)→ null;围栏非 frontmatter → null", () => {
    expect(extractSkillMd("我还想问:这个技能用在什么场景?")).toBeNull();
    expect(extractSkillMd("最终 SKILL.md\n```markdown\n# 没有 frontmatter\n```")).toBeNull();
  });
  it("skillNameFromMd / slugify / isValidSkillSlug", () => {
    expect(skillNameFromMd(SKILL, "fallback")).toBe("pdf-merge");
    expect(slugify("合并 PDF 工具!")).toBe("pdf");
    expect(isValidSkillSlug("pdf-merge")).toBe(true);
    expect(isValidSkillSlug("Bad_Name")).toBe(false);
    expect(skillNameFromMd("no frontmatter", "fallback")).toBe("fallback");
  });
});
