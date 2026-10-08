/**
 * 通用异步数据 hook（桌面版 CSR 使用）。
 *
 * 替代 Next.js Server Component 里的「async + 直接 await」写法：
 * 页面用 useAsync(() => fetchXxx(...), [deps]) 获取数据，自行呈现 loading / error。
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** useAsync 返回状态 */
export interface AsyncResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  /** 手动重新执行（如「重试」按钮） */
  reload: () => void;
}

/**
 * 执行异步函数并在依赖变化时重新请求。
 * `fn` 通常是内联箭头函数（每次渲染都是新引用），因此仅以 `deps` 作为重新请求的依据；
 * 回调始终通过 ref 取最新值，避免闭包过期。
 */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList): AsyncResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.resolve()
      .then(() => fnRef.current())
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}

export default useAsync;
