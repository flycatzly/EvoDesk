import { describe, expect, it } from "vitest";
import { THEMES, THEME_MAP, resolveTheme, THEME_BOOT_SCRIPT } from "./theme";

describe("theme presets", () => {
  it("7 套主题,id 唯一,均含 8 个变量键且为合法 hex", () => {
    expect(THEMES).toHaveLength(7);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(7);
    const KEYS = ["accent", "accent-2", "bg", "border", "muted", "surface", "surface-2", "text"].sort();
    for (const t of THEMES) {
      expect(Object.keys(t.vars).sort()).toEqual(KEYS);
      for (const v of Object.values(t.vars)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it("resolveTheme:旧值 dark/light 迁移;未知/空回退 dark-tech", () => {
    expect(resolveTheme("dark").id).toBe("dark-tech");
    expect(resolveTheme("light").id).toBe("blue-study");
    expect(resolveTheme("pink-ins").id).toBe("pink-ins");
    expect(resolveTheme("nope").id).toBe("dark-tech");
    expect(resolveTheme(undefined).id).toBe("dark-tech");
  });
  it("THEME_MAP 与 THEMES 一致;boot 脚本包含全部主题 id 与默认回退", () => {
    expect(THEME_MAP.size).toBe(7);
    for (const t of THEMES) expect(THEME_BOOT_SCRIPT).toContain(t.id);
    expect(THEME_BOOT_SCRIPT).toContain("dark-tech");
    expect(THEME_BOOT_SCRIPT).toContain("evodesk-theme");
  });
});
