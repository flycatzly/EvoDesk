// 7 套主题预设(docs/1.png 风格清单落色):每套 = 8 个 CSS 变量 + 是否深色。
// 低饱和原则:主色饱和度 ≤60%,accent 只用于强调。storage key 沿用 evodesk-theme。
// 旧值迁移:dark → dark-tech,light → blue-study(旧浅色为蓝白基调)。

export type ThemeVars = {
  bg: string; surface: string; "surface-2": string; text: string;
  muted: string; border: string; accent: string; "accent-2": string;
};
export type Theme = { id: string; label: string; dark: boolean; vars: ThemeVars };

export const THEMES: Theme[] = [
  {
    id: "pink-ins", label: "粉色 Ins 风", dark: false,
    vars: { bg: "#faf6f7", surface: "#ffffff", "surface-2": "#f6e9ee", text: "#4a3d44", muted: "#a38e98", border: "#eddfe6", accent: "#d97a95", "accent-2": "#e8a3b7" },
  },
  {
    id: "mint-fresh", label: "薄荷清新风", dark: false,
    vars: { bg: "#f4faf8", surface: "#ffffff", "surface-2": "#e4f2ec", text: "#2e443c", muted: "#7d968c", border: "#d7e8e0", accent: "#4dae94", "accent-2": "#7fcbb4" },
  },
  {
    id: "cream-journal", label: "奶油手账风", dark: false,
    vars: { bg: "#faf7f0", surface: "#fffdf8", "surface-2": "#f3ecdd", text: "#4c4335", muted: "#9a8d76", border: "#e8dfcc", accent: "#c9a35c", "accent-2": "#dcc08a" },
  },
  {
    id: "blue-study", label: "蓝白学习风", dark: false,
    vars: { bg: "#f5f8fc", surface: "#ffffff", "surface-2": "#e8f0f9", text: "#2c3a4e", muted: "#7a8ba0", border: "#dbe6f2", accent: "#4a86c8", "accent-2": "#7fb0dc" },
  },
  {
    id: "minimal-pro", label: "极简效率风", dark: false,
    vars: { bg: "#fafafa", surface: "#ffffff", "surface-2": "#f0f0f0", text: "#262626", muted: "#8c8c8c", border: "#e5e5e5", accent: "#404040", "accent-2": "#737373" },
  },
  {
    id: "xfc", label: "xfc 风", dark: false,
    vars: { bg: "#fbfaf7", surface: "#ffffff", "surface-2": "#f2f1ec", text: "#33322e", muted: "#8f8d84", border: "#e6e4dc", accent: "#e08a3c", "accent-2": "#8faa8b" },
  },
  {
    id: "dark-tech", label: "深色科技风", dark: true,
    vars: { bg: "#0b0d14", surface: "#141725", "surface-2": "#1b1f31", text: "#e7e9f4", muted: "#8a90a8", border: "#252a40", accent: "#6366f1", "accent-2": "#8b5cf6" },
  },
];

export const THEME_MAP: Map<string, Theme> = new Map(THEMES.map((t) => [t.id, t]));
export const DEFAULT_THEME_ID = "dark-tech";

export function resolveTheme(id?: string | null): Theme {
  if (id === "dark") return THEME_MAP.get("dark-tech")!;
  if (id === "light") return THEME_MAP.get("blue-study")!;
  return (id && THEME_MAP.get(id)) || THEME_MAP.get(DEFAULT_THEME_ID)!;
}

/** 客户端切换主题:写变量 + 切 .dark 类(供依赖 .dark 的遗留规则) */
export function applyThemeVars(doc: Document, theme: Theme): void {
  const style = doc.documentElement.style;
  for (const [k, v] of Object.entries(theme.vars)) style.setProperty(`--${k}`, v);
  doc.documentElement.classList.toggle("dark", theme.dark);
}

/** 首屏无闪变:layout.tsx <head> 内联执行,主题 JSON 内嵌,localStorage 旧值在此迁移 */
const BOOT_DATA = JSON.stringify(THEMES.map((t) => ({ id: t.id, dark: t.dark, vars: t.vars })));
export const THEME_BOOT_SCRIPT = `(function(){try{var T=${BOOT_DATA};var id=null;try{id=localStorage.getItem("evodesk-theme")}catch(e){}
if(id==="dark")id="dark-tech";if(id==="light")id="blue-study";
var t=null;for(var i=0;i<T.length;i++){if(T[i].id===id)t=T[i];}
if(!t)t=T[T.length-1];
var s=document.documentElement.style;for(var k in t.vars){s.setProperty("--"+k,t.vars[k]);}
document.documentElement.classList.toggle("dark",!!t.dark);}catch(e){document.documentElement.classList.add("dark");}})();`;
