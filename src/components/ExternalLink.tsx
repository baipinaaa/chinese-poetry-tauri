/**
 * 外链：桌面版（Tauri）下用系统浏览器打开，Web 环境退化为 window.open。
 *
 * 为什么需要它：Tauri 的 WebView 里 `<a target="_blank">` 默认会被拦截/在应用内打开，
 * 外部链接因此不生效；这里统一拦截点击并交给 tauri-plugin-opener。
 * 内部路由链接请继续使用 react-router-dom 的 `<Link>`。
 *
 * 用法：`<ExternalLink href="https://…" target="_blank" rel="noopener noreferrer">…</ExternalLink>`
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import type { AnchorHTMLAttributes, MouseEvent, ReactElement } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/** 与原生 `<a>` 一致，仅将 href 收紧为必填 */
export type ExternalLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

/** 是否运行在 Tauri 的 WebView 中（Tauri v2 注入 __TAURI_INTERNALS__） */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 外链组件：点击后阻止默认跳转，Tauri 环境走系统浏览器，其它环境走 window.open。
 * `className` / `target` / `rel` 等属性原样透传到 `<a>`。
 */
export default function ExternalLink({
  href,
  onClick,
  ...rest
}: ExternalLinkProps): ReactElement {
  const handleClick = async (event: MouseEvent<HTMLAnchorElement>): Promise<void> => {
    onClick?.(event);
    // 调用方已自行处理（例如 preventDefault 后做别的导航）则不接管
    if (event.defaultPrevented) return;

    event.preventDefault();

    if (isTauri()) {
      try {
        await openUrl(href);
      } catch (error) {
        console.error("[ExternalLink] Tauri openUrl 失败，退回 window.open：", error);
        window.open(href, "_blank", "noopener");
      }
      return;
    }

    window.open(href, "_blank", "noopener");
  };

  return <a href={href} onClick={handleClick} {...rest} />;
}
