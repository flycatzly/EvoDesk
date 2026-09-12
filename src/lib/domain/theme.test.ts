import { describe, expect, it } from "vitest";
import { THEMES, THEME_MAP, resolveTheme, THEME_BOOT_SCRIPT, applyThemeVars } from "./theme";

const COLOR_KEYS = ["accent", "accent-2", "bg", "border", "muted", "surface", "surface-2", "text"].sort();
const STYLE_KEYS = ["body-bg", "card-shadow", "font-body", "font-heading", "h1-decor", "radius-btn", "radius-card"].sort();

describe("theme presets", () => {
  it("9 套主题,id 唯一;色板 8 键 + 风格包 7 键且色板均为合法 hex", () => {
    expect(THEMES).toHaveLength(9);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(9);
    for (const t of THEMES) {
      expect(Object.keys(t.vars).sort()).toEqual(COLOR_KEYS);
      expect(Object.keys(t.style).sort()).toEqual(STYLE_KEYS);
      for (const v of Object.values(t.vars)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it("风格包差异:圆角/字体/装饰随主题性格变化(可爱系圆、极简方、手账衬线)", () => {
    const by = (id: string) => THEME_MAP.get(id)!.style;
    expect(by("neko-cute")["radius-card"]).toBe("22px"); // 猫爪:超圆
    expect(by("minimal-pro")["radius-card"]).toBe("4px"); // 极简:近直角
    expect(by("pink-ins")["h1-decor"]).toContain("🌸");
    expect(by("neko-cute")["h1-decor"]).toContain("🐾");
    expect(by("anime")["h1-decor"]).toContain("✨");
    expect(by("cream-journal")["font-heading"]).toContain("KaiTi"); // 手账:衬线/楷体
    expect(by("neko-cute")["card-shadow"]).toMatch(/^0 5px 0/); // 肉垫式立体阴影
    expect(by("anime")["body-bg"]).toContain("radial-gradient"); // 动漫:光晕背景
  });
  it("resolveTheme:旧值 dark/light 迁移;未知/空回退 dark-tech", () => {
    expect(resolveTheme("dark").id).toBe("dark-tech");
    expect(resolveTheme("light").id).toBe("blue-study");
    expect(resolveTheme("neko-cute").id).toBe("neko-cute");
    expect(resolveTheme("nope").id).toBe("dark-tech");
    expect(resolveTheme(undefined).id).toBe("dark-tech");
  });
  it("THEME_MAP 一致;boot 脚本含全部 id、风格包键与 data-style 设置", () => {
    expect(THEME_MAP.size).toBe(9);
    for (const t of THEMES) expect(THEME_BOOT_SCRIPT).toContain(t.id);
    expect(THEME_BOOT_SCRIPT).toContain("dataset.style");
    expect(THEME_BOOT_SCRIPT).toContain("radius-card");
  });
  it("applyThemeVars 写入色板/风格包变量与 data-style(无 DOM 环境用最小桩)", () => {
    const style = new Map<string, string>();
    const doc = {
      documentElement: {
        style: { setProperty: (k: string, v: string) => style.set(k, v) },
        dataset: {} as Record<string, string>,
        classList: { toggle: () => {} },
      },
    } as unknown as Document;
    applyThemeVars(doc, resolveTheme("neko-cute"));
    expect(style.get("--accent")).toBe("#e8925d");
    expect(style.get("--radius-card")).toBe("22px");
    expect(style.get("--h1-decor")).toBe("'🐾 '");
  });
});
