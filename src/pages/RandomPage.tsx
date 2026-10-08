/**
 * 随机一首：本地随机取 1 首，跳转至该诗详情。
 * 桌面版移植：原 Web 版 app/poems/random/page.tsx
 *  - useRouter（next/navigation）→ useNavigate（react-router-dom），replace 用 { replace: true }
 *  - /api/poems/random → lib/api.ts 的 fetchRandomPoems
 *  - 原 app/poems/random/layout.tsx 的 metadata.title → document.title
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchRandomPoems } from "../lib/api";

export default function RandomPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "done">("loading");

  useEffect(() => {
    document.title = "随机一首";
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await fetchRandomPoems(1);
        if (cancelled) return;
        if (!Array.isArray(data) || data.length === 0) {
          navigate("/poems", { replace: true });
          return;
        }
        const slug = data[0]!.slug;
        if (!cancelled) navigate(`/poems/${slug}`, { replace: true });
      } catch {
        if (!cancelled) navigate("/poems", { replace: true });
      } finally {
        if (!cancelled) setStatus("done");
      }
    })();
  }, [navigate]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-text/70">
        随机抽取中…
      </div>
    );
  }
  return null;
}
