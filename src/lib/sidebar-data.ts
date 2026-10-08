/**
 * 侧边栏静态数据（桌面版）：朝代、热门诗人、标签、词牌。
 *
 * 数据在单库内基本固定，这里在进程内存中缓存一次，避免每次切页重复查询。
 * 与原 Web 版 lib/sidebar-data.ts 同名导出 getSidebarData()，但改为本地数据库调用（无 server-only）。
 */

import { fetchSidebarData } from "./api";
import type { SidebarData } from "./types";

/** 侧边栏显示的诗人数量上限 */
const SIDEBAR_AUTHOR_LIMIT = 500;

/** 内存缓存，同一进程内只查一次 DB */
let cachedData: SidebarData | null = null;

/**
 * 获取侧边栏数据。第一次调用查询数据库，之后直接返回内存缓存。
 */
export async function getSidebarData(): Promise<SidebarData> {
  if (cachedData) return cachedData;

  const data = await fetchSidebarData();
  cachedData = {
    dynasties: data.dynasties,
    authors: data.authors.slice(0, SIDEBAR_AUTHOR_LIMIT),
    tags: data.tags,
    rhythmics: data.rhythmics,
  };
  return cachedData;
}

/** 清空缓存（例如重新导入数据库后调用） */
export function clearSidebarDataCache(): void {
  cachedData = null;
}
