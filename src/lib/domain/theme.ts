// 主题 = 色板(vars)+ 风格包(styleVars:圆角/字体/阴影/背景纹理等排版变量)+ data-style 装饰。
// 排版差异落在 CSS 变量 + globals.css 的 html[data-style=…] 规则上(标题装饰、悬停效果、图案背景)。
// 低饱和原则:主色饱和度 ≤60%。storage key 沿用 evodesk-theme。旧值迁移:dark→dark-tech,light→blue-study。

export type ThemeVars = {
  bg: string; surface: string; "surface-2": string; text: string;
  muted: string; border: string; accent: string; "accent-2": string;
};

/** 排版风格包:全部是合法 CSS 声明值,boot 时写入同名 CSS 变量 */
export type ThemeStyleVars = {
  "radius-card": string;
  "radius-btn": string;
  "font-body": string;
  "font-heading": string;
  "card-shadow": string;
  "h1-decor": string; // content 字符串(含引号),经 html[data-style] 规则或 content: var() 使用
  "body-bg": string; // 完整 background 值(可含纹理图层)
};

export type Theme = {
  id: string;
  label: string;
  dark: boolean;
  vars: ThemeVars;
  style: ThemeStyleVars;
};

const SYS_UI = "'Segoe UI', 'Microsoft YaHei UI', system-ui, sans-serif";
const ROUNDED_CUTE = "'幼圆', 'Yuanti SC', 'Segoe UI', 'Microsoft YaHei UI', system-ui, sans-serif";
const SERIF_JOURNAL = "Georgia, '楷体', 'KaiTi', 'STKaiti', serif";

export const THEMES: Theme[] = [
  {
    id: "pink-ins", label: "粉色 Ins 风", dark: false,
    vars: { bg: "#faf6f7", surface: "#ffffff", "surface-2": "#f6e9ee", text: "#4a3d44", muted: "#a38e98", border: "#eddfe6", accent: "#d97a95", "accent-2": "#e8a3b7" },
    style: {
      "radius-card": "18px", "radius-btn": "999px",
      "font-body": ROUNDED_CUTE, "font-heading": ROUNDED_CUTE,
      "card-shadow": "0 6px 18px rgba(217, 122, 149, 0.12)",
      "h1-decor": "'🌸 '",
      "body-bg": "radial-gradient(circle at 12px 12px, rgba(217,122,149,0.06) 2px, transparent 2.5px) 0 0 / 28px 28px, #faf6f7",
    },
  },
  {
    id: "neko-cute", label: "猫爪可爱风", dark: false,
    vars: { bg: "#fbf6ef", surface: "#fffdf9", "surface-2": "#f6ecdf", text: "#4d4038", muted: "#a5927f", border: "#ecdcc7", accent: "#e8925d", "accent-2": "#d9a7c2" },
    style: {
      "radius-card": "22px", "radius-btn": "999px",
      "font-body": ROUNDED_CUTE, "font-heading": ROUNDED_CUTE,
      "card-shadow": "0 5px 0 rgba(232, 146, 93, 0.18)",
      "h1-decor": "'🐾 '",
      "body-bg":
        "radial-gradient(circle at 8px 8px, rgba(232,146,93,0.10) 3.5px, transparent 4px), radial-gradient(circle at 20px 4px, rgba(217,167,194,0.10) 2px, transparent 2.5px), radial-gradient(circle at 20px 13px, rgba(217,167,194,0.10) 2px, transparent 2.5px) 0 0 / 32px 26px, #fbf6ef",
    },
  },
  {
    id: "anime", label: "二次元动漫风", dark: false,
    vars: { bg: "#f7f5fd", surface: "#ffffff", "surface-2": "#efecfb", text: "#38304e", muted: "#8d84a8", border: "#e0dbf2", accent: "#8b6ce0", "accent-2": "#e77fb3" },
    style: {
      "radius-card": "16px", "radius-btn": "12px",
      "font-body": SYS_UI, "font-heading": ROUNDED_CUTE,
      "card-shadow": "0 8px 24px rgba(139, 108, 224, 0.16)",
      "h1-decor": "'✨ '",
      "body-bg":
        "radial-gradient(ellipse 60% 40% at 85% -5%, rgba(231,127,179,0.14), transparent), radial-gradient(ellipse 50% 35% at 0% 100%, rgba(139,108,224,0.12), transparent), #f7f5fd",
    },
  },
  {
    id: "mint-fresh", label: "薄荷清新风", dark: false,
    vars: { bg: "#f4faf8", surface: "#ffffff", "surface-2": "#e4f2ec", text: "#2e443c", muted: "#7d968c", border: "#d7e8e0", accent: "#4dae94", "accent-2": "#7fcbb4" },
    style: {
      "radius-card": "12px", "radius-btn": "10px",
      "font-body": SYS_UI, "font-heading": SYS_UI,
      "card-shadow": "none",
      "h1-decor": "'🌿 '",
      "body-bg": "#f4faf8",
    },
  },
  {
    id: "cream-journal", label: "奶油手账风", dark: false,
    vars: { bg: "#faf7f0", surface: "#fffdf8", "surface-2": "#f3ecdd", text: "#4c4335", muted: "#9a8d76", border: "#e8dfcc", accent: "#c9a35c", "accent-2": "#dcc08a" },
    style: {
      "radius-card": "10px", "radius-btn": "8px",
      "font-body": SERIF_JOURNAL, "font-heading": SERIF_JOURNAL,
      "card-shadow": "0 3px 10px rgba(201, 163, 92, 0.10)",
      "h1-decor": "'📌 '",
      "body-bg": "repeating-linear-gradient(0deg, transparent 0 27px, rgba(201,163,92,0.07) 27px 28px), #faf7f0",
    },
  },
  {
    id: "blue-study", label: "蓝白学习风", dark: false,
    vars: { bg: "#f5f8fc", surface: "#ffffff", "surface-2": "#e8f0f9", text: "#2c3a4e", muted: "#7a8ba0", border: "#dbe6f2", accent: "#4a86c8", "accent-2": "#7fb0dc" },
    style: {
      "radius-card": "8px", "radius-btn": "8px",
      "font-body": SYS_UI, "font-heading": SYS_UI,
      "card-shadow": "none",
      "h1-decor": "'📘 '",
      "body-bg": "#f5f8fc",
    },
  },
  {
    id: "minimal-pro", label: "极简效率风", dark: false,
    vars: { bg: "#fafafa", surface: "#ffffff", "surface-2": "#f0f0f0", text: "#262626", muted: "#8c8c8c", border: "#e5e5e5", accent: "#404040", "accent-2": "#737373" },
    style: {
      "radius-card": "4px", "radius-btn": "4px",
      "font-body": SYS_UI, "font-heading": SYS_UI,
      "card-shadow": "none",
      "h1-decor": "''",
      "body-bg": "#fafafa",
    },
  },
  {
    id: "xfc", label: "xfc 风", dark: false,
    vars: { bg: "#fbfaf7", surface: "#ffffff", "surface-2": "#f2f1ec", text: "#33322e", muted: "#8f8d84", border: "#e6e4dc", accent: "#e08a3c", "accent-2": "#8faa8b" },
    style: {
      "radius-card": "6px", "radius-btn": "6px",
      "font-body": SYS_UI, "font-heading": SYS_UI,
      "card-shadow": "0 1px 3px rgba(51, 50, 46, 0.06)",
      "h1-decor": "''",
      "body-bg": "radial-gradient(circle at 3px 3px, rgba(143,170,139,0.05) 1px, transparent 1.5px) 0 0 / 12px 12px, #fbfaf7",
    },
  },
  {
    id: "dark-tech", label: "深色科技风", dark: true,
    vars: { bg: "#0b0d14", surface: "#141725", "surface-2": "#1b1f31", text: "#e7e9f4", muted: "#8a90a8", border: "#252a40", accent: "#6366f1", "accent-2": "#8b5cf6" },
    style: {
      "radius-card": "14px", "radius-btn": "10px",
      "font-body": SYS_UI, "font-heading": SYS_UI,
      "card-shadow": "0 0 0 1px rgba(99, 102, 241, 0.08), 0 4px 20px rgba(0, 0, 0, 0.35)",
      "h1-decor": "'◆ '",
      "body-bg": "radial-gradient(ellipse 55% 40% at 90% -10%, rgba(99,102,241,0.08), transparent), #0b0d14",
    },
  },
];

export const THEME_MAP: Map<string, Theme> = new Map(THEMES.map((t) => [t.id, t]));
export const DEFAULT_THEME_ID = "dark-tech";

export function resolveTheme(id?: string | null): Theme {
  if (id === "dark") return THEME_MAP.get("dark-tech")!;
  if (id === "light") return THEME_MAP.get("blue-study")!;
  return (id && THEME_MAP.get(id)) || THEME_MAP.get(DEFAULT_THEME_ID)!;
}

/** 客户端切换主题:写色板 + 风格包变量、切 data-style 与 .dark 类 */
export function applyThemeVars(doc: Document, theme: Theme): void {
  const root = doc.documentElement;
  const style = root.style;
  for (const [k, v] of Object.entries(theme.vars)) style.setProperty(`--${k}`, v);
  for (const [k, v] of Object.entries(theme.style)) style.setProperty(`--${k}`, v);
  root.dataset.style = theme.id;
  root.classList.toggle("dark", theme.dark);
}

/** 首屏无闪变:layout.tsx <head> 内联执行,主题 JSON 内嵌,localStorage 旧值在此迁移 */
const BOOT_DATA = JSON.stringify(
  THEMES.map((t) => ({ id: t.id, dark: t.dark, vars: t.vars, style: t.style })),
);
export const THEME_BOOT_SCRIPT = `(function(){try{var T=${BOOT_DATA};var id=null;try{id=localStorage.getItem("evodesk-theme")}catch(e){}
if(id==="dark")id="dark-tech";if(id==="light")id="blue-study";
var t=null;for(var i=0;i<T.length;i++){if(T[i].id===id)t=T[i];}
if(!t)t=T[T.length-1];
var s=document.documentElement.style;
for(var k in t.vars){s.setProperty("--"+k,t.vars[k]);}
for(var k2 in t.style){s.setProperty("--"+k2,t.style[k2]);}
document.documentElement.dataset.style=t.id;
document.documentElement.classList.toggle("dark",!!t.dark);}catch(e){document.documentElement.classList.add("dark");}})();`;
