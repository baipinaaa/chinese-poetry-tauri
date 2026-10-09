/**
 * 朝代枚举与归一化：统一「唐/唐代」等写法为规范展示名与 slug。
 * 与原 Web 版 lib/dynasty.ts 一致。
 */

import { toSlug } from "./slug";

export type DynastyEntry = {
  slug: string;
  displayName: string;
  aliases: string[];
};

export const DYNASTY_ENTRIES: DynastyEntry[] = [
  { slug: "xian-qin", displayName: "先秦", aliases: ["先秦"] },
  { slug: "chun-qiu", displayName: "春秋", aliases: ["春秋"] },
  { slug: "zhan-guo", displayName: "战国", aliases: ["战国"] },
  { slug: "qin", displayName: "秦", aliases: ["秦", "秦代"] },
  { slug: "han", displayName: "汉", aliases: ["汉", "汉代", "西汉", "东汉", "西汉末年", "东汉末年", "两汉"] },
  { slug: "dong-han-mo-nian", displayName: "东汉末年", aliases: ["东汉末年"] },
  { slug: "san-guo", displayName: "三国", aliases: ["三国", "三国时期"] },
  { slug: "jin", displayName: "晋", aliases: ["晋", "晋代", "西晋", "东晋"] },
  { slug: "nan-bei-chao", displayName: "南北朝", aliases: ["南北朝"] },
  { slug: "sui", displayName: "隋", aliases: ["隋", "隋代"] },
  { slug: "tang", displayName: "唐代", aliases: ["唐", "唐代"] },
  { slug: "chu", displayName: "楚", aliases: ["楚"] },
  { slug: "wu-dai", displayName: "五代", aliases: ["五代", "五代十国"] },
  { slug: "song", displayName: "宋代", aliases: ["宋", "宋代"] },
  { slug: "yuan", displayName: "元代", aliases: ["元", "元代"] },
  { slug: "ming", displayName: "明代", aliases: ["明", "明代"] },
  { slug: "qing", displayName: "清代", aliases: ["清", "清代"] },
  // 以下为桌面版数据库扩展出的朝代（chinese-poetry 三源数据引入），
  // 缺少映射时 getDynastyDisplayName() 会原样返回 slug（如 "jin-dai"），界面上就会显示英文。
  { slug: "jin-dai", displayName: "近代", aliases: ["近代"] },
  { slug: "dang-dai", displayName: "当代", aliases: ["当代"] },
  { slug: "xian-dai", displayName: "现代", aliases: ["现代"] },
  { slug: "jin-chao", displayName: "金朝", aliases: ["金朝", "金代"] },
  { slug: "liao", displayName: "辽朝", aliases: ["辽朝", "辽代"] },
  { slug: "wei-jin", displayName: "魏晋", aliases: ["魏晋"] },
  { slug: "unknown", displayName: "未知", aliases: ["未知", "不详"] },
];

const slugToEntry = new Map<string, DynastyEntry>(DYNASTY_ENTRIES.map((e) => [e.slug, e]));
const aliasToEntry = new Map<string, DynastyEntry>();
for (const e of DYNASTY_ENTRIES) {
  for (const a of e.aliases) {
    const key = a.trim().toLowerCase();
    if (!aliasToEntry.has(key)) aliasToEntry.set(key, e);
  }
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 将原始朝代名（如「唐」「唐代」）转为规范 slug（如 tang）。
 */
export function getDynastySlug(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const entry = aliasToEntry.get(normalizeKey(raw));
  return entry ? entry.slug : toSlug(raw);
}

/**
 * 将 slug 或原始朝代名转为规范展示名（如 tang / 唐 / 唐代 -> 唐代）。
 */
export function getDynastyDisplayName(slugOrRaw: string): string {
  if (!slugOrRaw || !slugOrRaw.trim()) return "";
  const bySlug = slugToEntry.get(slugOrRaw.trim());
  if (bySlug) return bySlug.displayName;
  const byAlias = aliasToEntry.get(normalizeKey(slugOrRaw));
  if (byAlias) return byAlias.displayName;
  return slugOrRaw.trim();
}

/**
 * 仅当 slug 在已知枚举中时返回规范展示名，否则返回 fallback（如 DB 中的 name）。
 */
export function getDynastyDisplayNameOrFallback(slug: string, fallbackName: string): string {
  if (!slug?.trim()) return fallbackName?.trim() ?? "";
  const entry = slugToEntry.get(slug.trim());
  return entry ? entry.displayName : fallbackName?.trim() || slug.trim();
}

/**
 * 归一化原始朝代：返回规范 slug 与展示名。
 */
export function normalizeDynasty(raw: string): { slug: string; displayName: string } {
  if (!raw || !raw.trim()) return { slug: "", displayName: "" };
  const entry = aliasToEntry.get(normalizeKey(raw));
  if (entry) return { slug: entry.slug, displayName: entry.displayName };
  const slug = toSlug(raw);
  return { slug, displayName: raw.trim() };
}
