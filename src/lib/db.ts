/**
 * 数据层（桌面版单文件）。
 *
 * 由原 Web 版 lib/db/{queries,index,types,compress}.ts 合并移植而来：
 *  - 桌面端没有服务端，SQLite 由 Rust 侧持有，前端只通过 src/lib/ipc.ts（唯一数据通道）
 *    以只读方式执行 SQL；所有 SQL 都留在本文件里。
 *  - better-sqlite3 的同步调用（db.get / db.all）全部改为 await queryOne / query / queryNumber；
 *    原先导出的函数签名保持一致，只是变为 async。
 *  - BLOB 列由 Rust 传成 `{ $b64: "..." }`，统一用 blobToText() 解压（gzip）或按 UTF-8 解码，
 *    返回 string | null（替代原 decompressFromBlob）。
 *  - 原 lib/db/client.ts（连接池/路径）与 lib/db/schema.ts（建表 DDL）依赖 better-sqlite3 与
 *    node:fs、node:path，桌面端不存在该能力：保留同名导出并降级为 no-op / 抛错，标注 TODO(desktop)。
 *  - 原 JSON 数据源（lib/data-json）与 process.env 分支在桌面端不适用，已移除，统一走 SQLite 单库。
 *
 * SQL 与原实现逐字一致（仅将 db.get/db.all 换成 queryOne/query），不要改写 WHERE / ORDER BY / LIMIT。
 */

import {
  base64ToBytes,
  blobToText,
  query,
  queryNumber,
  queryOne,
  type SqlParam,
} from "./ipc";
import { getDynastyDisplayName } from "./dynasty";
import { toSlug, toPinyinToneNum } from "./slug";
import type { Poem, Author, Dynasty, Tag, PoemSearchItem } from "./types";

// 便于调用方直接从 "./lib/db" 拿应用层类型（原 lib/types.ts 的内容仍以 ./types 为准）
export type { Poem, Author, Dynasty, Tag, PoemSearchItem };

// ============================================================================
// 原 lib/db/types.ts：数据库抽象类型（内联，桌面端只需要 sqlite）
// ============================================================================

export type Dialect = "sqlite" | "postgres";

export interface DbClient {
  /** 单行查询，无结果返回 undefined */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** 多行查询 */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 执行 INSERT/UPDATE/DELETE，返回 changes/lastID 等（实现可简化） */
  run(sql: string, params?: unknown[]): Promise<{ changes?: number; lastID?: number }>;
  /** 执行多条 DDL（如 CREATE TABLE），无返回值；PG 可能逐条执行 */
  exec(sql: string): Promise<void>;
  /** 当前 dialect，用于 seed 等需要区分语法的场景 */
  readonly dialect: Dialect;
}

// ============================================================================
// 原 lib/db/index.ts 的 re-export：client / schema
// 桌面端数据库由 Rust 侧负责打开与建表，以下导出仅为兼容旧调用点而保留。
// ============================================================================

/** 把调用方传进来的 unknown[] 收敛为 IPC 只读查询支持的参数类型 */
function toSqlParams(params?: unknown[]): SqlParam[] {
  if (!params || params.length === 0) return [];
  return params.map((p) => {
    if (p === null || p === undefined) return null;
    if (typeof p === "number" || typeof p === "string") return p;
    // 只读查询不会用到其它类型，其余统一转字符串（避免把 Buffer/boolean 传到 Rust 侧）
    return String(p);
  });
}

/** 走 IPC 的只读 DbClient 适配器（同一实现供 getDb / getIndexDb 共用） */
const ipcDbClient: DbClient = {
  dialect: "sqlite",
  // 泛型 T 与 ipc 的 SqlRow 约束不同，这里用 unknown 中转断言
  get: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
    (await queryOne(sql, toSqlParams(params))) as unknown as T | undefined,
  all: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
    (await query(sql, toSqlParams(params))) as unknown as T[],
  run: async () => {
    // TODO(desktop): 桌面版数据库为只读，写操作不可用。
    throw new Error("桌面版数据库为只读，不支持 run()");
  },
  exec: async () => {
    // TODO(desktop): 桌面版数据库为只读，DDL 由 Rust 侧在导入/打包阶段执行。
    throw new Error("桌面版数据库为只读，不支持 exec()");
  },
};

/** 主库客户端（桌面端单库，等价于原 getDb） */
export async function getDb(): Promise<DbClient> {
  return ipcDbClient;
}

/** 索引库客户端（桌面端单库，与 getDb 相同） */
export async function getIndexDb(): Promise<DbClient> {
  return ipcDbClient;
}

/**
 * 数据库文件路径。
 * TODO(desktop): 桌面端路径由 Rust 侧管理，前端无 node:path / node:fs；
 * 需要展示位置时请用 ipc 的 appDataDir()（异步）。此处降级返回 null。
 */
export function getDatabasePath(): string | null {
  return null;
}

/** 关闭数据库连接。TODO(desktop): 连接由 Rust 侧管理，此处为 no-op。 */
export async function closeDb(): Promise<void> {
  // no-op
}

/** 建表（原 lib/db/schema.ts）。TODO(desktop): 桌面端数据库为随包产物，不在前端建表。 */
export async function createTables(_client: DbClient): Promise<void> {
  // no-op
}

/** 建表（同步版）。TODO(desktop): 同上，no-op。 */
export function createTablesSync(_db: unknown): void {
  // no-op
}

/** 建索引表。TODO(desktop): 同上，no-op。 */
export function createIndexTables(_db: unknown): void {
  // no-op
}

/** 建内容表。TODO(desktop): 同上，no-op。 */
export function createContentTables(_db: unknown): void {
  // no-op
}

// ============================================================================
// 原 lib/db/compress.ts：文本/Blob 压缩（桌面端只读，写路径降级）
// ============================================================================

/** 旧版 TEXT 压缩前缀（"gz:" + base64(gzip)） */
const TEXT_GZIP_PREFIX = "gz:";

/**
 * 若文本超过阈值则压缩为 "gz:" + base64(gzip(utf8))，否则返回原文。
 * TODO(desktop): 桌面端数据库只读，且浏览器无同步 zlib，写路径不再需要压缩，直接原样返回。
 */
export function compressText(s: string | null | undefined): string | null {
  if (s == null || s === "") return s === "" ? "" : null;
  return s;
}

/**
 * 若为 "gz:" 前缀则 base64 解码后 gunzip，否则返回原值。
 * TODO(desktop): 浏览器端没有同步 gunzip，旧版 "gz:" 文本无法同步解压；
 * 现代库里内容都是 BLOB（用 async 的 blobToText / decompressFromBlob 处理），
 * 这里对 "gz:" 前缀降级返回 null。
 */
export function decompressText(s: string | null | undefined): string | null {
  if (s == null) return null;
  if (s === "") return "";
  if (!s.startsWith(TEXT_GZIP_PREFIX)) return s;
  return null;
}

/**
 * 供 BLOB 列写入：超阈值返回 gzip 字节。
 * TODO(desktop): 只读数据库无写入需求，降级返回 null。
 */
export function compressToBlob(_s: string | null | undefined): Uint8Array | null {
  return null;
}

/**
 * 从 BLOB 或旧版 base64 TEXT 读出字符串。
 * 注意：原实现是同步的（Buffer + node:zlib），桌面端改为异步（Rust 侧已把 BLOB 转成 { $b64 }，
 * 由 ipc.blobToText 负责 gzip 解压或 UTF-8 解码）。
 */
export function decompressFromBlob(data: unknown): Promise<string | null> {
  return decodeTextValue(data);
}

/**
 * 数据层统一的内容列解码入口（对应原 decompressFromBlob）。
 * - BLOB：Rust 侧转成 `{ $b64 }`，交给 ipc.blobToText（gzip 魔数则解压，否则 UTF-8）。
 * - 旧库的 TEXT 压缩："gz:" + base64(gzip)，浏览器无同步 zlib，这里用 DecompressionStream 异步解压。
 */
async function decodeTextValue(value: unknown): Promise<string | null> {
  if (typeof value === "string" && value.startsWith(TEXT_GZIP_PREFIX)) {
    try {
      const bytes = base64ToBytes(value.slice(TEXT_GZIP_PREFIX.length));
      if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b && typeof DecompressionStream !== "undefined") {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        return await new Response(stream).text();
      }
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return null;
    }
  }
  return blobToText(value);
}

// ============================================================================
// 原 lib/ssg_config.ts：分层 SSG 用「热门选集」tag 配置（内联）
// ============================================================================

/** 默认参与 SSG 的热门选集/体裁 tag slug，合并去重后尽量接近 5000 首 */
export const SSG_POPULAR_TAG_SLUGS: string[] = [
  "tang-shi-san-bai-shou",
  "song-ci-san-bai-shou",
  "qian-jia-shi",
  "meng-xue",
  "gu-wen-guan-zhi",
  "shi-jing",
  "lun-yu",
  "si-shu-wu-jing",
  "you-meng-ying",
  "hua-jian-ji",
  "shui-mo-tang-shi",
  "yue-fu",
  "wu-yan-jue-ju",
  "qi-yan-jue-ju",
  "wu-yan-lu-shi",
  "qi-yan-lu-shi",
  "shi-ci",
];

/** 单 tag 最多取多少首参与 SSG 合并（避免单 tag 过大） */
export const SSG_MAX_SLUGS_PER_TAG = 2000;

/**
 * 参与 SSG 的 tag slug 列表。
 * TODO(desktop): 桌面端没有构建期环境变量（process.env 不可用），固定使用 curated 列表。
 */
export function getSSGTagSlugs(): string[] {
  return [...SSG_POPULAR_TAG_SLUGS];
}

// ============================================================================
// 原 lib/db/queries.ts：诗词/作者/朝代/标签查询（SQL 与导出一致）
// ============================================================================

/** poems + JOIN 后的列表行（列表查询共用） */
type PoemListRow = {
  slug: string;
  title: string;
  author_slug: string;
  dynasty_slug: string;
  rhythmic: string | null;
  excerpt: string | null;
  author_name: string;
  dynasty_name: string;
};

/**
 * poem_content.paragraphs 在库里有两种形态：
 *  - 桌面版新导入的诗（含三源数据）是纯文本，以换行分行；
 *  - 原站旧数据是 JSON 数组字符串 `["行1","行2"]`。
 * 直接 JSON.parse 会在纯文本上抛异常，导致详情页整页落到「未找到该诗词」，
 * 所以这里统一解析成行数组，两种形态都能正确显示。
 */
function parseParagraphLines(raw: string | null | undefined): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter(Boolean);
      }
    } catch {
      // 不是合法 JSON，落到下面的纯文本分支
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 从 poems + poem_content + 作者/朝代名 + tags 拼出完整 Poem；拼音由调用方传入（实时计算） */
function assemblePoem(
  p: { slug: string; title: string; author_slug: string; dynasty_slug: string; rhythmic: string | null; excerpt: string | null },
  authorName: string,
  dynastyName: string,
  content: { paragraphs: string; translation: string | null; appreciation: string | null; annotation: string | null } | null,
  titlePinyin: string | undefined,
  paragraphsPinyin: string[] | undefined,
  tagNames: string[]
): Poem {
  const dynastyDisplay = getDynastyDisplayName(p.dynasty_slug) || dynastyName;
  const paragraphs = content ? parseParagraphLines(content.paragraphs) : [];
  return {
    slug: p.slug,
    title: p.title,
    author: authorName,
    dynasty: dynastyDisplay,
    titleSlug: toSlug(p.title),
    authorSlug: p.author_slug,
    dynastySlug: p.dynasty_slug,
    id: p.slug,
    titlePinyin,
    authorPinyin: toPinyinToneNum(authorName) || undefined,
    dynastyPinyin: toPinyinToneNum(dynastyDisplay) || undefined,
    paragraphs,
    paragraphsPinyin,
    translation: content?.translation ?? undefined,
    appreciation: content?.appreciation ?? undefined,
    annotation: content?.annotation ?? undefined,
    tags: tagNames,
    rhythmic: p.rhythmic ?? undefined,
    excerpt: p.excerpt ?? undefined,
  };
}

/** 列表行 → Poem（轻量，无 paragraphs/translation；author/dynasty 来自 JOIN） */
function rowToListPoem(row: PoemListRow): Poem {
  const dynastyDisplay = getDynastyDisplayName(row.dynasty_slug) || row.dynasty_name;
  return {
    slug: row.slug,
    title: row.title,
    author: row.author_name,
    dynasty: dynastyDisplay,
    titleSlug: toSlug(row.title),
    authorSlug: row.author_slug,
    dynastySlug: row.dynasty_slug,
    id: row.slug,
    titlePinyin: undefined,
    authorPinyin: undefined,
    dynastyPinyin: undefined,
    paragraphs: [],
    translation: undefined,
    appreciation: undefined,
    annotation: undefined,
    tags: [],
    rhythmic: row.rhythmic ?? undefined,
    excerpt: row.excerpt ?? undefined,
  };
}

export async function getPoemBySlug(slug: string): Promise<Poem | undefined> {
  const poemRow = await queryOne<PoemListRow>(
    `SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
            a.name AS author_name, d.name AS dynasty_name
     FROM poems p
     JOIN authors a ON p.author_slug = a.slug
     JOIN dynasties d ON p.dynasty_slug = d.slug
     WHERE p.slug = ?`,
    [slug]
  );
  if (!poemRow) return undefined;

  const contentRow = await queryOne<{
    paragraphs: unknown;
    translation: unknown;
    appreciation: unknown;
    annotation: unknown;
  }>("SELECT paragraphs, translation, appreciation, annotation FROM poem_content WHERE slug = ?", [slug]);

  const rawParagraphs = contentRow ? ((await decodeTextValue(contentRow.paragraphs)) ?? "") : "";
  const paragraphs = parseParagraphLines(rawParagraphs);
  const titlePinyin = toPinyinToneNum(poemRow.title) || undefined;
  const paragraphsPinyin = paragraphs.length ? paragraphs.map((line) => toPinyinToneNum(line)) : undefined;

  const tagRows = await query<{ name: string }>(
    "SELECT t.name FROM poem_tags pt JOIN tags t ON pt.tag_slug = t.slug WHERE pt.poem_slug = ?",
    [slug]
  );
  const tagNames = tagRows.map((r) => r.name);

  const contentDecoded =
    contentRow == null
      ? null
      : {
          paragraphs: rawParagraphs,
          translation: await decodeTextValue(contentRow.translation),
          appreciation: await decodeTextValue(contentRow.appreciation),
          annotation: await decodeTextValue(contentRow.annotation),
        };
  return assemblePoem(
    poemRow,
    poemRow.author_name,
    poemRow.dynasty_name,
    contentDecoded,
    titlePinyin,
    paragraphsPinyin,
    tagNames
  );
}

export async function getAuthors(offset = 0, limit = 10000): Promise<Author[]> {
  const rows = await query<{ slug: string; name: string; poem_count: number }>(
    "SELECT slug, name, poem_count FROM authors ORDER BY poem_count DESC LIMIT ? OFFSET ?",
    [limit, offset]
  );
  return rows.map((r) => ({ slug: r.slug, name: r.name, poem_count: r.poem_count }));
}

export async function getAuthorBySlug(slug: string): Promise<Author | undefined> {
  const row = await queryOne<{
    slug: string;
    name: string;
    poem_count: number;
    description: unknown;
    birth_year: string | null;
    death_year: string | null;
  }>(
    "SELECT slug, name, poem_count, description, birth_year, death_year FROM authors WHERE slug = ?",
    [slug]
  );
  if (!row) return undefined;
  const description = await decodeTextValue(row.description);
  return {
    slug: row.slug,
    name: row.name,
    poem_count: row.poem_count,
    description: description ?? undefined,
    birth_year: row.birth_year ?? undefined,
    death_year: row.death_year ?? undefined,
  };
}

/**
 * 按「标题 + 作者名」查诗，供详情页 slug 回退链使用（命中 idx_poems_title_author 索引）。
 * 详情页 URL 目前只携带 slug（由管线统一生成），此函数保留给从旧库迁移的收藏 / 外部链接。
 */
export async function getPoemByTitleAuthor(title: string, authorName: string): Promise<Poem | undefined> {
  const t = title.trim();
  const a = authorName.trim();
  if (!t || !a) return undefined;
  const row = await queryOne<{ slug: string }>(
    `SELECT p.slug FROM poems p JOIN authors a ON a.slug = p.author_slug
     WHERE p.title = ? AND a.name = ? LIMIT 1`,
    [t, a]
  );
  return row ? getPoemBySlug(row.slug) : undefined;
}

/** 按姓名精确匹配作者，供 Nav 诗人搜索跳转作者页使用。 */
export async function getAuthorByName(name: string): Promise<Author | undefined> {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const row = await queryOne<{ slug: string; name: string; poem_count: number }>(
    "SELECT slug, name, poem_count FROM authors WHERE name = ?",
    [trimmed]
  );
  if (!row) return undefined;
  return { slug: row.slug, name: row.name, poem_count: row.poem_count };
}

/**
 * 把朝代起止年格式化为「1127—1279」。
 * 数据源用「前221」表示公元前，这里兼容「公元前221」写法并去掉重复前缀；缺一端时只显示现存端。
 */
export function formatYearPeriod(start?: string | null, end?: string | null): string | undefined {
  const clean = (v?: string | null) => (v ?? "").trim().replace(/^公元前/, "前");
  const s = clean(start);
  const e = clean(end);
  if (!s && !e) return undefined;
  if (!s || !e || s === e) return s || e;
  return `${s}—${e}`;
}

/** 把生卒年格式化为「（1125—1210）」；只有一端时用「?」占位。 */
export function formatLifespan(birth?: string | null, death?: string | null): string | undefined {
  const clean = (v?: string | null) => (v ?? "").trim().replace(/^公元前/, "前");
  const b = clean(birth);
  const d = clean(death);
  if (!b && !d) return undefined;
  if (b && d) return b === d ? `（${b}）` : `（${b}—${d}）`;
  return b ? `（${b}—?）` : `（?—${d}）`;
}

/**
 * 朝代列表：读 dynasties 表（含起止年）。
 * 硬编码的朝代名/年份已移除，年份一律由 start_year / end_year 两两相减风格拼接（见 formatYearPeriod）。
 */
export async function getDynasties(): Promise<Dynasty[]> {
  const rows = await query<{
    slug: string;
    name: string;
    poem_count: number;
    start_year: string | null;
    end_year: string | null;
  }>(
    "SELECT slug, name, poem_count, start_year, end_year FROM dynasties ORDER BY poem_count DESC"
  );
  return rows.map((r) => ({
    slug: r.slug,
    name: getDynastyDisplayName(r.slug) || r.name,
    poem_count: r.poem_count,
    start_year: r.start_year ?? undefined,
    end_year: r.end_year ?? undefined,
    period: formatYearPeriod(r.start_year, r.end_year),
  }));
}

export async function getTags(): Promise<Tag[]> {
  const rows = await query<{ slug: string; name: string; poem_count: number }>(
    "SELECT slug, name, poem_count FROM tags ORDER BY poem_count DESC"
  );
  return rows.map((r) => ({ slug: r.slug, name: r.name, poem_count: r.poem_count }));
}

/** 词牌列表：从 poems 聚合 rhythmic，返回 slug（toSlug(name)）、name、poem_count */
export async function getRhythmics(): Promise<Array<{ slug: string; name: string; poem_count: number }>> {
  const rows = await query<{ name: string; poem_count: number }>(
    "SELECT rhythmic AS name, COUNT(*) AS poem_count FROM poems WHERE rhythmic IS NOT NULL AND rhythmic != '' GROUP BY rhythmic ORDER BY poem_count DESC"
  );
  return rows.map((r) => ({ slug: toSlug(r.name), name: r.name, poem_count: r.poem_count }));
}

/** 按词牌名查诗词列表（分页） */
export async function getPoemsByRhythmic(name: string, offset = 0, limit = 50): Promise<Poem[]> {
  const rows = await query<PoemListRow>(
    `SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
            a.name AS author_name, d.name AS dynasty_name
     FROM poems p
     JOIN authors a ON p.author_slug = a.slug
     JOIN dynasties d ON p.dynasty_slug = d.slug
     WHERE p.rhythmic = ? ORDER BY p.slug LIMIT ? OFFSET ?`,
    [name, limit, offset]
  );
  return rows.map(rowToListPoem);
}

/** 按词牌名统计诗词数量 */
export async function countPoemsByRhythmic(name: string): Promise<number> {
  return queryNumber("SELECT COUNT(*) as c FROM poems WHERE rhythmic = ?", [name]);
}

/** 全诗分页（无筛选时默认列表） */
export async function getPoemsAll(offset = 0, limit = 50): Promise<Poem[]> {
  const rows = await query<PoemListRow>(
    `SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
            a.name AS author_name, d.name AS dynasty_name
     FROM poems p
     JOIN authors a ON p.author_slug = a.slug
     JOIN dynasties d ON p.dynasty_slug = d.slug
     ORDER BY p.slug LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rows.map(rowToListPoem);
}

export async function getPoemsByDynasty(dynastySlug: string, offset = 0, limit = 50): Promise<Poem[]> {
  const rows = await query<PoemListRow>(
    `SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
            a.name AS author_name, d.name AS dynasty_name
     FROM poems p
     JOIN authors a ON p.author_slug = a.slug
     JOIN dynasties d ON p.dynasty_slug = d.slug
     WHERE p.dynasty_slug = ? ORDER BY p.slug LIMIT ? OFFSET ?`,
    [dynastySlug, limit, offset]
  );
  return rows.map(rowToListPoem);
}

/**
 * 切分成「单字 + 相邻字对」——必须与 scripts/build_db.py 的 gram_text() 完全一致，
 * 否则索引里的 token 与查询 token 对不上。\p{L}\p{N}_ 等价 Python 的 \w（Unicode）。
 */
function gramTokens(s: string): string[] {
  const chars = Array.from(s).filter((c) => /[\p{L}\p{N}_]/u.test(c));
  const toks = [...chars];
  for (let i = 0; i + 1 < chars.length; i++) toks.push(chars[i] + chars[i + 1]);
  return toks;
}

/** 把用户输入包成 FTS5 查询：所有 token 用 AND 组合（单字保证每字出现，字对保证相邻） */
function toFtsMatch(q: string): string {
  const toks = gramTokens(q);
  if (toks.length === 0) return '""';
  return toks.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}

function toSearchItem(r: { slug: string; title: string; author_name: string; dynasty_name: string }): PoemSearchItem {
  return {
    slug: r.slug,
    title: r.title,
    author_name: r.author_name,
    dynasty_name: r.dynasty_name,
    title_pinyin: undefined,
    tags: undefined,
  };
}

/** FTS5 路径：标题/作者子串命中倒排索引，毫秒级 */
async function searchPoemsFts(q: string, offset: number, limit: number): Promise<PoemSearchItem[]> {
  const rows = await query<{ slug: string; title: string; author_name: string; dynasty_name: string }>(
    `SELECT p.slug, p.title, a.name AS author_name, d.name AS dynasty_name
     FROM poems_fts f
     JOIN poems p ON p.rowid = f.rowid
     JOIN authors a ON p.author_slug = a.slug
     JOIN dynasties d ON p.dynasty_slug = d.slug
     WHERE poems_fts MATCH ?
     ORDER BY rank, p.slug LIMIT ? OFFSET ?`,
    [toFtsMatch(q), limit, offset]
  );
  return rows.map(toSearchItem);
}

/** LIKE 路径：作者名走 authors 小表（2.2 万行）+ 标题走 poems，避开 JOIN+OR 的全表扫描 */
async function searchPoemsLike(q: string, offset: number, limit: number): Promise<PoemSearchItem[]> {
  const pattern = `%${q}%`;
  const rows = await query<{ slug: string; title: string; author_name: string; dynasty_name: string }>(
    `SELECT slug, title, author_name, dynasty_name FROM (
       SELECT p.slug AS slug, p.title AS title, a.name AS author_name, d.name AS dynasty_name
       FROM poems p
       JOIN authors a ON p.author_slug = a.slug
       JOIN dynasties d ON p.dynasty_slug = d.slug
       WHERE p.author_slug IN (SELECT slug FROM authors WHERE name LIKE ?)
       UNION
       SELECT p.slug, p.title, a.name, d.name
       FROM poems p
       JOIN authors a ON p.author_slug = a.slug
       JOIN dynasties d ON p.dynasty_slug = d.slug
       WHERE p.title LIKE ?
     ) ORDER BY slug LIMIT ? OFFSET ?`,
    [pattern, pattern, limit, offset]
  );
  return rows.map(toSearchItem);
}

/**
 * 关键词搜索：标题或作者名。
 * 主路径是 FTS5 倒排索引（任何长度查询都是毫秒级）；
 * 仅当库中缺少 poems_fts（旧库/老 Release）时才回退 LIKE（实测 3~11s）。
 */
export async function searchPoems(q: string, offset = 0, limit = 50): Promise<PoemSearchItem[]> {
  try {
    return await searchPoemsFts(q, offset, limit);
  } catch {
    /* poems_fts 不存在等，回退 LIKE */
    return await searchPoemsLike(q, offset, limit);
  }
}

export async function countSearchPoems(q: string): Promise<number> {
  try {
    return await queryNumber("SELECT COUNT(*) AS c FROM poems_fts WHERE poems_fts MATCH ?", [toFtsMatch(q)]);
  } catch {
    /* 回退 LIKE */
  }
  const pattern = `%${q}%`;
  return queryNumber(
    `SELECT COUNT(*) AS c FROM (
       SELECT p.slug FROM poems p WHERE p.author_slug IN (SELECT slug FROM authors WHERE name LIKE ?)
       UNION
       SELECT p.slug FROM poems p WHERE p.title LIKE ?
     )`,
    [pattern, pattern]
  );
}

export async function countPoems(): Promise<number> {
  return queryNumber("SELECT COUNT(*) as c FROM poems");
}

export async function countAuthors(): Promise<number> {
  return queryNumber("SELECT COUNT(*) as c FROM authors");
}

export async function countDynasties(): Promise<number> {
  return queryNumber("SELECT COUNT(*) as c FROM dynasties");
}

/** 随机取 n 首诗的 slug（用于首页推荐、随机一首） */
export async function getRandomPoemSlugs(n: number): Promise<string[]> {
  const rows = await query<{ slug: string }>("SELECT slug FROM poems ORDER BY RANDOM() LIMIT ?", [n]);
  return rows.map((r) => r.slug);
}

/**
 * 随机取 n 首诗的列表信息（一次查询，避免 N+1）。
 * @param richOnly 为 true 时只从 poem_rich 视图（译文/注释/赏析至少一项非空）随机，用于首页推荐；
 *                 为 false 时从全量 poems 随机，用于「随机一首」。
 */
export async function getRandomPoemsForList(n: number, richOnly = false): Promise<Array<{
  slug: string;
  title: string;
  author_name: string;
  dynasty_name?: string;
  rhythmic?: string;
  excerpt?: string;
}>> {
  type Row = {
    slug: string;
    title: string;
    excerpt: string | null;
    rhythmic: string | null;
    author_name: string;
    dynasty_name: string;
  };
  const COLS = `SELECT p.slug, p.title, p.excerpt, p.rhythmic,
            a.name AS author_name, d.name AS dynasty_name
     FROM poems p
     JOIN authors a ON p.author_slug = a.slug
     JOIN dynasties d ON p.dynasty_slug = d.slug`;
  const toList = (rows: Row[]) =>
    rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      author_name: r.author_name,
      dynasty_name: getDynastyDisplayName(r.dynasty_name) || r.dynasty_name,
      rhythmic: r.rhythmic ?? undefined,
      excerpt: r.excerpt ?? undefined,
    }));

  if (richOnly) {
    // 富化随机用 poems.has_content（命中 idx_poems_has_content，实测 0.01s）。
    // 原实现从 poem_rich 视图随机：视图要全表扫 poem_content（483MB BLOB）才能物化，
    // 实测 24s，是「启动后卡顿一阵才加载出来」的根因。
    const rows = await query<Row>(`${COLS} WHERE p.has_content = 1 ORDER BY RANDOM() LIMIT ?`, [n]);
    return toList(rows);
  }

  // 全量随机：先随机取 slug（只扫 poems，约 0.6s）再取详情，
  // 避免直接对 47 万行结果集做 JOIN 再整体排序（实测 2.8s）。
  const slugs = await getRandomPoemSlugs(n);
  if (!slugs.length) return [];
  const placeholders = slugs.map(() => "?").join(", ");
  const rows = await query<Row>(`${COLS} WHERE p.slug IN (${placeholders})`, slugs);
  return toList(rows);
}

/** 按作者 slug 查其诗词列表（分页） */
export async function getPoemsByAuthorSlug(authorSlug: string, offset = 0, limit = 50): Promise<Poem[]> {
  const rows = await query<PoemListRow>(
    `SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
            a.name AS author_name, d.name AS dynasty_name
     FROM poems p
     JOIN authors a ON p.author_slug = a.slug
     JOIN dynasties d ON p.dynasty_slug = d.slug
     WHERE p.author_slug = ? ORDER BY p.slug LIMIT ? OFFSET ?`,
    [authorSlug, limit, offset]
  );
  return rows.map(rowToListPoem);
}

/** 按标签 slug 查诗词列表（含 excerpt、rhythmic，供列表页展示）；走 poem_tags 索引 */
export async function getPoemsByTag(
  tagSlug: string,
  offset = 0,
  limit = 500
): Promise<Array<PoemSearchItem & { rhythmic?: string; excerpt?: string }>> {
  const rows = await query<{
    slug: string;
    title: string;
    rhythmic: string | null;
    excerpt: string | null;
    author_name: string;
    dynasty_name: string;
  }>(
    `SELECT p.slug, p.title, p.rhythmic, p.excerpt,
            a.name AS author_name, d.name AS dynasty_name
     FROM poems p
     JOIN poem_tags pt ON p.slug = pt.poem_slug
     JOIN authors a ON p.author_slug = a.slug
     JOIN dynasties d ON p.dynasty_slug = d.slug
     WHERE pt.tag_slug = ? ORDER BY p.slug LIMIT ? OFFSET ?`,
    [tagSlug, limit, offset]
  );
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    author_name: r.author_name,
    dynasty_name: r.dynasty_name,
    title_pinyin: undefined,
    tags: undefined,
    rhythmic: r.rhythmic ?? undefined,
    excerpt: r.excerpt ?? undefined,
  }));
}

/** 按标签 slug 统计诗词数量 */
export async function countPoemsByTag(tagSlug: string): Promise<number> {
  return queryNumber("SELECT COUNT(*) as c FROM poem_tags WHERE tag_slug = ?", [tagSlug]);
}

/** 供分层 SSG 使用：取前 limit 条诗的 slug（按 dynasty_slug, slug 稳定顺序），不全表加载 */
export async function getPoemSlugsForSSG(limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await query<{ slug: string }>("SELECT slug FROM poems ORDER BY dynasty_slug, slug LIMIT ?", [limit]);
  return rows.map((r) => r.slug);
}

/** 供分层 SSG 使用：从热门选集 tag（curated 或 BUILD_SSG_TAG_SLUGS）收集诗文 slug，去重后取前 limit 个 */
export async function getPoemSlugsForSSGByPopularTags(limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const tagSlugs = getSSGTagSlugs();
  if (tagSlugs.length === 0) return [];
  const existingTags = await getTags();
  const existingSlugSet = new Set(existingTags.map((t) => t.slug));
  const slugs = new Set<string>();
  for (const tagSlug of tagSlugs) {
    if (!existingSlugSet.has(tagSlug)) continue;
    const list = await getPoemsByTag(tagSlug, 0, SSG_MAX_SLUGS_PER_TAG);
    for (const item of list) slugs.add(item.slug);
    if (slugs.size >= limit) break;
  }
  return Array.from(slugs).slice(0, limit);
}

/** 供分层 SSG 使用：取前 limit 个作者的 slug（按 poem_count DESC），不全表加载 */
export async function getAuthorSlugsForSSG(limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await query<{ slug: string }>("SELECT slug FROM authors ORDER BY poem_count DESC LIMIT ?", [limit]);
  return rows.map((r) => r.slug);
}

/** 供 sitemap 分片使用：按 slug 稳定顺序分页取作者 slug */
export async function getAuthorSlugsForSitemap(limit: number, offset: number): Promise<string[]> {
  if (limit <= 0 || offset < 0) return [];
  const rows = await query<{ slug: string }>(
    "SELECT slug FROM authors ORDER BY slug LIMIT ? OFFSET ?",
    [limit, offset]
  );
  return rows.map((r) => r.slug);
}

/** 供 sitemap 分片使用：按 dynasty_slug, slug 稳定顺序分页取诗 slug */
export async function getPoemSlugsForSitemap(limit: number, offset: number): Promise<string[]> {
  if (limit <= 0 || offset < 0) return [];
  const rows = await query<{ slug: string }>(
    "SELECT slug FROM poems ORDER BY dynasty_slug, slug LIMIT ? OFFSET ?",
    [limit, offset]
  );
  return rows.map((r) => r.slug);
}
