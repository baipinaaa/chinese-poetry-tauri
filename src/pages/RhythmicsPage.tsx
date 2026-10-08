/**
 * 词牌列表：链接到该词牌下诗词。支持客户端按名称过滤。
 * 移植自 Web 版 app/rhythmics/page.tsx（移除 metadata 与 ISR revalidate）。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useEffect } from "react";
import { getRhythmics } from "../lib/db";
import { useAsync } from "../lib/use-async";
import LayoutWithSidebar from "../components/LayoutWithSidebar";
import SidebarLeft from "../components/SidebarLeft";
import FilterableList from "../components/FilterableList";

/** 列表加载骨架（沿用全局 loading.tsx 风格） */
function RhythmicsSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-10 w-full max-w-xs rounded-md bg-secondary/10" />
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-secondary/10 p-4">
            <div className="h-4 w-20 rounded bg-secondary/15" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 词牌列表：链接到该词牌下诗词。支持客户端按名称过滤。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */
export default function RhythmicsPage() {
  useEffect(() => {
    document.title = "词牌";
  }, []);

  const { data, loading, error } = useAsync(() => getRhythmics(), []);

  return (
    <LayoutWithSidebar sidebarLeft={<SidebarLeft />}>
      <div className="max-w-4xl space-y-8">
        <h1 className="font-serif text-2xl font-bold text-primary md:text-3xl">词牌</h1>
        <p className="text-text/70">按词牌浏览宋词等，点击进入该词牌下的作品列表。</p>
        {loading ? (
          <RhythmicsSkeleton />
        ) : error ? (
          <p className="text-text/70">加载失败：{error.message}</p>
        ) : data ? (
          <FilterableList
            items={data}
            hrefPrefix="/poems/?rhythmic="
            placeholder="搜索词牌…"
            emptyText="暂无数据。去浏览诗文"
          />
        ) : null}
      </div>
    </LayoutWithSidebar>
  );
}
