#!/usr/bin/env node
/**
 * 校验将要打包进应用的数据库，并输出表/行数报告（CI 与本地均可运行）。
 *
 * 用法：
 *   node scripts/verify-db.mjs
 *   node scripts/verify-db.mjs --file path/to/poetry_index.db --strict
 *
 * --strict：数据库缺失或不可用时以非 0 退出（用于「必须有数据」的发布分支）。
 * 依赖：优先使用 Node 内置 node:sqlite（Node ≥ 22.5），否则退化为只读文件头校验。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      values.set(key, next);
      i++;
    } else {
      flags.add(key);
    }
  }
  return { values, flags };
}

const { values, flags } = parseArgs(process.argv.slice(2));
const file = path.resolve(
  projectRoot,
  values.get("file") ?? path.join("src-tauri", "resources", "poetry_index.db"),
);
const strict = flags.has("strict");

/** 需要检查的关键表 */
const EXPECTED_TABLES = ["poems", "poem_content", "authors", "dynasties", "tags", "poem_tags"];

function humanSize(bytes) {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fail(message) {
  if (strict) {
    console.error(`[verify-db] ❌ ${message}`);
    process.exit(1);
  }
  console.warn(`[verify-db] ⚠️ ${message}`);
  console.warn("[verify-db]    打包会继续进行，应用启动后将提示用户导入数据库。");
  process.exit(0);
}

async function main() {
  if (!fs.existsSync(file)) fail(`未找到数据库：${file}`);

  const stat = fs.statSync(file);
  if (stat.size < 1024) fail(`数据库为空或过小（${humanSize(stat.size)}）：${file}`);

  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString("latin1") !== "SQLite format 3\u0000") fail(`不是 SQLite 数据库：${file}`);

  const report = { file, size: stat.size, tables: {}, poems: null };
  let sqlite = null;
  try {
    // Node 22.5+ 内置；实验性 API，失败时静默降级
    sqlite = await import("node:sqlite");
  } catch {
    sqlite = null;
  }

  if (sqlite?.DatabaseSync) {
    const db = new sqlite.DatabaseSync(file, { readOnly: true });
    try {
      for (const table of EXPECTED_TABLES) {
        try {
          const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
          report.tables[table] = Number(row?.c ?? 0);
        } catch {
          report.tables[table] = null; // 表不存在
        }
      }
      report.poems = report.tables.poems ?? null;
    } finally {
      db.close();
    }
  }

  console.log(`[verify-db] 文件：${report.file}`);
  console.log(`[verify-db] 大小：${humanSize(report.size)}`);
  if (report.poems === null && Object.keys(report.tables).length === 0) {
    console.log("[verify-db] 表检查：跳过（当前 Node 无 node:sqlite，仅校验了文件头）");
  } else {
    for (const [table, count] of Object.entries(report.tables)) {
      console.log(`[verify-db] 表 ${table}：${count === null ? "缺失" : `${count} 行`}`);
    }
    if (!report.poems) fail("poems 表为空或缺失，数据库内容不完整");
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      "### 数据库报告",
      "",
      `- 文件：\`${report.file}\``,
      `- 大小：${humanSize(report.size)}`,
      "",
      "| 表 | 行数 |",
      "| --- | --- |",
      ...Object.entries(report.tables).map(([t, c]) => `| ${t} | ${c === null ? "缺失" : c} |`),
      "",
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }

  console.log("[verify-db] ✅ 校验通过");
}

main().catch((error) => {
  console.error(`[verify-db] ❌ ${error?.stack ?? error}`);
  process.exit(1);
});
