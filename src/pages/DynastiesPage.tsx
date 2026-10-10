/**
 * 朝代列表：链接到该朝代诗词。支持客户端按名称过滤。
 * 移植自 Web 版 app/dynasties/page.tsx（移除 metadata 与 ISR revalidate）。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useEffect } from "react";
import { getDynasties } from "../lib/db";
import { useAsync } from "../lib/use-async";
import LayoutWithSidebar from "../components/LayoutWithSidebar";
import SidebarLeft from "../components/SidebarLeft";
import FilterableList from "../components/FilterableList";

/** 列表加载骨架（沿用全局 loading.tsx 风格） */
function DynastiesSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-10 w-full max-w-xs rounded-md bg-secondary/10" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
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
 * 朝代列表：链接到该朝代诗词。支持客户端按名称过滤。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */
export default function DynastiesPage() {
  useEffect(() => {
    document.title = "朝代";
  }, []);

  const { data, loading, error } = useAsync(() => getDynasties(), []);

  return (
    <LayoutWithSidebar sidebarLeft={<SidebarLeft />}>
      <div className="max-w-[var(--list-max-w)] space-y-8">
        <h1 className="font-serif text-2xl font-bold text-primary md:text-3xl">朝代</h1>
        <p className="text-text/70">按朝代浏览诗词，点击进入该朝代下的诗作列表。</p>
        {loading ? (
          <DynastiesSkeleton />
        ) : error ? (
          <p className="text-text/70">加载失败：{error.message}</p>
        ) : data ? (
          <FilterableList
            items={data.map((d) => ({
              slug: d.slug,
              name: d.name,
              poem_count: d.poem_count,
              subtitle: d.period,
            }))}
            hrefPrefix="/poems/?dynasty="
            placeholder="搜索朝代…"
            emptyText="暂无数据。去浏览诗文"
          />
        ) : null}
      </div>
    </LayoutWithSidebar>
  );
}
