/**
 * 诗词相关类型（桌面版）。字段名与原 Web 版 lib/types.ts、API 返回保持一致，
 * 以便组件代码可直接复用。
 */

/** 单首诗（详情页用；拼音由前端 pinyin-pro 实时计算） */
export interface Poem {
  /** 唯一标识，用于 URL 与 DB 主键 */
  slug: string;
  title: string;
  author: string;
  dynasty: string;
  tags: string[];
  titleSlug: string;
  authorSlug: string;
  dynastySlug: string;
  id: string;
  titlePinyin?: string;
  authorPinyin?: string;
  dynastyPinyin?: string;
  paragraphs: string[];
  /** 每句正文对应拼音（与 paragraphs 一一对应） */
  paragraphsPinyin?: string[];
  /** 译文（## 译文 区块） */
  translation?: string;
  /** 赏析（## 赏析 区块） */
  appreciation?: string;
  /** 注释（## 注释 区块） */
  annotation?: string;
  /** 词牌名（宋词、花间集等） */
  rhythmic?: string;
  /** 列表用摘要（首句截断） */
  excerpt?: string;
}

/** 列表项（/api/poems 返回的 items 元素，字段为 snake_case，与原 Web 版一致） */
export interface PoemListItem {
  slug: string;
  title: string;
  author_name: string;
  dynasty_name?: string;
  author_slug?: string;
  dynasty_slug?: string;
  rhythmic?: string;
  excerpt?: string;
}

/** 列表查询结果（对应原 GET /api/poems 的响应体） */
export interface PoemListResult {
  items: PoemListItem[];
  total: number;
  page: number;
  limit: number;
}

/** 搜索索引单条 */
export interface PoemSearchItem {
  slug: string;
  title: string;
  author_name: string;
  dynasty_name: string;
  title_pinyin?: string;
  tags?: string[];
}

/** 作者 */
export interface Author {
  slug: string;
  name: string;
  poem_count: number;
  /** 作者简介，来自 bio.md 正文 */
  description?: string;
}

/** 朝代 */
export interface Dynasty {
  slug: string;
  name: string;
  poem_count: number;
}

/** 标签 */
export interface Tag {
  slug: string;
  name: string;
  poem_count: number;
}

/** 词牌 */
export interface Rhythmic {
  slug: string;
  name: string;
  poem_count: number;
}

/** 侧边栏静态数据 */
export interface SidebarData {
  dynasties: Dynasty[];
  authors: Array<{ slug: string; name: string; poem_count: number }>;
  tags: Tag[];
  rhythmics: Rhythmic[];
}

/** 站点统计 */
export interface SiteStats {
  poems: number;
  authors: number;
  dynasties: number;
}

/** 诗词列表查询参数（对应原 /api/poems 的 query） */
export interface PoemListQuery {
  dynasty?: string;
  tag?: string;
  rhythmic?: string;
  q?: string;
  page?: number;
  limit?: number;
}
