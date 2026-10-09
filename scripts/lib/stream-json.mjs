/**
 * 流式 JSON 读取：把大文件里的记录一条条 yield 出来，避免整文件进内存。
 *
 * 兼容四种实测格式（本仓库的数据源全中）：
 *   1. 单行大 JSON 数组     —— gushiwen.json.gz（解压后 ~250MB 全在一行）
 *   2. 每行一条、带尾逗号的数组 —— poems-db-master/poems1.json
 *   3. 标准 JSONL（每行一个对象） —— guwen/*.json、writer/*.json
 *   4. 上述格式的 gz 压缩版
 *
 * 实现方式是按「括号深度 + 字符串状态」扫描字符流，逐对象 slice 出来 JSON.parse，
 * 因此不依赖任何 npm 包，CI 无网也能跑。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';

/**
 * @param {string} file 文件路径
 * @param {{gzip?: boolean, chunkSize?: number, onError?: (msg: string, raw: string) => void}} [opts]
 * @returns {AsyncGenerator<Record<string, any>>}
 */
export async function* streamJsonRecords(file, opts = {}) {
  const { gzip = false, chunkSize = 1 << 20, onError } = opts;
  const decoder = new StringDecoder('utf8');
  const raw = fs.createReadStream(file, { highWaterMark: chunkSize });
  const input = gzip ? raw.pipe(zlib.createGunzip()) : raw;

  let buf = '';
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;

  for await (const chunk of input) {
    buf += typeof chunk === 'string' ? chunk : decoder.write(chunk);

    let scan = 0;
    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        if (depth > 0) {
          depth--;
          if (depth === 0 && start >= 0) {
            const text = buf.slice(start, i + 1);
            scan = i + 1;
            try {
              yield JSON.parse(text);
            } catch (e) {
              if (onError) onError(String(e && e.message), text.slice(0, 200));
            }
            start = -1;
          }
        }
      }
    }
    // 已经消费掉的部分裁掉，未闭合的对象留在缓冲里继续拼
    if (scan > 0) buf = buf.slice(scan);
    else if (buf.length > chunkSize * 8) buf = buf.slice(buf.length - chunkSize); // 防御：异常数据避免无限增长
  }

  buf += decoder.end();
  if (buf.trim() && buf.trim() !== '[' && buf.trim() !== ']' && onError) {
    onError('文件尾部有未闭合内容', buf.slice(0, 200));
  }
}

/** 统计用：流过一遍文件并回调每条记录（不保留） */
export async function eachRecord(file, opts, cb) {
  let n = 0;
  for await (const rec of streamJsonRecords(file, opts)) {
    n++;
    if (cb) cb(rec, n);
  }
  return n;
}
