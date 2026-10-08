/**
 * 左侧栏：朝代、诗人、标签、词牌导航；手风琴折叠，高亮当前筛选。
 *
 * 桌面版（SPA）说明：原项目的 SidebarLeftServer（服务端取数 wrapper）不再需要，
 * 取数逻辑已合并进本组件 —— 通过 useAsync 调用 lib/sidebar-data 的 getSidebarData()
 * （进程内内存缓存，切页不会重复查库）。仍保留 initialData 可选 prop，
 * 便于将来调用方预取数据后跳过异步请求。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { Link, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSidebarData } from "../lib/sidebar-data";
import { useAsync } from "../lib/use-async";
import type { SidebarData } from "../lib/types";

/** 侧边栏预取数据（与原 Web 版同名导出，字段与 lib/types 的 SidebarData 一致） */
export type SidebarInitialData = SidebarData;

type AccordionKey = "dynasty" | "poet" | "tag" | "rhythmic";

/** 标签 / 词牌折叠面板最多展示的条目数 */
const SIDEBAR_SLICE = 12;
/** 诗人折叠面板最多展示的条目数 */
const SIDEBAR_AUTHOR_SLICE = 15;

function ChevronDown() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function SidebarLeft({ initialData }: { initialData?: SidebarInitialData } = {}) {
  const [searchParams] = useSearchParams();
  const currentDynasty = searchParams.get("dynasty") ?? "";
  const currentTag = searchParams.get("tag") ?? "";
  const currentRhythmic = searchParams.get("rhythmic") ?? "";

  /* 有 initialData 时直接用；否则读内存缓存 / 查库（getSidebarData 内部缓存） */
  const { data, loading } = useAsync<SidebarInitialData>(
    () => (initialData ? Promise.resolve(initialData) : getSidebarData()),
    [initialData],
  );

  const dynasties = data?.dynasties ?? [];
  const authors = data?.authors ?? [];
  const tags = data?.tags ?? [];
  const rhythmics = data?.rhythmics ?? [];

  const [expanded, setExpanded] = useState<Record<AccordionKey, boolean>>(() => ({
    dynasty: true,
    poet: false,
    tag: false,
    rhythmic: false,
  }));

  useEffect(() => {
    setExpanded((prev) => ({
      ...prev,
      dynasty: !!currentDynasty || (!currentTag && !currentRhythmic),
      poet: false,
      tag: !!currentTag,
      rhythmic: !!currentRhythmic,
    }));
  }, [currentDynasty, currentTag, currentRhythmic]);

  const toggle = useCallback((key: AccordionKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const basePoemsQuery = useMemo(() => {
    const q = searchParams.get("q");
    return q ? `q=${encodeURIComponent(q)}&` : "";
  }, [searchParams]);

  if (loading) {
    return (
      <div className="rounded-lg border border-secondary/20 p-4 text-sm text-text/60">
        加载中…
      </div>
    );
  }

  return (
    <nav className="space-y-1 rounded-lg border border-secondary/20 p-4" aria-label="筛选导航">
      {/* 朝代 */}
      <div className="rounded-md border border-transparent">
        <button
          type="button"
          onClick={() => toggle("dynasty")}
          aria-expanded={expanded.dynasty}
          aria-controls="sidebar-dynasty"
          className="flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-left text-sm font-semibold text-primary transition-colors duration-200 hover:bg-secondary/10"
        >
          <span>朝代</span>
          {expanded.dynasty ? <ChevronDown /> : <ChevronRight />}
        </button>
        <div
          id="sidebar-dynasty"
          aria-hidden={!expanded.dynasty}
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded.dynasty ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <ul className="space-y-1 pb-1 pt-0.5">
              {dynasties.map((d) => {
                const isActive = currentDynasty === d.name;
                const to = `/poems?${basePoemsQuery}dynasty=${encodeURIComponent(d.name)}`;
                return (
                  <li key={d.slug}>
                    <Link
                      to={to}
                      className={`cursor-pointer block truncate rounded px-2 py-1 text-sm transition-colors hover:bg-secondary/10 hover:text-primary ${
                        isActive ? "bg-primary/10 font-medium text-primary" : "text-text/90"
                      }`}
                    >
                      {d.name}
                      <span className="ml-1 text-text/50">({d.poem_count})</span>
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link
                  to="/dynasties"
                  className="cursor-pointer block rounded px-2 py-1 text-sm text-text/70 transition-colors hover:bg-secondary/10 hover:text-primary"
                >
                  全部朝代
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* 诗人 */}
      <div className="rounded-md border border-transparent">
        <button
          type="button"
          onClick={() => toggle("poet")}
          aria-expanded={expanded.poet}
          aria-controls="sidebar-poet"
          className="flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-left text-sm font-semibold text-primary transition-colors duration-200 hover:bg-secondary/10"
        >
          <span>诗人</span>
          {expanded.poet ? <ChevronDown /> : <ChevronRight />}
        </button>
        <div
          id="sidebar-poet"
          aria-hidden={!expanded.poet}
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded.poet ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <ul className="space-y-1 pb-1 pt-0.5">
              <li>
                <Link
                  to="/authors"
                  className="cursor-pointer block truncate rounded px-2 py-1 text-sm text-text/90 transition-colors hover:bg-secondary/10 hover:text-primary"
                >
                  全部诗人
                </Link>
              </li>
              {authors.slice(0, SIDEBAR_AUTHOR_SLICE).map((a) => (
                <li key={a.slug}>
                  <Link
                    to={`/authors/${a.slug}`}
                    className="cursor-pointer block truncate rounded px-2 py-1 text-sm text-text/90 transition-colors hover:bg-secondary/10 hover:text-primary"
                  >
                    {a.name}
                    <span className="ml-1 text-text/50">({a.poem_count})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="rounded-md border border-transparent">
          <button
            type="button"
            onClick={() => toggle("tag")}
            aria-expanded={expanded.tag}
            aria-controls="sidebar-tag"
            className="flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-left text-sm font-semibold text-primary transition-colors duration-200 hover:bg-secondary/10"
          >
            <span>标签</span>
            {expanded.tag ? <ChevronDown /> : <ChevronRight />}
          </button>
          <div
            id="sidebar-tag"
            aria-hidden={!expanded.tag}
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: expanded.tag ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <ul className="space-y-1 pb-1 pt-0.5">
                {tags.slice(0, SIDEBAR_SLICE).map((t) => {
                  const isActive = currentTag === t.name;
                  const to = `/poems?${basePoemsQuery}tag=${encodeURIComponent(t.name)}`;
                  return (
                    <li key={t.slug}>
                      <Link
                        to={to}
                        className={`cursor-pointer block truncate rounded px-2 py-1 text-sm transition-colors hover:bg-secondary/10 hover:text-primary ${
                          isActive ? "bg-primary/10 font-medium text-primary" : "text-text/90"
                        }`}
                      >
                        {t.name}
                        <span className="ml-1 text-text/50">({t.poem_count})</span>
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link
                    to="/tags"
                    className="cursor-pointer block rounded px-2 py-1 text-sm text-text/70 transition-colors hover:bg-secondary/10 hover:text-primary"
                  >
                    更多标签
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {rhythmics.length > 0 && (
        <div className="rounded-md border border-transparent">
          <button
            type="button"
            onClick={() => toggle("rhythmic")}
            aria-expanded={expanded.rhythmic}
            aria-controls="sidebar-rhythmic"
            className="flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-left text-sm font-semibold text-primary transition-colors duration-200 hover:bg-secondary/10"
          >
            <span>词牌</span>
            {expanded.rhythmic ? <ChevronDown /> : <ChevronRight />}
          </button>
          <div
            id="sidebar-rhythmic"
            aria-hidden={!expanded.rhythmic}
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: expanded.rhythmic ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <ul className="space-y-1 pb-1 pt-0.5">
                {rhythmics.slice(0, SIDEBAR_SLICE).map((r) => {
                  const isActive = currentRhythmic === r.name || currentRhythmic === r.slug;
                  const to = `/poems?${basePoemsQuery}rhythmic=${encodeURIComponent(r.name)}`;
                  return (
                    <li key={r.slug}>
                      <Link
                        to={to}
                        className={`cursor-pointer block truncate rounded px-2 py-1 text-sm transition-colors hover:bg-secondary/10 hover:text-primary ${
                          isActive ? "bg-primary/10 font-medium text-primary" : "text-text/90"
                        }`}
                      >
                        {r.name}
                        <span className="ml-1 text-text/50">({r.poem_count})</span>
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link
                    to="/rhythmics"
                    className="cursor-pointer block rounded px-2 py-1 text-sm text-text/70 transition-colors hover:bg-secondary/10 hover:text-primary"
                  >
                    更多词牌
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
