/**
 * 首页：统计、入口、推荐几首（客户端本地随机查询）。
 * 桌面版移植：原 Web 版 app/page.tsx
 *  - 服务端 countPoems/countAuthors/countDynasties → useAsync(fetchSiteStats)
 *  - metadata / JSON-LD / process.env.NEXT_PUBLIC_SITE_URL 移除，标题改用 document.title
 *  - SidebarLeftServer（服务端预取）→ SidebarLeft 客户端组件
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { fetchSiteStats } from "../lib/api";
import { useAsync } from "../lib/use-async";
import LayoutWithSidebar from "../components/LayoutWithSidebar";
import SidebarLeft from "../components/SidebarLeft";
import HomeRecommendations from "../components/HomeRecommendations";

const HOME_RECOMMEND_SIZE = 10;

export default function HomePage() {
  const { data: stats, loading, error } = useAsync(() => fetchSiteStats(), []);

  useEffect(() => {
    document.title = "诗词";
  }, []);

  return (
    <LayoutWithSidebar sidebarLeft={<SidebarLeft />}>
      <div className="space-y-10">
        <section className="text-center">
          <h1 className="font-serif text-3xl font-bold text-primary md:text-4xl">
            诗词
          </h1>
          <p className="mt-2 text-text/80">中文诗词阅读与浏览</p>
          {loading ? (
            <div className="mt-3 flex justify-center">
              <div className="h-4 w-64 animate-pulse rounded bg-secondary/10" />
            </div>
          ) : stats ? (
            <p className="mt-3 text-sm text-text/60">
              共 {stats.poems.toLocaleString()} 首诗词 · {stats.authors.toLocaleString()} 位诗人 · {stats.dynasties} 个朝代
            </p>
          ) : error ? (
            <p className="mt-3 text-sm text-text/60">统计数据加载失败</p>
          ) : null}
        </section>
        <section className="flex flex-wrap justify-center gap-4">
          <Link
            to="/poems"
            className="cursor-pointer rounded-lg bg-primary px-6 py-3 font-medium text-white transition-colors hover:bg-secondary"
          >
            浏览诗文
          </Link>
          <Link
            to="/poems/random"
            className="cursor-pointer rounded-lg border-2 border-primary px-6 py-3 font-medium text-primary transition-colors hover:bg-primary hover:text-white"
          >
            随机一首
          </Link>
          <Link
            to="/authors"
            className="cursor-pointer rounded-lg border-2 border-cta px-6 py-3 font-medium text-cta transition-colors hover:bg-cta hover:text-white"
          >
            诗人
          </Link>
          <Link
            to="/dynasties"
            className="cursor-pointer rounded-lg border-2 border-secondary px-6 py-3 font-medium text-secondary transition-colors hover:bg-secondary hover:text-white"
          >
            朝代
          </Link>
        </section>
        <HomeRecommendations count={HOME_RECOMMEND_SIZE} />
      </div>
    </LayoutWithSidebar>
  );
}
