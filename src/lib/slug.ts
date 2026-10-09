/**
 * Slug 与拼音工具，无声调拼音 + 连字符（与原 Web 版一致）。
 */

import { pinyin } from "pinyin-pro";

/**
 * 中文转 slug：无声调拼音 + 连字符，小写。
 */
export function toSlug(text: string): string {
  if (!text || !text.trim()) return "";
  const py = pinyin(text.trim(), { toneType: "none" });
  const withHyphen = py.replace(/\s+/g, "-").toLowerCase();
  return withHyphen.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") || withHyphen;
}

/**
 * 中文转带声调数字的拼音（如 zhang1 yuan2），用于标题/正文拼音。
 */
export function toPinyinToneNum(text: string): string {
  if (!text || !text.trim()) return "";
  // nonZh: "removed"：只输出汉字的拼音，标点/空格/数字不混入拼音行。
  // 默认（consecutive）会把标点原样留在拼音串里，既让拼音行出现多余标点，
  // 又会在按字对齐时占掉一个音节，导致整行错位。
  return pinyin(text.trim(), { toneType: "num", nonZh: "removed" });
}

/**
 * 取字符串首字的拼音首字母（a–z），用于搜索索引分片。
 */
export function getPinyinInitial(str: string): string {
  const s = str.trim();
  if (!s) return "_";
  const first = s[0]!;
  const code = first.codePointAt(0) ?? 0;
  if (code >= 0x61 && code <= 0x7a) return first.toLowerCase();
  if (code >= 0x41 && code <= 0x5a) return first.toLowerCase();
  const py = pinyin(first, { toneType: "none" }).trim();
  if (py.length > 0) {
    const c = py[0]!.toLowerCase();
    if (c >= "a" && c <= "z") return c;
  }
  return "_";
}

/**
 * 取字符串前两字的拼音首字母（各 a–z 或 _）。
 */
export function getPinyinInitial2(str: string): string {
  const s = str.trim();
  if (!s) return "__";
  const c1 = s[0]!;
  const a1 = getPinyinInitial(c1);
  if (s.length === 1) return a1 + "_";
  const c2 = s[1]!;
  const a2 = getPinyinInitial(c2);
  return a1 + a2;
}
