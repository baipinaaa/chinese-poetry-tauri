/**
 * 诗词详情：正文、拼音、作者、朝代；阅读设置。数据来自本地 SQLite。
 * 桌面版移植：原 Web 版 app/poems/[slug]/page.tsx
 *  - 服务端 await + notFound() → useParams + useAsync 客户端取数
 *  - generateStaticParams / generateMetadata / JSON-LD 移除，标题改用 document.title
 *  - next/link → react-router-dom Link
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchPoemBySlug, fetchPoems } from "../lib/api";
import { useAsync } from "../lib/use-async";
import LayoutWithSidebar from "../components/LayoutWithSidebar";
import SidebarLeft from "../components/SidebarLeft";
import PoemDetailSidebar from "../components/PoemDetailSidebar";
import PoemReader from "../components/PoemReader";
import { ReadingSettingsProvider } from "../context/ReadingSettingsContext";

/** 详情页侧栏「同朝代」最多展示条数 */
const SAME_DYNASTY_PREVIEW_LIMIT = 10;

/** 详情页加载骨架 */
function PoemDetailSkeleton() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-6">
      <div className="mx-auto h-8 w-48 rounded bg-secondary/20" />
      <div className="mx-auto h-4 w-32 rounded bg-secondary/10" />
      <div className="space-y-3 pt-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mx-auto h-5 w-2/3 rounded bg-secondary/10" />
        ))}
      </div>
    </div>
  );
}

export default function PoemDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { data: poem, loading } = useAsync(() => fetchPoemBySlug(slug), [slug]);

  const dynastySlug = poem?.dynastySlug ?? "";
  const { data: sameDynastyResult } = useAsync(
    () =>
      dynastySlug
        ? fetchPoems({ dynasty: dynastySlug, page: 1, limit: SAME_DYNASTY_PREVIEW_LIMIT + 1 })
        : Promise.resolve(null),
    [dynastySlug]
  );
  const sameDynastyPoems = (sameDynastyResult?.items ?? [])
    .filter((p) => p.slug !== slug)
    .slice(0, SAME_DYNASTY_PREVIEW_LIMIT);

  useEffect(() => {
    document.title = poem
      ? `《${poem.title}》 - ${poem.author}`
      : loading
        ? "诗词"
        : "未找到";
  }, [poem, loading]);

  if (loading) {
    return (
      <LayoutWithSidebar sidebarLeft={<SidebarLeft />}>
        <PoemDetailSkeleton />
      </LayoutWithSidebar>
    );
  }

  if (!poem) {
    return (
      <LayoutWithSidebar sidebarLeft={<SidebarLeft />}>
        <div className="mx-auto max-w-2xl space-y-4 text-center">
          <h1 className="font-serif text-2xl font-bold text-primary md:text-3xl">未找到该诗词</h1>
          <p className="text-text/70">该诗词可能已被移除，或链接有误。</p>
          <p>
            <Link to="/poems" className="cursor-pointer text-primary hover:underline">
              ← 返回诗文列表
            </Link>
          </p>
        </div>
      </LayoutWithSidebar>
    );
  }

  return (
    <ReadingSettingsProvider>
      <LayoutWithSidebar
        sidebarLeft={<SidebarLeft />}
        sidebarRight={
          <PoemDetailSidebar poem={poem} sameDynastyPoems={sameDynastyPoems} />
        }
      >
        <article className="mx-auto max-w-2xl space-y-8">
          <PoemReader
            title={poem.title}
            author={poem.author}
            authorSlug={poem.authorSlug}
            dynasty={poem.dynasty ?? ""}
            titlePinyin={poem.titlePinyin}
            authorPinyin={poem.authorPinyin}
            rhythmic={poem.rhythmic}
            tags={poem.tags ?? []}
            paragraphs={poem.paragraphs}
            paragraphsPinyin={poem.paragraphsPinyin}
            translation={poem.translation}
            annotation={poem.annotation}
            appreciation={poem.appreciation}
          />
          <p className="flex flex-wrap items-center gap-4 pt-4">
            <Link to="/poems" className="cursor-pointer text-primary hover:underline">
              ← 返回诗文列表
            </Link>
          </p>
        </article>
      </LayoutWithSidebar>
    </ReadingSettingsProvider>
  );
}
