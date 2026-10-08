/// <reference types="vite/client" />

/**
 * Vite 环境变量类型（桌面版替代 Next.js 的 NEXT_PUBLIC_*）。
 * 未在 .env 中配置时，使用处已有常量兜底。
 */
interface ImportMetaEnv {
  /** 源码仓库地址（Markdown 内容仓库），用于纠错/贡献入口 */
  readonly VITE_SOURCE_REPO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
