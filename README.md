# chinese-poetry-tauri

把 [https://github.com/daichangya/chinese-poetry-site)（Next.js + better-sqlite3）改写成的**桌面应用**，技术栈为 **Tauri v2 + Vite + React 18 + TypeScript**，数据仍然是那一个 SQLite 文件。

- 原项目：`https://github.com/daichangya/chinese-poetry-site`（Web 版，含 216 MB 数据库，不便于推送 Git）
- 本项目：只放源码，数据库按需获取；**编译全部交给 GitHub Actions**（本机无需 Rust / Node 环境）

---

## 1. 数据：`poetry_index.db`

诗词数据全部来自单个 SQLite 文件 `poetry_index.db`（约 216 MB）。它**不进 Git**（超过 GitHub 单文件 100 MB 限制）。

仓库里保留了 `src-tauri/resources/poetry_index.db` 作为**0 字节占位文件**：Tauri 打包时要求 `bundle.resources` 里声明的路径存在，缺了会直接报错，所以用一个空文件占位（`build.rs` 的 `tauri_build::build()` 有 `rerun-if-changed`，换成真实文件后会被重新打进包）。

获取数据库的四种方式（优先级从高到低）：

| 方式 | 具体做法 |
| --- | --- |
| ① 本机已有 | 设 `POETRY_DB_SRC=D:\path\poetry_index.db`，然后 `npm run fetch:db` |
| ② 直接给地址 | `npm run fetch:db -- --url https://…/poetry_index.db`（支持 http(s) / file://，支持 `--sha256 <值>` 校验） |
| ③ 仓库 Release | 把 `poetry_index.db` 作为附件放进本仓库的**最新正式 Release**（正式版构建会自动做这件事），CI 即可自动拉取
| ④ 手动下载 | 手动拷到 `src-tauri/resources/poetry_index.db` |

> 数据库由原项目的 `scripts/seed_db.ts` 从 `chinese-poetry-md` 目录构建；也可以直接从原项目 `public/data/poetry_index.db` 复制一份。

如果最终安装包里带的是 0 字节占位文件，应用启动时会显示**导入引导页**，让用户自己选择本机的 `poetry_index.db`（`src/components/DbGate.tsx`），不会白屏。

---

## 2. 用 GitHub Actions 编译（推荐，本机零依赖）

```bash
# 在项目目录里初始化并推送
git init
git add .
git commit -m "chore: init chinese-poetry-tauri"
git branch -M main
git remote add origin https://github.com/<你的账号>/chinese-poetry-tauri.git
git push -u origin main
```

（本机需要走代理时：`git config --global http.proxy http://127.0.0.1:99`、`git config --global https.proxy http://127.0.0.1:499`。）

推送后到仓库页面 **Actions → Build → Run workflow** 手动触发一次，即可拿到三平台安装包：

| 平台 | 产物 |
| --- | --- |
| Windows x64 | `…_x64-setup.exe`（NSIS 安装器）+ `…_windows-x64-portable.zip`（便携版，见下） |
| Linux x64 | `.deb` + `.AppImage` |
| macOS（Apple Silicon） | `.dmg`（Intel 版矩阵已移除，以省构建时间） |

### 发布：构建成功即自动发正式版 Release

构建成功后，由工作流最后的 `release` job 统一创建 Release（整条流水线里只有它创建 Release，否则三个平台并发创建同名 Release 会互相覆盖），产物直接挂在附件里，`draft: false` + `prerelease: false`，不需要再手动点发布：

| 触发方式 | 版本标签 |
| --- | --- |
| `git push origin main` | `v0.1.<构建号>` |
| Actions → Run workflow（可填 `version`，如 `0.2.0`） | `v0.2.0`（留空则 `v0.1.<构建号>`） |
| `git tag v0.2.0 && git push origin v0.2.0` | `v0.2.0` |

```bash
git tag v0.2.0 && git push origin v0.2.0
# → 构建完成后自动创建正式 Release，安装包作为附件
```

想要带数据库的安装包，先给构建一个可直链下载的 `poetry_index.db` 地址（Run workflow 的 `db_url`，或存成仓库 Secret `POETRY_DB_URL`），见下面一节。

### Windows 便携版（免安装）

Windows 那一组除了 NSIS 安装器，还会额外打出 `chinese-poetry_<版本>_windows-x64-portable.zip`，解压后双击 `chinese-poetry.exe` 就能用：免安装、不需要管理员权限，整个文件夹可以丢进 U 盘随身带。

```
chinese-poetry_0.1.0_windows-x64-portable/
├── chinese-poetry.exe        # 主程序
├── resources/poetry_index.db # 数据库（该次构建拿到真库就是真库，否则是 0 字节占位）
└── 使用说明.txt
```

两点说明：程序仍依赖系统的 WebView2 运行时（Windows 10/11 一般自带；缺了就装一次 Evergreen Standalone Installer，包内的使用说明里写了链接地址）；数据库走应用目录下的 `resources/`（`src-tauri/src/db.rs` 路径候选的第 3 项），因此便携版和安装版共用同一套查找逻辑，把 `poetry_index.db` 手工放进去也一样会被认。

工作流文件：`.github/workflows/build.yml`（类型检查 → 三组打包矩阵：Windows / Linux / macOS Apple Silicon → 统一发布）。

### 数据库与 Release

**为什么 CI 里经常拿不到数据库**：仓库不含 216 MB 的 `poetry_index.db`（原项目用 Git LFS 保存它），CI 每次都是全新克隆，本地候选路径全都不存在；不给下载地址时构建出来的是 0 字节占位文件（安装包仍可正常安装，只是启动后显示导入引导页）。

给它一个地址（只需做一次，之后可以自循环）：

1. **填一次下载地址**：Actions → Run workflow，在 `db_url` 里填可直链下载的地址，例如原项目 Git LFS 的直链
   `https://media.githubusercontent.com/media/daichangya/chinese-poetry-site/main/public/data/poetry_index.db`
   （实测匿名可下载，216,215,552 字节；注意 `raw.githubusercontent.com` 只会返回 LFS 指针文件，必须用 `media.githubusercontent.com`）。也可以把它存成仓库 Secret `POETRY_DB_URL`，以后每次构建都自动使用。
2. **发一次带库的正式版**：按上面办法成功构建一次后，Linux 那一组会把 `poetry_index.db` 也作为 Release 附件上传（仅当仓库里还没有这份资产时上传一次，避免每次发版都重复塞 216MB）。此后 `scripts/fetch-db.mjs` 会遍历本仓库最近的 Release 找这份库并自动复用——既不占 Git 体积，也不用每次手填地址。

---

## 3. 本地开发（可选，需要 Node 20 + Rust 1.77+）

```bash
npm install          # 前端依赖
npm run fetch:db     # 准备数据库（见上）
npm run tauri:dev    # 开发模式
npm run tauri:build  # 本地打包
```

macOS 需要 Xcode Command Line Tools；Linux 需要 `libwebkit2gtk-4.1-dev` 等（工作流里已列全）。

---

## 4. 目录结构

```
chinese-poetry-tauri/
├── .github/workflows/build.yml   # 三平台打包 + Release
├── scripts/
│   ├── fetch-db.mjs              # 数据库获取（本地/URL/Release/占位）
│   └── verify-db.mjs             # 数据库完整性校验（表、行数、抽样）
├── src/                          # 前端（React + Vite）
│   ├── lib/
│   │   ├── ipc.ts                # 与 Rust 的桥：dbStatus/dbOpen/query…
│   │   ├── db.ts                 # 由原项目 lib/queries.ts 移植的数据访问层
│   │   ├── types.ts              # 与 SQLite 表对应的类型
│   │   └── …                     # sidebar-data / pinyin_display / dynasties
│   ├── components/               # 由 app/components/* 移植
│   ├── pages/                    # 由 app/**/page.tsx 移植
│   └── components/DbGate.tsx     # 数据库缺失时的导入引导页
└── src-tauri/                    # Rust 侧
    ├── src/main.rs               # Tauri 应用入口
    ├── src/db.rs                 # rusqlite 只读连接、查询白名单、状态探测
    ├── Cargo.toml                # rusqlite(bundled) + base64 + dialog/opener 插件
    ├── capabilities/default.json # 窗口权限（core/dialog/opener）
    ├── app-icon.svg              # 图标源文件（矢量）
    ├── icons/                    # 构建时由 app-icon.svg 生成
    └── resources/poetry_index.db # 数据库（占位 / 真实文件二选一）
```

---

## 5. 从 Next.js 到桌面版的对应关系

| 原项目（Next.js，路由带 `trailingSlash`） | 本项目（Tauri + React Router） |
| --- | --- |
| `app/page.tsx` | `src/pages/HomePage.tsx`（`/`） |
| `app/poems/page.tsx` | `src/pages/PoemsPage.tsx`（`/poems`，列表 + 筛选 + 分页） |
| `app/poems/[slug]/page.tsx` | `src/pages/PoemDetailPage.tsx`（`/poems/:slug`） |
| `app/poems/random/page.tsx` | `src/pages/RandomPage.tsx`（`/poems/random`，声明须在 `:slug` 之前） |
| `app/authors/page.tsx` / `app/authors/[slug]/page.tsx` | `src/pages/AuthorsPage.tsx` / `src/pages/AuthorDetailPage.tsx` |
| `app/dynasties/page.tsx` / `app/tags/page.tsx` / `app/rhythmics/page.tsx` / `app/contribute/page.tsx` | `src/pages/DynastiesPage.tsx` / `TagsPage.tsx` / `RhythmicsPage.tsx` / `ContributePage.tsx` |
| `app/api/**`（poems、poems/random、authors、authors/by-name、dynasties、tags、rhythmics 共 7 个 route） | 不需要：`src/lib/db.ts` 直接查库 |
| `components/*`（Nav、Footer、LayoutWithSidebar、SidebarLeft(Server)、PoemsListClient、PoemReader、PoemDetailSidebar、Pagination、Toggle、FilterableList、HomeRecommendations） | `src/components/*` |
| `context/ReadingSettingsContext.tsx` | `src/context/ReadingSettingsContext.tsx` |
| `lib/db/queries.ts`（better-sqlite3 + gzip 解压） | `src/lib/db.ts` + `src/lib/ipc.ts`（走 Rust 的 rusqlite） |
| `lib/{{slug,dynasty,types,pinyin_display,sidebar-data}}.ts` | `src/lib/` 下同名文件 |
| `next/link`、`next/navigation` | `react-router-dom` 的 `Link` / `useParams` / `useSearchParams` |
| `next/dynamic`、`"use client"`、`generateStaticParams`、`sitemap.ts`、`robots.ts`、`AnalyticsOrHeadScripts` | 删除（无 SSR/CSR 之分，桌面端不需要站点地图与统计脚本） |

数据访问被收敛成一条路径：`src/lib/db.ts` → `invoke("db_query")` → `src-tauri/src/db.rs` → SQLite（只读，`SELECT`/`WITH` 白名单，BLOB 以 base64 传输后在 JS 侧 gunzip）。

---

## 6. 已知限制

- 数据库以只读方式打开（Rust 侧只放行 `SELECT`/`WITH` 开头的语句），应用不会修改原始数据文件。
- 数据库缺失或仍是 0 字节占位文件时，启动后会显示导入引导页，不会崩溃或白屏。
- 安装包**未做代码签名与公证**：Windows 可能出现 SmartScreen 提示，macOS 首次需右键 →「打开」。
- 安装包体积约 15–25 MB（不含数据库）；把数据库打进包会让安装包达到 200 MB+，这是有意的取舍项 —— 当前默认走"外部数据库 + 首次导入引导"。
- 未包含原项目的 SSG 预渲染、图片优化等 Web 专属能力。

## 7. 当前状态

- 前端：`tsc --noEmit` 无报错，`npm run build` 可产出 `dist/`（约 0.9 MB，含 opencc-js 简繁词库）。
- GitHub Actions 已在云端跑通一次全平台构建（[run 37754749318](https://github.com/baipinaaa/chinese-poetry-tauri/actions/runs/37754749318)：类型检查、Windows NSIS、Linux deb+AppImage、macOS dmg 全部成功）。那次没有产出 Release，因为发布逻辑当时只在 `v*` 标签下触发；现已改为三种触发统一发布（见上文）。
- 那次构建没有提供数据库地址，所以安装包里带的是 0 字节占位文件，应用启动后走导入引导页。
- 仓库不含数据库与 `dist/`、`node_modules/`、`src-tauri/target/`，仓库体积约 2 MB。

## 许可

MIT。诗词数据来自 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)。
