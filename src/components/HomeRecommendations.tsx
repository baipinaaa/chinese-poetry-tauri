/**
 * 首页推荐几首：直接调用本地随机查询，每次访问推荐不同。
 * 桌面版移植：原 Web 版 components/HomeRecommendations.tsx，/api/poems/random → lib/api.ts 的 fetchRandomPoems。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { fetchRandomPoems, type RandomPoemItem } from "../lib/api";

const DEFAULT_COUNT = 10;

export default function HomeRecommendations({ count = DEFAULT_COUNT }: { count?: number }) {
  const [items, setItems] = useState<RandomPoemItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await fetchRandomPoems(count);
        if (cancelled) return;
        if (!Array.isArray(data) || data.length === 0) {
          setLoading(false);
          return;
        }
        if (!cancelled) setItems(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
  }, [count]);

  if (loading) {
    return (
      <section>
        <h2 className="mb-3 font-serif text-xl font-bold text-primary">推荐几首</h2>
        <p className="text-text/60">加载中…</p>
      </section>
    );
  }

  if (error || items.length === 0) {
    return null;
  }

  return (
    <section>
      <h2 className="mb-3 font-serif text-xl font-bold text-primary">推荐几首</h2>
      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.slug}>
            <Link
              to={`/poems/${p.slug}/`}
              className="cursor-pointer block rounded-lg border border-secondary/20 p-4 transition-colors duration-200 hover:border-primary hover:bg-secondary/10 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              <div className="text-lg font-semibold text-text">{p.title}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-text/70">
                <span>{p.author_name}</span>
                {p.dynasty_name && (
                  <>
                    <span className="text-text/50" aria-hidden>·</span>
                    <span>{p.dynasty_name}</span>
                  </>
                )}
                {p.rhythmic && (
                  <>
                    <span className="text-text/50" aria-hidden>·</span>
                    <span>{p.rhythmic}</span>
                  </>
                )}
              </div>
              {p.excerpt && (
                <div className="mt-1.5 text-sm text-text/60 line-clamp-2">{p.excerpt}</div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
