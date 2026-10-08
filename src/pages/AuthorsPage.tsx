/**
 * 诗人列表：分页 + 按名称/slug 过滤，数据来自本地 SQLite。
 * 移植自 Web 版 app/authors/page.tsx（原为 Server Component，metadata 改用 document.title）。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { countAuthors, getAuthors } from "../lib/db";
import type { Author } from "../lib/types";
import { useAsync } from "../lib/use-async";
import LayoutWithSidebar from "../components/LayoutWithSidebar";
import SidebarLeft from "../components/SidebarLeft";
import Pagination from "../components/Pagination";

const PAGE_SIZE = 40;

/** 页面数据：一次取完，避免多次 useAsync 造成闪烁 */
interface AuthorsPageData {
  authors: Author[];
  total: number;
  totalPages: number;
  currentPage: number;
}

/** 诗人列表加载骨架，沿用原 app/authors/loading.tsx 样式 */
function AuthorsSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-4 w-32 rounded bg-secondary/10" />
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-secondary/10 p-4">
            <div className="flex items-baseline justify-between">
              <div className="h-4 w-20 rounded bg-secondary/15" />
              <div className="h-3 w-10 rounded bg-secondary/10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 作者列表：分页，从 DB 读取。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */
export default function AuthorsPage() {
  const [searchParams] = useSearchParams();
  const pageStr = searchParams.get("page") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const filter = (q ?? "").trim().toLowerCase();
  const hasFilter = filter.length > 0;

  useEffect(() => {
    document.title = "诗人";
  }, []);

  const { data, loading, error } = useAsync<AuthorsPageData>(async () => {
    if (hasFilter) {
      // 有搜索词时取全量后在内存中过滤（与原页面一致）
      const raw = await getAuthors(0, 10000);
      const filtered = raw.filter(
        (a) => a.name.toLowerCase().includes(filter) || a.slug.toLowerCase().includes(filter),
      );
      return { authors: filtered, total: filtered.length, totalPages: 1, currentPage: 1 };
    }

    const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
    const total = await countAuthors();
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * PAGE_SIZE;
    const authors = await getAuthors(offset, PAGE_SIZE);
    return { authors, total, totalPages, currentPage };
  }, [filter, pageStr]);

  return (
    <LayoutWithSidebar sidebarLeft={<SidebarLeft />}>
      <div className="max-w-4xl space-y-8">
        <h1 className="font-serif text-2xl font-bold text-primary md:text-3xl">诗人</h1>
        {loading ? (
          <AuthorsSkeleton />
        ) : error ? (
          <p className="text-text/70">加载失败：{error.message}</p>
        ) : data ? (
          <>
            <p className="text-text/70">共 {data.total} 位作者</p>
            <p className="text-text/70">按诗人浏览，点击进入该作者的诗作与简介。</p>
            {data.authors.length === 0 ? (
              <p className="text-text/70">暂无数据。去浏览诗文</p>
            ) : (
              <>
                <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {data.authors.map((a) => (
                    <li key={a.slug}>
                      <Link
                        to={`/authors/${a.slug}`}
                        className="cursor-pointer flex items-baseline justify-between gap-2 rounded-lg border border-secondary/20 p-4 transition-colors duration-200 hover:border-primary hover:bg-secondary/10 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                      >
                        <span className="min-w-0 truncate font-semibold text-text">{a.name}</span>
                        <span className="shrink-0 text-sm text-text/60">{a.poem_count} 首</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {!hasFilter && (
                  <Pagination
                    currentPage={data.currentPage}
                    totalPages={data.totalPages}
                    basePath="/authors"
                  />
                )}
              </>
            )}
          </>
        ) : null}
      </div>
    </LayoutWithSidebar>
  );
}
