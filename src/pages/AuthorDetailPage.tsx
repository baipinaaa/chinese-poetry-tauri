/**
 * 诗人详情：作者名、诗作数量、生平（若有）、名下诗词列表分页。
 * 移植自 Web 版 app/authors/[slug]/page.tsx：
 * - useParams 取 slug，useSearchParams 取 page；
 * - notFound() 改为页内「未找到」提示；
 * - 移除 SEO 用的 generateMetadata / JSON-LD / SSG，标题改用 document.title。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { formatLifespan, getAuthorBySlug, getPoemsByAuthorSlug } from "../lib/db";
import type { Author, Poem } from "../lib/types";
import { useAsync } from "../lib/use-async";
import BackLink from "../components/BackLink";
import LayoutWithSidebar from "../components/LayoutWithSidebar";
import SidebarLeft from "../components/SidebarLeft";
import Pagination from "../components/Pagination";

/** 作者详情页诗文每页条数，与诗人列表页一致 */
const PAGE_SIZE = 40;

/** 页面数据：作者信息 + 当前页诗文 */
interface AuthorDetailData {
  author: Author | null;
  poems: Poem[];
  totalPages: number;
  currentPage: number;
}

/** 作者详情加载骨架 */
function AuthorDetailSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-24 rounded bg-secondary/20" />
      <div className="h-4 w-20 rounded bg-secondary/10" />
      <div className="rounded-lg border border-secondary/10 p-6">
        <div className="h-4 w-16 rounded bg-secondary/15" />
        <div className="mt-3 h-3 w-3/4 rounded bg-secondary/10" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-secondary/10 p-3">
            <div className="h-4 w-24 rounded bg-secondary/15" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 作者详情：作者名、诗作数量、生平（若有）、名下诗词列表分页。数据来自 SQLite。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */
export default function AuthorDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const pageStr = searchParams.get("page") ?? undefined;

  const { data, loading, error } = useAsync<AuthorDetailData>(async () => {
    const author = await getAuthorBySlug(slug);
    if (!author) return { author: null, poems: [], totalPages: 1, currentPage: 1 };

    const totalPages = Math.max(1, Math.ceil(author.poem_count / PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, parseInt(pageStr ?? "1", 10) || 1), totalPages);
    const offset = (currentPage - 1) * PAGE_SIZE;
    const poems = await getPoemsByAuthorSlug(slug, offset, PAGE_SIZE);
    return { author, poems, totalPages, currentPage };
  }, [slug, pageStr]);

  const authorName = data?.author?.name;
  /** 生卒年「（1125—1210）」，无数据时为 undefined */
  const lifespan = data?.author
    ? formatLifespan(data.author.birth_year, data.author.death_year)
    : undefined;

  useEffect(() => {
    document.title = authorName ? `${authorName} - 诗人` : "未找到";
  }, [authorName]);

  // 作者不存在：对应原 notFound()，桌面版直接给页内提示
  if (!loading && !error && data && !data.author) {
    return (
      <LayoutWithSidebar sidebarLeft={<SidebarLeft />}>
        <div className="max-w-[var(--list-max-w)] space-y-8">
          <h1 className="font-serif text-2xl font-bold text-primary md:text-3xl">未找到该诗人</h1>
          <p>
            <BackLink fallbackTo="/authors" fallbackLabel="返回诗人列表" />
          </p>
        </div>
      </LayoutWithSidebar>
    );
  }

  return (
    <LayoutWithSidebar sidebarLeft={<SidebarLeft />}>
      <div className="max-w-[var(--list-max-w)] space-y-8">
        {loading ? (
          <AuthorDetailSkeleton />
        ) : error ? (
          <p className="text-text/70">加载失败：{error.message}</p>
        ) : data && data.author ? (
          <>
            <header>
              <h1 className="font-serif text-2xl font-bold text-primary md:text-3xl">
                {data.author.name}
                {lifespan ? (
                  <span className="ml-3 align-middle text-base font-normal text-text/60">
                    {lifespan}
                  </span>
                ) : null}
              </h1>
              <p className="text-text/70">共 {data.author.poem_count} 首</p>
            </header>
            {data.author.description && (
              <section className="rounded-lg border border-secondary/20 bg-background p-6 shadow-sm">
                <h2 className="mb-2 font-semibold text-primary">生平</h2>
                <div className="whitespace-pre-wrap text-text/90">{data.author.description}</div>
              </section>
            )}
            <section>
              <h2 className="mb-3 font-semibold text-primary">诗文</h2>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                {data.poems.map((p) => (
                  <li key={p.slug}>
                    <Link
                      to={`/poems/${p.slug}`}
                      className="flex cursor-pointer items-center rounded-lg border border-secondary/20 p-3 text-primary transition-colors duration-200 hover:border-primary hover:bg-secondary/10 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    >
                      <span className="min-w-0 truncate font-medium text-text">{p.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination
                currentPage={data.currentPage}
                totalPages={data.totalPages}
                basePath={`/authors/${data.author.slug}`}
              />
            </section>
            <p>
              <BackLink fallbackTo="/authors" fallbackLabel="返回诗人列表" />
            </p>
          </>
        ) : null}
      </div>
    </LayoutWithSidebar>
  );
}
