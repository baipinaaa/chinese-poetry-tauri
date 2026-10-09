/**
 * 生成建库用拼音字典 scripts/data/pinyin.dict.json（汉字 → 无调拼音）。
 *
 * 用法：node scripts/gen-pinyin-dict.mjs
 *
 * 为什么需要：Python 建库管线要给「三源独有诗」生成 slug，而 slug 需要拼音；
 * CI 的 Python 环境没有 npm，所以把 pinyin-pro 的读音一次性导出成静态字典提交进仓库。
 * 体积约 300KB，可接受；缺字由建库脚本回退为 han-<hex>。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pinyin } from "pinyin-pro";

const OUT = "scripts/data/pinyin.dict.json";

const dict = {};
let missing = 0;
for (let cp = 0x4e00; cp <= 0x9fff; cp++) {
  const ch = String.fromCodePoint(cp);
  const py = pinyin(ch, { toneType: "none", type: "array" })[0] ?? "";
  if (/^[a-zü]+$/.test(py)) dict[ch] = py.replace(/ü/g, "v");
  else missing += 1;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(dict), "utf8");

const bytes = JSON.stringify(dict).length;
console.log(`写出 ${OUT}：${Object.keys(dict).length} 字，${(bytes / 1024).toFixed(0)}KB，缺字 ${missing}`);
console.log("样例：", ["长", "安", "一", "片", "月", "还", "乐"].map((c) => `${c}=${dict[c] ?? "?"}`).join(" "));
