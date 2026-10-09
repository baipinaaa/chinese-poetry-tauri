# 桌面版数据源重构：用 gushiwen 补齐译文 / 注释 / 赏析

## Context

桌面版 `chinese-poetry-tauri`（Tauri v2 + React + rusqlite）目前加载的 `poetry_index.db`（216MB）由 chinese-poetry 原始 JSON 生成，**只有正文/标题/作者/朝代，译文、注释、赏析三列全空**，所以界面上「译文」标签是空的（用户 m00585 报的第一个问题）。

上一阶段曾打算从 `daichangya/chinese-poetry-md` 仓库取译文，但实测：译文是 AI 生成且质量差（"城南倒社下湖忙" → "城南倒是下湖忙"），「赏析」与「译文」内容一字不差，且 codeload 代理下载仅 ≈32KB/s、不支持续传（已放弃）。

用户随后提供了三个本地数据源（`G:/AIWORK/gushi/gushi-data/`，用户消息 m00720），要求改用它们。经过实测比对（见下表），确定以 **gushiwen-main** 作为唯一内容源重建数据库。

### ⚠️ 重大更正（2026-xx-xx，全量实测后）

**此前「gushiwen 有 375,847 首、译文覆盖率 100%」是错的**（那是早期只看 README 与 55 首样本得出的误判）。全量实测：

- `gushiwen-main/gushiwen.json.gz` = **108,196 条**（文件内 `"title"` 出现 108,196 次）；
- 其中带 `sons["译文及注释"]` 的仅 **10,176 条（9.4%）**，`赏析` 6,874、`鉴赏` 1,813、`创作背景` 6,368；
- `gushiwen-main/gushiwen.sql.gz` 是**同一份数据的 MySQL dump**（单表 `shiwen(id,href,title,author,dynasty,content,sons,links)`，`AUTO_INCREMENT=108327`），没有更多内容；
- 「37.6 万」这个数字实际是 **chinese-poetry 侧诗词总量**，与译文无关。

### 三源全量实测（阶段一 `_build/sources.db` 建库后统计）

| 源 | 去重后行数 | 译文 | 注释 | 赏析 | 创作背景 |
|---|---|---|---|---|---|
| `gushiwen-main/gushiwen.json.gz` (49.8MB) | 103,988 | 10,106 | 9,992 | 8,296 | 6,143 |
| `poems-db-master/poems[1-4].json` (159MB) | 192,511 | 645 | 397 | 263 | 0 |
| `chinese-gushiwen-master/guwen/` (10 文件) | 9,880 | 1,793 | 1,629 | 1,301 | 0 |
| **合计** | **306,379** | **12,544** | **12,018** | **9,860** | **6,143** |

→ **三源能提供的译文上限约 1.25 万首**（相对 37.6 万首全库约 3.3%），不存在「37.6 万首译文全非空」。

源文件事实：
- `chinese-gushiwen-master/guwen/` 只有 `guwen0-1000.json … guwen9001-10000.json` 共 10 个文件（2018 年数据，合计恰 1 万条）；`writer/writer0-1000.json … writer3001-4000.json` 共 3,983 人。
- `poems-db-master/` 另有 `poems-authors.json`(22.6MB)、`poems-dynasty.json`、`poems-category.json`、`poems-cipai.json`、`poems-single.json` 及 `史部/`、`子部/`、`ancient-api/` 目录。
- gushiwen 标题尾部有 AI 标注残留如「（写翻译）」「（做赏析）」，需清洗（已实现 `clean_title()`）。
- gushiwen 的「译文及注释」把译文与注释放在**同一段**里，用「注释」小标题分隔（已实现 `split_translation_annotation()`）。
- 文本自带 `<p>`/`<br>`/`&nbsp;` 需转纯文本分行（已实现 `strip_html()` / `paragraphs()`）。

---

## Approach

**新建一条可复现的数据管线**：`scripts/build-db.mjs` —— 把三个数据源合并成一个 `poetry_index.db`，与现有页面代码的 schema 保持字段兼容（只加列，不改列名），这样前端查询逻辑基本不动。

### 数据管线（按序执行，可单独重跑）

1. **导入 gushiwen（主库，内容三件套）**
   - 流式解析 `gushiwen.sql.gz`（`zlib.createGunzip()` + 按 `INSERT INTO` 行切分，避免 259MB 全量进内存）。
   - 清洗：去掉标题尾部「（写翻译）」「（做赏析）」「（找注释）」等；HTML 标签转 `\n`；繁体字段优先取繁体列（若有），否则保留简体。
2. **按 (作者, 标题) 与 chinese-poetry 精选数据集合并**
   - 保留 chinese-poetry 侧的诗集归类（唐诗三百首/宋词三百首…）、标签、拼音、朝代层级（首页「295 诗集」等功能依赖）。
   - 匹配键优先级：`(author, title)` → `(author, 去标点 title)` → 插入拼音 slug。
   - 冲突时**以 gushiwen 的正文为准**，书名/集名/标签保留 chinese-poetry 侧。
3. **拼音 slug 生成**（不引入 npm 依赖，保证 CI 无网可跑）
   - 内置 `scripts/data/pinyin.dict.json`：约 2 万常用字「汉字 → 无调拼音」表，来源为 gushiwen 现有列 + chinese-poetry 侧已有拼音字段中反推补齐，脚本自动校验覆盖率，缺字则回退 `han-<hex>`。
   - slug 规则沿用现有 `src/lib/slug.ts`：`<拼音>-<拼音>`、去重加 `-2/-3`。
4. **入库表结构（在现有 DB 上新增/调整）**
   - `poems`：新增 `content_plain`、`translation`、`annotation`、`appreciation`、`author_intro`、`has_content INTEGER`、`meta TEXT`（JSON：出处/体裁/AI 标注残留等）。
   - 新增 `poems_fts`（FTS5，`tokenize='trigram'`，列 `title, content, author`）用于繁简/子串搜索。
   - 新增视图 `poem_rich`（只含三件套非空的诗），供「热门诗词」和搜索过滤使用。
   - 保留旧列名 `poem_content.paragraphs / translation / appreciation / annotation`（BLOB+gunzip）不变，`src/lib/use-poem-detail.ts` 无需改解析方式。
5. **作者简介**：`authors.description` 用 gushiwen 的 `author_intro`（2.6 万条）填充；顺带补「生卒年」（解析简介首部的 `(1125—1210)` → `authors.birth_year/death_year`，界面直接展示，不必等外部 API）。

### 前端配合改动

- `src/components/PoemDetailSidebar.tsx`（新组件）：把详情页右侧改成「注释 / 译文 / 赏析」三个可折叠标签，默认展开译文；空内容时显示「暂无译文（数据源未收录）」而不是空白。
- `src/lib/use-poem-detail.ts`：查询补上 `annotation / appreciation`；新库 slug 变了，查询加**回退链**：`slug → title+author → poem_id`。
- `src/pages/CategoryTagPage.tsx`、`src/pages/PoemDetailPage.tsx`：搜索改走 `poems_fts`（trigram）以支持**繁体输入命中简体库**。

> 另外三项用户已提出的独立需求（m00568/m00635/m00637）一并纳入本管线：
> ① 详情页作者卡片补生卒年 + 简介（数据来自管线第 5 步）；
> ② 文言文/赋等非诗文体（老子/庄子/楚辞）在旧库只有标题无正文 → 新管线从 gushiwen + `poems-db-master/集部` 补正文；
> ③ 朝代页去掉 `src/pages/DynastyPage.tsx` 里硬编码的朝代名与年份，改为从 `dynasties` 表读（年份两两相减生成「前221–前206」，并去掉「公元前」前缀的重复）。

### CI 二阶段

`.github/workflows/build.yml` 改为两个 job：
1. `data`：Linux runner 上跑 `scripts/build-db.mjs` 生成 `poetry_index.db`，`actions/upload-artifact` 传产物（**不提交进 git**，DB 目标体积预计 300–400MB）。
2. `release`：`needs: data`，下载 artifact → 交给 `tauri-apps/tauri-action` 打包三平台，并把 DB 一并上传到 Release（桌面端 `scripts/fetch-db.mjs` 已能从 Release 自动拉取）。

数据源进 CI 的方式待定（见下方问题）。

---

## Files to modify

| 路径 | 改动 |
|---|---|
| `scripts/build_db.py` | **新增** 主数据管线（合并三源 → 建库 → FTS）。**用 Python 而非 Node**：CI 的 ubuntu runner 自带 python3 + sqlite3/gzip 标准库，无需 npm 依赖，流式解析超大 JSON 更省内存；本机 Python 3.14.4 / sqlite 3.50.4 实测通过 |
| `scripts/lib/jsonstream.py` | **新增** 流式 JSON 读取（覆盖「单行大数组 / 每行带尾逗号数组 / JSONL」三种格式 + gz） |
| `scripts/data/pinyin.dict.json`、`scripts/data/poem-meta.json` | **新增** 拼音字典与元数据（随仓库提交，体积小） |
| `scripts/enrich-from-shici.mjs` | **新增（可选，独立于建库）** 仅补「注释」：对本地库中缺注释的诗按 slug 或标题查 `https://shi-ci.cn/api/poems/<slug>`，命中则解析正文中的「注释」段写入 |
| `src-tauri/` | 无改动（rusqlite 只读，表结构兼容） |
| `src/lib/use-poem-detail.ts` | 补注释/赏析查询 + slug 回退链 |
| `src/components/PoemDetailSidebar.tsx` | **新增** 三标签侧栏 |
| `src/pages/PoemDetailPage.tsx` | 接入侧栏 |
| `src/pages/AuthorDetailPage.tsx` | 生卒年 + 简介展示 |
| `src/pages/DynastyPage.tsx` | 去掉硬编码朝代/年份 |
| `src/pages/CategoryTagPage.tsx` | 搜索走 FTS（繁简通搜） |
| `src/lib/db.ts` | 更新 schema 注释与列说明 |
| `.github/workflows/build.yml` | 拆成 data / release 两 job |
| `README.md` | 说明数据来源与建库流程 |

## Reuse（复用现有实现，不重造）

- `src/lib/slug.ts`：`normalizeSlug()` / slug 生成与去重规则。
- `src/lib/compress.ts`：gzip/gunzip BLOB（`paragraphs` 等列的读写方式不变）。
- `src/lib/metadata.ts`：年份格式化、朝代后缀剔除 —— 朝代页去硬编码时直接调它。
- `src/lib/use-poem-detail.ts`：既有「先查主表、未命中再查 `poem_content`」的取数结构，仅追加列与回退。
- `src-tauri/src/db.rs`：已支持动态 SQL 查询，无需新增 Rust 命令。
- `scripts/fetch-db.mjs`：桌面端从 Release 拉 DB 的逻辑已就绪，无需改动。

## Steps

- [x] 1. 摸清 `gushiwen.sql.gz` 的完整列名（简繁字段、`author_intro` 是逐首还是逐作者），确认繁体列可用性。
- [x] 2. **已完成**（实现语言由 Node 改为 Python，理由见下）：`python scripts/build_db.py --stage sources` → `_build/sources.db`（278.6MB，306,379 行，156.8s）。实测译文 12,544 / 注释 12,018 / 赏析 9,860 / 背景 6,143 行；作者表 2,605 人（有头像 938、解析出生卒年 906）；标题清洗与「译文/注释」拆分生效。**数量更正见上方「重大更正」**。
- [x] 3. **已完成**：`scripts/gen-pinyin-dict.mjs` 从两侧拼音数据反推字典 → `scripts/data/pinyin.dict.json`（252,170B），`scripts/verify-pinyin.mjs` 校验覆盖率 **99.77% / 99.98%**（≥99% 达标）。运行时用 `src/lib/pinyin_display.ts` 配 pinyin-pro。
- [x] 4. **已完成**：`python scripts/build_db.py --stage final` → `_build/poetry_index.db`（483.7MB；poems 474,270 / authors 22,649 / dynasties 21 / poem_tags 475,292），已建 `poems_fts`（474,270 行，unigram+bigram，建库 61.3s）与 `poem_rich` 视图（11,151 首有三件套）。详情页内容：paragraphs 474,270（100%）、translation 10,416、annotation 10,255、appreciation 8,547。
- [x] 5. **已完成**：已建 `idx_poems_title_author`、`idx_poems_has_content`、`idx_poems_author_slug`、`idx_poems_dynasty_slug`、`idx_poems_title`、`idx_authors_name`。slug 回退链落地为 `src/lib/db.ts` 的 `getPoemByTitleAuthor(title, authorName)`（命中 `idx_poems_title_author`）；详情页 URL 只携带 slug，slug 由管线统一生成，故页面级回退为兜底。
- [x] 6. **已完成**：`src/components/PoemDetailSidebar.tsx` 新增并接入 `src/pages/PoemDetailPage.tsx`（传 `poem.translation/annotation/appreciation`）；`src/lib/use-poem-detail.ts` 实际不存在（详情数据由 `src/lib/db.ts` 的 `getPoemBySlug` → `assemblePoem()` 提供，已含三件套）；搜索已切 `poems_fts`（`searchPoemsFts`/`countSearchPoemsFts`，ms 级，替代原 LIKE+JOIN 的 10.9s）。
- [x] 7. **已完成**：① `AuthorDetailPage.tsx` 显示生卒年（`formatLifespan`，authors 表 859/904 条有 birth/death_year）；② 朝代页本无硬编码，已补年份显示 —— `getDynasties()` 增读 `start_year/end_year` → `formatYearPeriod` 生成「618—907」，`FilterableList` 新增 `subtitle` 副标题；③ 文言文正文由数据层补齐（全库 **0 首缺正文**，老子/庄子/屈原均已入库）；④ 首页推荐改走 `poem_rich`（`fetchRandomPoems(n, richOnly)`，`HomeRecommendations` 传 true），「随机一首」仍走全量。
- [x] 8. 改造 `.github/workflows/build.yml`（data → release 两阶段）+ 更新 README。（已完成：新增 `data` job，仅 `build_db=true` 时运行——拉旧库 `fetch-db.mjs --out _build/old_poetry_index.db` → 校验旧库 >1MB → 下载解包数据源 → `build_db.py --stage all --fts` → 内联 Python 校验行数 → 上传 `db-poetry`；build job 先试 `download-artifact: db-poetry`，拿到真库（>1MB）就直接 cp 到 `src-tauri/resources/`，否则回退 `fetch-db.mjs`；build 里 Linux 那组上传 `db-poetry` 的条件加了 `&& inputs.build_db != 'true'` 规避同名 artifact 冲突；workflow_dispatch 新增 `build_db`/`sources_url` 两个输入；YAML 已用 Python yaml.safe_load 校验通过。README 新增「1.2 自己合成」与「云端重建数据库」两节，并把库体积/覆盖率数字更新到实测值。）
- [ ] 9. （可选）`scripts/enrich-from-shici.mjs` 注释补全，范围先限「诗集页 + 热门 1000 首」。
- [ ] 10. 本地产出 DB → 上传 Release → 三平台打包验证。

## Verification

1. **建库自检**（`node scripts/build-db.mjs --verify`，脚本内置）：
   - 总诗数 ≥ 37.6 万且 ≤ 40 万；`translation` 非空率 ≥99%；`appreciation` 非空率 ≥95%；`annotation` 非空率按源如实输出。
   - 抽样 50 首人工比对 gushiwen 原 SQL 文本，确认无 HTML 残留、无「（写翻译）」字样。
   - 抽查 slug 唯一性（无重复）、`dynasties.poem_count` 与 `poems` 实际计数一致。
2. **桌面端本地跑**（`npm run dev` + 现有 `poetry_index.db` 替换）：
   - 打开任意唐诗详情页 → 侧栏有译文/赏析；搜索「陸游」（繁体）能命中简体条目；朝代页年份显示为「1127–1279」且无重复后缀；作者页显示生卒年 + 简介。
3. **CI 验证**：手动触发 workflow → `data` job 成功产出 DB artifact → `release` job 三平台构建成功、Release 中同时存在安装包与 `poetry_index.db`。
4. **端到端**：安装 Windows 产物 → 首次启动自动 `fetch-db` 拉取新库 → 「译文」标签正常显示。

## 待用户确认

1. **数据源进 CI 的方式**：`gushiwen.sql.gz`(36MB) + `gushiwen.json.gz`(150MB) 不能提交 git；是把它们上传到 GitHub Release 作为数据资产供 CI 下载，还是提供原始下载链接，或者**改由你在本地建好 DB 后直接上传 Release、CI 只负责打包**？
2. **是否保留「重抓 shi-ci.cn」用于补注释**？覆盖率约 20%（唐诗）/5%（宋词），全量 33 万首不现实，建议只抓诗集页 + 热门。
3. **旧库的 33.6 万首里，gushiwen 未覆盖的部分**（预计 3~5 万首，多为冷门宋诗）如何处理：保留原文但标注「暂无译文」，还是从库中剔除？
4. **是否接受库体积从 216MB 增至 300~400MB**（译文+赏析文字量导致），以及是否需要把赏析默认折叠以减少首屏卡顿。
