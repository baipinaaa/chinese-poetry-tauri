#!/usr/bin/env node
/**
 * 获取诗词数据库（poetry_index.db）并落到 src-tauri/resources/poetry_index.db。
 *
 * 为什么需要它：数据库约 216MB，不适合提交进 Git；本机也没有构建数据库的完整链路
 * （原站点的 seed_db.ts 依赖先生成好的 chinese-poetry-md 目录）。
 *
 * 获取优先级（命中即停）：
 *   1. --src <path>            显式指定本地已有文件
 *   2. $POETRY_DB_SRC          本地已有文件（环境变量）
 *   3. 常见本地路径候选        原站点 public/data/poetry_index.db 等
 *   4. --url / $POETRY_DB_URL  直接 HTTP(S) 下载
 *   5. GitHub Release 资产     $POETRY_DB_RELEASE（owner/repo@tag）或当前仓库 release 里的 poetry_index.db
 *   6. 都没有                  生成 0 字节占位文件，保证 Tauri 打包不失败（应用启动后提示用户导入数据库）
 *
 * 任意来源都可以用 --sha256 <十六进制> / $POETRY_DB_SHA256 强制校验下载结果，
 * 不匹配的文件会被丢弃并继续尝试下一来源（216MB 的大文件建议始终带上校验值）。
 *
 * 用法：
 *   node scripts/fetch-db.mjs
 *   node scripts/fetch-db.mjs --src "F:/书房/古诗/chinese-poetry-site/public/data/poetry_index.db"
 *   POETRY_DB_URL="https://.../poetry_index.db" node scripts/fetch-db.mjs
 *   node scripts/fetch-db.mjs --out src-tauri/resources/poetry_index.db
 */

import { createWriteStream } from "node:fs";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");

const DB_NAME = "poetry_index.db";
const SQLITE_MAGIC = "SQLite format 3\u0000";

/** 解析命令行参数（仅支持 --key value 与 --flag 形式） */
function parseArgs(argv) {
  const out = { flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out.values.set(key, next);
      i++;
    } else {
      out.flags.add(key);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const outPath = path.resolve(
  projectRoot,
  args.values.get("out") ?? path.join("src-tauri", "resources", DB_NAME),
);

/** 可能的本地数据库位置（相对路径基于项目根目录） */
function localCandidates() {
  const list = [];
  const src = args.values.get("src") ?? process.env.POETRY_DB_SRC;
  if (src) list.push(path.resolve(src));
  list.push(
    path.resolve(projectRoot, "..", "chinese-poetry-site", "public", "data", DB_NAME),
    path.resolve(projectRoot, "public", "data", DB_NAME),
    path.resolve(projectRoot, "src-tauri", "resources", DB_NAME),
  );
  return list;
}

function humanSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** 计算文件 sha256（流式，避免把 216MB 一次性读进内存） */
async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** 若指定了期望的 sha256 就校验；不匹配时删掉产物并返回 false */
async function checkSha(file, expect) {
  if (!expect) return true;
  const actual = await sha256File(file);
  if (actual.toLowerCase() === String(expect).toLowerCase()) {
    console.log(`[fetch-db] ✅ sha256 校验通过：${actual}`);
    return true;
  }
  console.warn(`[fetch-db] ⚠️ sha256 不匹配（期望 ${expect}，实际 ${actual}），丢弃该文件`);
  await fsp.rm(file, { force: true });
  return false;
}

/** 校验文件是不是 SQLite 库（读取文件头魔数） */
async function looksLikeSqlite(file) {
  try {
    const stat = await fsp.stat(file);
    if (stat.size < 100) return false;
    const handle = await fsp.open(file, "r");
    try {
      const buf = Buffer.alloc(16);
      await handle.read(buf, 0, 16, 0);
      return buf.toString("latin1") === SQLITE_MAGIC;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function copyLocal(from) {
  const stat = await fsp.stat(from);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  if (path.resolve(from) === outPath) return stat.size;
  await fsp.copyFile(from, outPath);
  return stat.size;
}

/** 通过 curl 下载（Windows/macOS/Linux 都自带 curl，避免额外依赖与 Node 的代理限制） */
async function downloadWithCurl(url) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.part`;
  const curlArgs = ["-L", "--fail", "--retry", "3", "--retry-delay", "5", "-o", tmp, url];
  // 反向代理场景：允许通过环境变量传入代理
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.POETRY_DB_PROXY;
  if (proxy) curlArgs.unshift("-x", proxy);
  execFileSync("curl", curlArgs, { stdio: "inherit" });
  await fsp.rename(tmp, outPath);
  const stat = await fsp.stat(outPath);
  return stat.size;
}

/** 用 Node 原生 fetch 下载（备用） */
async function downloadWithFetch(url, headers) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.part`;
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  await pipeline(res.body, createWriteStream(tmp));
  await fsp.rename(tmp, outPath);
  const stat = await fsp.stat(outPath);
  return stat.size;
}

async function download(url) {
  try {
    return await downloadWithCurl(url);
  } catch (error) {
    console.warn(`[fetch-db] curl 下载失败（${error.message}），回退到 fetch 下载`);
    return await downloadWithFetch(url);
  }
}

/** 从 GitHub Release 资产里找 poetry_index.db */
async function fetchFromRelease(spec) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "fetch-db-script" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let apiUrl;
  if (spec) {
    // 形式：owner/repo@tag
    const [repo, tag] = spec.split("@");
    const base = `https://api.github.com/repos/${repo}/releases`;
    apiUrl = tag ? `${base}/tags/${tag}` : `${base}/latest`;
  } else if (process.env.GITHUB_REPOSITORY) {
    apiUrl = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/releases/latest`;
  } else {
    return null;
  }

  const res = await fetch(apiUrl, { headers });
  if (!res.ok) {
    console.warn(`[fetch-db] 读取 Release 失败：HTTP ${res.status}`);
    return null;
  }
  const release = await res.json();
  const asset = (release.assets ?? []).find((a) => a.name === DB_NAME);
  if (!asset) {
    console.warn("[fetch-db] Release 中没有 poetry_index.db 资产");
    return null;
  }
  return downloadWithFetch(asset.browser_download_url, headers);
}

async function main() {
  console.log(`[fetch-db] 目标文件：${outPath}`);
  const expectSha = args.values.get("sha256") ?? process.env.POETRY_DB_SHA256 ?? null;

  // 1/2/3 本地
  for (const candidate of localCandidates()) {
    if (fs.existsSync(candidate) && (await looksLikeSqlite(candidate))) {
      const size = await copyLocal(candidate);
      if (!(await checkSha(outPath, expectSha))) continue;
      console.log(`[fetch-db] ✅ 使用本地数据库：${candidate}（${humanSize(size)}）`);
      printReport(size, "local");
      return;
    }
  }

  // 4 URL
  const url = args.values.get("url") ?? process.env.POETRY_DB_URL;
  if (url) {
    console.log(`[fetch-db] 下载：${url}`);
    const size = await download(url);
    if ((await looksLikeSqlite(outPath)) && (await checkSha(outPath, expectSha))) {
      console.log(`[fetch-db] ✅ 下载完成（${humanSize(size)}）`);
      printReport(size, "url");
      return;
    }
    console.warn("[fetch-db] ⚠️ 下载的文件不是 SQLite 数据库（或校验失败），已忽略");
    await fsp.rm(outPath, { force: true });
  }

  // 5 Release
  const size = await fetchFromRelease(args.values.get("release") ?? process.env.POETRY_DB_RELEASE);
  if (size && (await looksLikeSqlite(outPath)) && (await checkSha(outPath, expectSha))) {
    console.log(`[fetch-db] ✅ 自 Release 下载完成（${humanSize(size)}）`);
    printReport(size, "release");
    return;
  }

  // 6 占位，保证打包流程不中断
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, "");
  console.warn("[fetch-db] ⚠️ 未找到数据库，已写入 0 字节占位文件。");
  console.warn("[fetch-db]    应用仍可打包成功，启动后会提示「导入数据库」。");
  console.warn("[fetch-db]    也可先手动把 poetry_index.db 放到 src-tauri/resources/ 后重跑本脚本。");
  printReport(0, "placeholder");
}

/** 把结果写入 GITHUB_OUTPUT / GITHUB_ENV，供后续步骤（如 release 说明）使用 */
function printReport(size, source) {
  const summary = [`db_path=${outPath}`, `db_size=${size}`, `db_source=${source}`];
  for (const line of summary) console.log(`[fetch-db] ${line}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `db_size=${size}\ndb_source=${source}\n`);
  }
}

main().catch((error) => {
  console.error(`[fetch-db] ❌ 失败：${error?.stack ?? error}`);
  process.exitCode = 1;
});
