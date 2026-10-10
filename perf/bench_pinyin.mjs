/**
 * 拼音转换耗时基准：逐行调用 vs 整段 array 模式一次调用。
 * 目的：定位详情页「卡几秒」是否来自 toPinyinToneNum 的逐行 pinyin-pro 调用。
 */
import { pinyin } from "pinyin-pro";

const LINE = "床前明月光，疑是地上霜。";          // 10 字
const LONG = "浔阳江头夜送客，枫叶荻花秋瑟瑟。";  // 14 字

function makeLines(n, src = LINE) {
  return Array.from({ length: n }, () => src);
}

function timeIt(label, fn, repeat = 3) {
  let out;
  const ts = [];
  for (let i = 0; i < repeat; i++) {
    const t0 = performance.now();
    out = fn();
    ts.push(performance.now() - t0);
  }
  console.log(`  ${label.padEnd(52)} best=${Math.min(...ts).toFixed(1).padStart(9)}ms`);
  return out;
}

console.log("pinyin-pro 版本探测：", typeof pinyin);

for (const n of [10, 50, 200, 1000, 4300]) {
  const lines = makeLines(n, n > 500 ? LONG : LINE);
  const total = lines.reduce((a, l) => a + l.length, 0);
  console.log(`\n=== ${n} 行 / ${total} 字 ===`);
  timeIt(`逐行 toPinyin(toneType=num, nonZh=removed) × ${n}`, () =>
    lines.map((l) => pinyin(l.trim(), { toneType: "num", nonZh: "removed" }))
  );
  timeIt(`整段 array 一次调用`, () => {
    const text = lines.join("\n");
    return pinyin(text, { type: "array", toneType: "num", nonZh: "consecutive" });
  });
}

console.log("\n=== array 模式输出结构检查 ===");
const sample = "床前明月光，疑是地上霜。";
const arr = pinyin(sample, { type: "array", toneType: "num", nonZh: "consecutive" });
console.log("  输入:", JSON.stringify(sample));
console.log("  array:", JSON.stringify(arr));
console.log("  长度:", arr.length, "输入长度:", sample.length);
const multi = pinyin("床前明月光\n疑是地上霜", { type: "array", toneType: "num", nonZh: "consecutive" });
console.log("  多行 array:", JSON.stringify(multi));

console.log("\n=== 当前实现 vs 建议实现（10 万次微观） ===");
timeIt("pinyin(line) × 200 行（当前 db.ts 做法）", () =>
  makeLines(200).map((l) => pinyin(l.trim(), { toneType: "num", nonZh: "removed" }))
);
