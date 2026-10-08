/**
 * 与 Rust 侧的 IPC 桥：数据库状态、导入、只读 SQL 执行。
 *
 * 约定：Rust 的 db_query 返回行数组，每行是「列名 → 值」的对象；
 * BLOB 列为 `{ "$b64": "<base64>" }`，用 blobToText() 解压（gzip）或按 UTF-8 读取。
 */

import { invoke } from "@tauri-apps/api/core";

/** 数据库状态 */
export interface DbStatus {
  ready: boolean;
  path: string | null;
  size: number | null;
  poems: number | null;
  error: string | null;
}

/** 一行查询结果（列名 → 值） */
export type SqlRow = Record<string, unknown>;

/** BLOB 传输包装 */
export interface BlobPayload {
  $b64: string;
}

/** 查询参数类型 */
export type SqlParam = string | number | null;

/** 是否为 BLOB 包装值 */
export function isBlobPayload(value: unknown): value is BlobPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BlobPayload).$b64 === "string"
  );
}

/** base64 → Uint8Array（不依赖 atob 的 latin1 折损）
 * 返回类型显式写成 `Uint8Array<ArrayBuffer>`：TS 5.7+ 的 `new Blob([...])` 只接受
 * 基于 ArrayBuffer（而非 SharedArrayBuffer）的视图，不标注会在 db.ts / 此处触发 TS2322。
 */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 将任意 BLOB 值解码为文本：优先 gzip 解压，失败则按 UTF-8 读取 */
export async function blobToText(value: unknown): Promise<string | null> {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (!isBlobPayload(value)) return null;

  const bytes = base64ToBytes(value.$b64);
  if (bytes.length === 0) return null;

  // gzip 魔数 0x1f 0x8b
  if (bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).text();
    } catch {
      // 落到下面的纯文本分支
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** 数据库状态（首次调用会自动按候选路径尝试打开） */
export function dbStatus(): Promise<DbStatus> {
  return invoke<DbStatus>("db_status");
}

/** 导入指定路径的数据库 */
export function dbOpen(path: string): Promise<DbStatus> {
  return invoke<DbStatus>("db_open", { path });
}

/** 关闭当前数据库 */
export function dbClose(): Promise<DbStatus> {
  return invoke<DbStatus>("db_close");
}

/** 执行只读 SQL，返回全部行 */
export function query<T extends SqlRow = SqlRow>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  return invoke<T[]>("db_query", { sql, params });
}

/** 执行只读 SQL，返回首行 */
export async function queryOne<T extends SqlRow = SqlRow>(
  sql: string,
  params: SqlParam[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(sql, params);
  return rows[0];
}

/** count(*) 风格的单值查询；无结果或为空时返回 0 */
export async function queryNumber(sql: string, params: SqlParam[] = []): Promise<number> {
  const row = await queryOne(sql, params);
  if (!row) return 0;
  const value = Object.values(row)[0];
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

/** 应用数据目录（用于「数据库文件位置」展示） */
export function appDataDir(): Promise<string | null> {
  return invoke<string | null>("app_data_dir");
}

/** 人类可读的文件大小 */
export function formatSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
