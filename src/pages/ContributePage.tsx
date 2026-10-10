/**
 * 贡献指南：纠错与完善、内容贡献说明。
 * 移植自 Web 版 app/contribute/page.tsx：
 * 桌面版离线运行，无服务端与表单提交能力，故页面内容保留，
 * 仅补充「桌面版请在网页端提交」的说明，不伪造任何提交成功。
 * 外链统一走 ExternalLink（Tauri 下用系统浏览器打开）。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useEffect } from "react";
import BackLink from "../components/BackLink";
import ExternalLink from "../components/ExternalLink";

/** 未配置时使用 .md 仓库（纠错与完善、贡献入口） */
const REPO =
  import.meta.env.VITE_SOURCE_REPO ?? "https://github.com/daichangya/chinese-poetry-md";

/** 诗词原始数据来源仓库（chinese-poetry） */
const DATA_SOURCE_URL = "https://github.com/daichangya/chinese-poetry";

export default function ContributePage() {
  useEffect(() => {
    document.title = "贡献指南";
  }, []);

  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-bold text-primary md:text-3xl">贡献指南</h1>
        <p className="mt-2 text-text/80">欢迎参与诗词内容的纠错与完善。</p>
      </header>

      <section className="space-y-2 rounded-lg border border-secondary/20 bg-secondary/10 p-4">
        <h2 className="text-lg font-semibold text-primary">桌面版说明</h2>
        <p className="text-sm text-text/80">
          本页为桌面（离线）版，仅提供说明与仓库入口，<strong>不支持在此提交修改</strong>。
          桌面版请在网页端提交纠错与内容贡献，或直接在下方仓库中提交编辑。
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-primary">数据来源</h2>
        <p className="text-sm text-text/80">
          本站诗词原始数据来源于开源仓库
          <ExternalLink
            href={DATA_SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer text-primary hover:underline"
          >
            chinese-poetry
          </ExternalLink>
          ，最全中华古诗词数据库（唐诗、宋诗、宋词等）。
        </p>
      </section>

      <section className="space-y-3 text-text/90">
        <h2 className="text-lg font-semibold text-primary">如何贡献</h2>
        <ul className="list-inside list-disc space-y-2 text-sm">
          <li>
            在<strong>诗词详情页</strong>右侧栏点击「纠错与完善/内容贡献」按钮，可跳转到该首诗的源文件（Markdown）进行编辑。
          </li>
          <li>
            每首诗对应一个 <code className="rounded bg-secondary/20 px-1">poems/作者slug/诗题slug.md</code> 文件，可增补或修改正文、译文、注释、赏析、拼音等。
          </li>
          <li>
            修改后执行站点的构建流程（如 <code className="rounded bg-secondary/20 px-1">npm run build</code>）即可更新站点与搜索索引。
          </li>
        </ul>
      </section>

      {REPO && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-primary">仓库与文档</h2>
          <p className="text-sm text-text/80">
            本站网站与 Markdown 内容托管于以下仓库，可在仓库中参与编辑与讨论：
          </p>
          <ExternalLink
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-cta px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            前往仓库
          </ExternalLink>
        </section>
      )}

      <p className="pt-4">
        <BackLink fallbackTo="/" fallbackLabel="返回首页" />
      </p>
    </article>
  );
}
