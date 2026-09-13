// 链接目录整理领域层:自动分类规则、归纳合并提案、URL 去重。
// 全部为纯函数提案 + 显式应用,绝不静默改数据;规则命中不改动用户手工维护的分类。
export type LinkRowLite = { id: string; title: string; url: string; category: string; sort: number; createdAt: string };

/** 视为"杂物"的分类:浏览器导入残留/默认兜底,自动分类只重排这些分类下的链接 */
export const JUNK_CATEGORIES = ["收藏夹", "书签栏", "已导入", "常用", "其他", "未分类"] as const;
export const isJunkCategory = (c: string): boolean => (JUNK_CATEGORIES as readonly string[]).includes(c);

type AutoRule = { category: string; hosts: string[]; keywords?: string[] };

// 域名/关键词 → 分类规则(按序首中即止;host 为包含匹配,keyword 匹配标题或 URL)
const AUTO_RULES: AutoRule[] = [
  { category: "开发", hosts: ["github.com", "gitlab.com", "gitee.com", "stackoverflow.com", "developer.mozilla.org", "npmjs.com", "vercel.com", "netlify.com", "leetcode.cn", "leetcode.com", "nowcoder.com", "csdn.net", "cnblogs.com", "juejin.cn", "v2ex.com", "segmentfault.com", "oschina.net"] },
  { category: "AI", hosts: ["openai.com", "chatgpt.com", "anthropic.com", "claude.ai", "zhipuai.cn", "chatglm.cn", "bigmodel.cn", "deepseek.com", "qwen.ai", "tongyi.aliyun.com", "moonshot.cn", "kimi.moonshot.cn", "minimaxi.com", "mistral.ai", "huggingface.co", "ollama.com", "lmarena.ai", "gemini.google.com", "copilot.microsoft.com", "cursor.com", "cursor.sh", "doubao.com", "siliconflow.cn", "modelscope.cn", "poe.com", "perplexity.ai"], keywords: ["大模型", "AI 搜索", "AI工具", "ai 工具"] },
  { category: "云与运维", hosts: ["aliyun.com", "cloud.tencent.com", "console.cloud.tencent.com", "huaweicloud.com", "azure.microsoft.com", "console.aws.amazon.com", "cloudflare.com", "dash.cloudflare.com", "docker.com", "kubernetes.io"] },
  { category: "设计", hosts: ["figma.com", "dribbble.com", "behance.net", "canva.cn", "canva.com", "gaoding.com", "iconfont.cn", "huaban.com"] },
  { category: "影音娱乐", hosts: ["bilibili.com", "youtube.com", "iqiyi.com", "youku.com", "douyin.com", "netflix.com", "spotify.com", "music.163.com", "y.qq.com"] },
  { category: "阅读资讯", hosts: ["zhihu.com", "sspai.com", "36kr.com", "ithome.com", "cnbeta.com", "zaobao.com", "thepaper.cn", "douban.com"] },
  { category: "购物", hosts: ["taobao.com", "jd.com", "tmall.com", "pinduoduo.com", "amazon.cn", "amazon.com", "smzdm.com", "suning.com"] },
  { category: "财经银行", hosts: ["icbc.com.cn", "ccb.com", "cmbchina.com", "abchina.com", "boc.cn", "eastmoney.com", "xueqiu.com", "fund.eastmoney.com", "alipay.com", "Tenpay.com"] },
  { category: "社交", hosts: ["weibo.com", "x.com", "twitter.com", "reddit.com", "t.me", "telegram.org", "discord.com", "linkedin.com", "xiaohongshu.com"] },
  { category: "工具", hosts: ["ilovepdf.com", "tinypng.com", "remove.bg", "regex101.com", "ezgif.com", "photopea.com", "excalidraw.com", "processon.com", "wolframalpha.com", "deepL.com", "deepl.com", "fanyi.baidu.com", "translate.google.com"] },
];

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** 自动分类:返回规则命中的分类;未命中返回 null(保持原分类) */
export function autoCategoryFor(title: string, url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const hay = `${title} ${url}`.toLowerCase();
  for (const rule of AUTO_RULES) {
    if (rule.hosts.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h))) return rule.category;
    if (rule.keywords?.some((k) => hay.includes(k.toLowerCase()))) return rule.category;
  }
  return null;
}

/** 归纳合并提案(纯函数):别名归并 + 大小写/空白重复 + 小分类(≤tiny)收编进「其他」 */
export function proposeRenames(
  rows: Pick<LinkRowLite, "category">[],
  opts?: { tinyMax?: number; keepOthers?: boolean }
): { from: string; to: string; reason: string; count: number }[] {
  const tinyMax = opts?.tinyMax ?? 2;
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);

  // 归一化键:小写 + 去空白;同键取链接数最多的分类名为规范名
  const normKey = (c: string) => c.toLowerCase().replace(/\s+/g, "");
  const byKey = new Map<string, { name: string; count: number; names: string[] }>();
  for (const [name, count] of counts) {
    const key = normKey(name);
    const cur = byKey.get(key);
    if (cur) {
      cur.names.push(name);
      if (count > cur.count) { cur.name = name; cur.count = count; } // 并列时保留先出现的写法(稳定)
    } else byKey.set(key, { name, count, names: [name] });
  }

  const out: { from: string; to: string; reason: string; count: number }[] = [];
  for (const group of byKey.values()) {
    for (const alias of group.names) {
      if (alias !== group.name) out.push({ from: alias, to: group.name, reason: `同名归并(大小写/空白差异)`, count: counts.get(alias) ?? 0 });
    }
  }
  // 小分类收编:排除杂物分类(它们走自动分类)与已参与同名归并的目标
  const renameTargets = new Set(out.map((o) => o.to));
  for (const [name, count] of counts) {
    if (count <= tinyMax && !isJunkCategory(name) && !renameTargets.has(name) && name !== "其他") {
      out.push({ from: name, to: "其他", reason: `仅 ${count} 条,收编进「其他」`, count });
    }
  }
  return out;
}

/** URL 归一化:去协议差异、www、末尾斜杠与常见跟踪参数后比较 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.search);
    for (const k of [...params.keys()]) {
      if (/^(utm_|spm|from|fr|share_|vd_source)/i.test(k)) params.delete(k);
    }
    const qs = params.toString();
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** 重复链接分组:同 URL(归一化)或 同标题+同站点(近重复,如同一站点收藏进多个目录)。 */
export function findDuplicateGroups(rows: Pick<LinkRowLite, "id" | "url" | "title">[]): { key: string; kind: "同网址" | "同标题同站"; ids: string[] }[] {
  const out: { key: string; kind: "同网址" | "同标题同站"; ids: string[] }[] = [];
  // 1) 归一化 URL 完全一致
  const byUrl = new Map<string, string[]>();
  for (const r of rows) {
    const key = normalizeUrl(r.url);
    const list = byUrl.get(key) ?? [];
    list.push(r.id);
    byUrl.set(key, list);
  }
  for (const [key, ids] of byUrl) {
    if (ids.length > 1) out.push({ key, kind: "同网址", ids });
  }
  // 2) 同标题 + 同站点(标题归一化去空白/标点差异,≥4 字才参与,避免"登录"类泛词误报)
  const hostOf = (u: string) => {
    try {
      return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const normTitle = (t: string) => t.toLowerCase().replace(/\s+/g, "").replace(/[【】\[\]()（）·—–\-_|]/g, "");
  const byTitleHost = new Map<string, string[]>();
  const inUrlGroup = new Set(out.flatMap((g) => g.ids));
  for (const r of rows) {
    if (inUrlGroup.has(r.id)) continue; // 已按 URL 判重的不再重复入组
    const key = `${normTitle(r.title)}@${hostOf(r.url)}`;
    if (normTitle(r.title).length < 4 || !hostOf(r.url)) continue;
    const list = byTitleHost.get(key) ?? [];
    list.push(r.id);
    byTitleHost.set(key, list);
  }
  for (const [key, ids] of byTitleHost) {
    if (ids.length > 1) out.push({ key, kind: "同标题同站", ids });
  }
  return out;
}
