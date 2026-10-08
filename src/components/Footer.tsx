/**
 * 站脚：版权、关于/纠错入口、可选站点统计。
 * SPA 版：next/link → react-router-dom Link；去掉 NEXT_PUBLIC_* 环境变量，直接用常量。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { Link } from "react-router-dom";

const SITE_NAME = "诗词";
/** 纠错/反馈指向的仓库（桌面版无构建期环境变量，直接写死） */
const REPO = "https://github.com/daichangya/chinese-poetry-md";

/** 诗词原始数据来源（chinese-poetry） */
const DATA_SOURCE_URL = "https://github.com/daichangya/chinese-poetry";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-secondary/20 bg-background">
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-text/70">
          <span>
            © {year} {SITE_NAME}
          </span>
          <nav className="flex flex-wrap items-center gap-4">
            <a
              href={DATA_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer rounded transition-colors duration-200 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              数据来源
            </a>
            <Link
              to="/dynasties"
              className="cursor-pointer rounded transition-colors duration-200 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              朝代
            </Link>
            <Link
              to="/authors"
              className="cursor-pointer rounded transition-colors duration-200 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              诗人
            </Link>
            {REPO && (
              <a
                href={REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer rounded transition-colors duration-200 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                纠错 / 反馈
              </a>
            )}
          </nav>
        </div>
      </div>
    </footer>
  );
}
