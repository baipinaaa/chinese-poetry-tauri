/**
 * 数据访问层（桌面版）：替代原 Web 版 Next.js 的 `/api/*` 路由。
 *
 * 内部全部调用 `lib/db.ts`（由另一任务实现，导出名与原 `lib/db/queries.ts` 一致，且均为 async）。
 * 函数签名、过滤参数与返回形状尽量保留原 API 语义，便于页面组件直接复用。
 * 若某个 db 函数在桌面版被降级，仍照常调用（返回空数组即可）。
 */

import {
  getPoemsAll,
  getPoemsByDynasty,
  getPoemsByTag,
  countPoemsByTag,
  getPoemsByAuthorSlug,
  getPoemsByRhythmic,
  countPoemsByRhythmic,
  getRhythmics,
  searchPoems,
  countSearchPoems,
  countPoems,
  countAuthors,
  countDynasties,
  getDynasties,
  getAuthors,
  getTags,
  getRandomPoemsForList,
  getAuthorByName,
  getPoemBySlug,
} from "./db";
import type {
  Author,
  Dynasty,
  Poem,
  PoemListItem,
  PoemListQuery,
  PoemListResult,
  Rhythmic,
  SidebarData,
  SiteStats,
  Tag,
} from "./types";

/**
 * 静态数据缓存（进程内）。
 *
 * 桌面版的数据库是随包分发的只读文件，同一次运行内朝代 / 标签 / 词牌 / 诗人不会变化，
 * 但侧边栏、筛选器、首页统计在每次进入页面时都会重新查一遍：
 * getAuthors(0, 500) 实测 ~92ms、getRhythmics ~14ms，叠加起来正是「进页面先卡一下」。
 * 这里按 key 缓存首次结果；失败不缓存（例如数据库尚未就绪时，下次会重试）。
 */
const staticCache = new Map<string, unknown>();

function cachedStatic<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const hit = staticCache.get(key);
  if (hit !== undefined) return Promise.resolve(hit as T);
  return factory().then((value) => {
    staticCache.set(key, value);
    return value;
  });
}

/** 切换数据库后调用：清空缓存，避免沿用到上一个库的数据（DbGate 在路径变化时调用） */
export function resetStaticCache(): void {
  staticCache.clear();
}

/** 列表页默认每页条数（与原 GET /api/poems 一致） */
export const DEFAULT_POEMS_LIMIT = 20;
/** 每页上限（与原 GET /api/poems 一致） */
export const MAX_POEMS_LIMIT = 500;
/** 摘要截断长度（与原 API 一致） */
const EXCERPT_MAX_LEN = 30;

/** 随机推荐/随机一首返回的条目形状（与原 GET /api/poems/random 一致） */
export interface RandomPoemItem {
  slug: string;
  title: string;
  author_name: string;
  dynasty_name?: string;
  rhythmic?: string;
  excerpt?: string;
}

/** 作者分页响应（与原 GET /api/authors 一致） */
export interface AuthorListResult {
  items: Author[];
  total: number;
  offset: number;
  limit: number;
}

/** 由正文首句生成摘要 */
function excerptFromParagraphs(paragraphs: string[] | undefined): string | undefined {
  if (!paragraphs?.length) return undefined;
  const first = paragraphs[0]?.trim() ?? "";
  if (first.length <= EXCERPT_MAX_LEN) return first || undefined;
  return first.slice(0, EXCERPT_MAX_LEN) + "…";
}

/** 完整 Poem → 列表项（字段名保持 snake_case） */
function poemToItem(p: Poem): PoemListItem {
  return {
    slug: p.slug,
    title: p.title,
    author_name: p.author,
    author_slug: p.authorSlug,
    dynasty_name: p.dynasty,
    dynasty_slug: p.dynastySlug,
    rhythmic: p.rhythmic,
    excerpt: p.excerpt ?? excerptFromParagraphs(p.paragraphs),
  };
}

/**
 * 诗文列表 / 搜索 / 按朝代·标签·词牌筛选（分页）。
 * 复刻原 GET /api/poems 的分支逻辑：rhythmic > dynasty > tag > q > 全部。
 * 朝代/标签/词牌参数支持 slug 或中文名双向匹配。
 */
export async function fetchPoems(query: PoemListQuery = {}): Promise<PoemListResult> {
  const dynasty = query.dynasty ?? "";
  const q = (query.q ?? "").trim();
  const tag = (query.tag ?? "").trim();
  const rhythmic = (query.rhythmic ?? "").trim();
  const page = Math.max(1, Math.trunc(query.page ?? 1) || 1);
  const limit = Math.min(
    MAX_POEMS_LIMIT,
    Math.max(1, Math.trunc(query.limit ?? DEFAULT_POEMS_LIMIT) || DEFAULT_POEMS_LIMIT),
  );
  const offset = (page - 1) * limit;

  let items: PoemListItem[] = [];
  let total = 0;

  if (rhythmic) {
    const rhythmics = await getRhythmics();
    const rh = rhythmics.find((r) => r.slug === rhythmic || r.name === rhythmic);
    if (!rh) return { items: [], total: 0, page, limit };
    const list = await getPoemsByRhythmic(rh.name, offset, limit);
    total = await countPoemsByRhythmic(rh.name);
    items = list.map(poemToItem);
  } else if (dynasty) {
    const dynasties = await getDynasties();
    const dyn = dynasties.find((d) => d.slug === dynasty || d.name === dynasty);
    if (!dyn) return { items: [], total: 0, page, limit };
    const list = await getPoemsByDynasty(dyn.slug, offset, limit);
    total = dyn.poem_count;
    items = list.map(poemToItem);
  } else if (tag) {
    const tags = await getTags();
    const tagSlug = tags.find((t) => t.slug === tag || t.name === tag)?.slug;
    if (!tagSlug) return { items: [], total: 0, page, limit };
    const list = await getPoemsByTag(tagSlug, offset, limit);
    total = await countPoemsByTag(tagSlug);
    items = list.map((p) => ({
      slug: p.slug,
      title: p.title,
      author_name: p.author_name,
      dynasty_name: p.dynasty_name,
      rhythmic: p.rhythmic,
      excerpt: p.excerpt,
    }));
  } else if (q) {
    const authors = await getAuthors(0, 10000);
    const authorMatch = authors.find((a) => a.name === q);
    if (authorMatch) {
      const list = await getPoemsByAuthorSlug(authorMatch.slug, offset, limit);
      total = authorMatch.poem_count;
      items = list.map(poemToItem);
    } else {
      const list = await searchPoems(q, offset, limit);
      total = await countSearchPoems(q);
      items = list.map((p) => ({
        slug: p.slug,
        title: p.title,
        author_name: p.author_name,
        dynasty_name: p.dynasty_name,
        rhythmic: undefined,
        excerpt: undefined,
      }));
    }
  } else {
    const list = await getPoemsAll(offset, limit);
    total = await countPoems();
    items = list.map(poemToItem);
  }

  return { items, total, page, limit };
}

/** 作者列表（分页），复刻原 GET /api/authors */
export async function fetchAuthors(offset = 0, limit = 40): Promise<AuthorListResult> {
  const safeOffset = Math.max(0, Math.trunc(offset) || 0);
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit) || 40));
  const items = await getAuthors(safeOffset, safeLimit);
  const total = await countAuthors();
  return { items, total, offset: safeOffset, limit: safeLimit };
}

/** 朝代列表，复刻原 GET /api/dynasties（静态数据，走缓存） */
export function fetchDynasties(): Promise<Dynasty[]> {
  return cachedStatic("dynasties", () => getDynasties());
}

/** 标签列表，复刻原 GET /api/tags（静态数据，走缓存） */
export function fetchTags(): Promise<Tag[]> {
  return cachedStatic("tags", () => getTags());
}

/** 词牌列表，复刻原 GET /api/rhythmics（静态数据，走缓存） */
export function fetchRhythmics(): Promise<Rhythmic[]> {
  return cachedStatic("rhythmics", () => getRhythmics());
}

/**
 * 随机取 n 首（列表信息，一次查询），复刻原 GET /api/poems/random
 * @param richOnly 为 true 时只从 poem_rich 视图取（有译文/注释/赏析的名篇），用于首页推荐
 */
export async function fetchRandomPoems(n = 10, richOnly = false): Promise<RandomPoemItem[]> {
  const safeN = Math.min(50, Math.max(1, Math.trunc(n) || 10));
  const rows = await getRandomPoemsForList(safeN, richOnly);
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    author_name: r.author_name,
    dynasty_name: r.dynasty_name,
    rhythmic: r.rhythmic,
    excerpt: r.excerpt,
  }));
}

/** 按姓名精确匹配作者（原 GET /api/authors/by-name，未找到返回 null） */
export async function fetchAuthorByName(name: string): Promise<Author | null> {
  const author = await getAuthorByName(name);
  return author ?? null;
}

/** 单首诗详情 */
export function fetchPoemBySlug(slug: string): Promise<Poem | undefined> {
  return getPoemBySlug(slug);
}

/** 站点统计（首页用；只读库在运行期内不变，走缓存） */
export function fetchSiteStats(): Promise<SiteStats> {
  return cachedStatic("siteStats", async () => {
    const [poems, authors, dynasties] = await Promise.all([
      countPoems(),
      countAuthors(),
      countDynasties(),
    ]);
    return { poems, authors, dynasties };
  });
}

/** 侧边栏数据（朝代 / 热门诗人 / 标签 / 词牌；静态数据，走缓存） */
export function fetchSidebarData(): Promise<SidebarData> {
  return cachedStatic("sidebar", async () => {
    const [dynasties, authors, tags, rhythmics] = await Promise.all([
      // 复用子缓存条目，避免与筛选器各查一遍
      fetchDynasties(),
      getAuthors(0, 500),
      fetchTags(),
      fetchRhythmics(),
    ]);
    return { dynasties, authors, tags, rhythmics };
  });
}
