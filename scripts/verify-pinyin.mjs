/**
 * 拼音覆盖率校验：确认详情页的运行时拼音方案（pinyin-pro）覆盖真实诗词语料。
 *
 * 用法：
 *   node scripts/verify-pinyin.mjs                                  # 只测常用汉字区
 *   node scripts/verify-pinyin.mjs --corpus _scratch/corpus_chars.json   # 叠加真实语料校验
 *
 * 背景：详情页拼音不引入静态字典，由前端 pinyin-pro 实时计算
 * （见 src/lib/db.ts 的 toPinyinToneNum / assemblePoem）。诗歌多音字极多
 * （长/行/乐/重/还…），字级字典必然出错，词级消歧才正确。本脚本校验这套方案的覆盖能力。
 */
import { readFileSync } from "node:fs";
import { pinyin } from "pinyin-pro";

const BLOCK = 2000;
const THRESHOLD = 99;

/** 逐块转拼音，返回 [总数, 有拼音数, 缺字样例] */
function measure(chars) {
  let total = 0;
  let ok = 0;
  const missing = [];
  for (let i = 0; i < chars.length; i += BLOCK) {
    const slice = chars.slice(i, i + BLOCK);
    const arr = pinyin(slice.join(""), { toneType: "num", type: "array" });
    for (let k = 0; k < slice.length; k++) {
      total += 1;
      const py = (arr[k] ?? "").toString();
      if (/^[a-zü]+[0-4]?$/i.test(py)) ok += 1;
      else if (missing.length < 12) missing.push(`${slice[k]}(U+${slice[k].codePointAt(0).toString(16).toUpperCase()})`);
    }
  }
  return [total, ok, missing];
}

function rangeChars(start, end) {
  const out = [];
  for (let c = start; c <= end; c++) out.push(String.fromCodePoint(c));
  return out;
}

const failures = [];

// 1) 常用汉字区（CJK 基本区）
const basic = rangeChars(0x4e00, 0x9fa5);
{
  const [total, ok, missing] = measure(basic);
  const pct = (ok / total) * 100;
  console.log(`CJK 基本区(4E00-9FA5): ${ok}/${total} = ${pct.toFixed(2)}%`);
  if (missing.length) console.log(`  缺字样例: ${missing.join(" ")}`);
  if (pct < THRESHOLD) failures.push(`基本区覆盖率 ${pct.toFixed(2)}% < ${THRESHOLD}%`);
}

// 2) 真实诗词语料（可选）
const ci = process.argv.indexOf("--corpus");
if (ci !== -1) {
  const path = process.argv[ci + 1];
  if (!path) {
    console.error("--corpus 需要一个 JSON 文件参数（内容为汉字字符串数组或字符串）");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const chars = Array.isArray(raw) ? raw : [...raw];
  const [total, ok, missing] = measure(chars);
  const pct = (ok / total) * 100;
  console.log(`真实诗词语料(${path}): ${ok}/${total} = ${pct.toFixed(2)}%`);
  if (missing.length) console.log(`  缺字样例: ${missing.join(" ")}`);
  if (pct < THRESHOLD) failures.push(`语料覆盖率 ${pct.toFixed(2)}% < ${THRESHOLD}%`);
}

// 3) 多音字冒烟（确认是词级消歧，不是字级）
const samples = ["长安一片月", "独怆然而涕下", "还来就菊花", "露重飞难进", "乐游原上清秋节"];
console.log("\n多音字冒烟（拼音 + 数字声调）:");
for (const text of samples) {
  console.log(`  ${text} → ${pinyin(text, { toneType: "num" })}`);
}

console.log("\n说明：扩展A 等生僻字（乥/乲/兙…）pinyin-pro 不收录，转换时原样返回该字，UI 显示原字，不影响常用诗词展示。");

if (failures.length) {
  console.error(`\n❌ ${failures.join("；")}`);
  process.exit(1);
}
console.log(`\n✅ 覆盖率均 ≥${THRESHOLD}%`);
