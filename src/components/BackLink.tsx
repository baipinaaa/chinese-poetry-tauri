/**
 * 「返回上一页」：优先走浏览历史后退（navigate(-1)），
 * 仅当栈里确实没有上一页时（冷启动直接进详情页、或从外部深链接进入）
 * 才退化为 fallbackTo 指定的默认路由。
 *
 * 判断依据是 history.state.idx：
 * react-router-dom v6 的 createHashHistory 会给每个 location 在 state 上记录栈内下标，
 * 计数器从 0 开始（首屏 idx === 0），push 时 +1、replace 时保持不变，
 * 因此 idx > 0 就说明存在可退回的上一页。
 * 用 idx 而非 location.key 判断，是因为 replace 也会换 key 但并未新增历史。
 *
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

interface BackLinkProps {
  /** 无历史可退时的兜底路由，例如 /poems */
  fallbackTo: string;
  /** 兜底链接的文案，例如「返回诗文列表」 */
  fallbackLabel: string;
  /** 有历史可退时的文案，默认「返回上一页」 */
  label?: string;
  /** 追加的样式类；交互样式由组件内置 */
  className?: string;
}

/** 与全站文字链接一致的交互样式；button 与 Link 共用，故显式清掉 button 默认外观 */
const BASE_CLASS =
  "inline cursor-pointer border-0 bg-transparent p-0 text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2";

export default function BackLink({
  fallbackTo,
  fallbackLabel,
  label = "返回上一页",
  className,
}: BackLinkProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // 依赖 location：每次导航后重新求值，使按钮/链接在栈变化时切换形态
  const canGoBack = useMemo(() => {
    const state = window.history.state as { idx?: number } | null;
    return typeof state?.idx === "number" && state.idx > 0;
  }, [location]);

  const cls = className ? `${BASE_CLASS} ${className}` : BASE_CLASS;

  if (!canGoBack) {
    return (
      <Link to={fallbackTo} className={cls}>
        ← {fallbackLabel}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => navigate(-1)} className={cls}>
      ← {label}
    </button>
  );
}
