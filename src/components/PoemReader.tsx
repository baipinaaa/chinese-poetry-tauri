/**
 * 诗词正文：标题、作者、正文（字级拼音）、译文/注释/赏析。
 * 阅读设置由右侧栏 ReadingSettingsCard 控制，状态来自 ReadingSettingsContext。
 * 桌面版移植：next/link → react-router-dom Link，阅读设置改用 src/context/ReadingSettingsContext。
 * 正文字号由 settings.fontSize 控制（标题、作者行、译文按比例缩放；拼音 rt 用 em 随正文缩放）。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { pinyinNumLineToSymbol, alignLineWithPinyin } from "../lib/pinyin_display";
import {
  useReadingSettings,
  clampFontSize,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_STEP,
} from "../context/ReadingSettingsContext";

export interface PoemReaderProps {
  title: string;
  author: string;
  authorSlug?: string;
  dynasty: string;
  titlePinyin?: string;
  authorPinyin?: string;
  /** 词牌名（宋词等），有则展示 */
  rhythmic?: string;
  /** 标签名列表，有则展示为可点击链接（跳转到按标签筛选的诗文列表） */
  tags?: string[];
  paragraphs: string[];
  paragraphsPinyin?: string[];
  translation?: string;
  annotation?: string;
  appreciation?: string;
}

function convertToTraditional(text: string, converter: ((s: string) => string) | null): string {
  if (!converter || !text) return text;
  try {
    return converter(text);
  } catch {
    return text;
  }
}

export default function PoemReader({
  title,
  author,
  authorSlug,
  dynasty,
  titlePinyin,
  authorPinyin,
  rhythmic,
  tags,
  paragraphs,
  paragraphsPinyin,
  translation,
  annotation,
  appreciation,
}: PoemReaderProps) {
  const { settings, set } = useReadingSettings();
  const [converter, setConverter] = useState<((s: string) => string) | null>(null);

  /** 正文字号快捷调节（右侧栏的阅读设置在窄窗口下会排到正文下方，这里提供常驻入口） */
  const setSize = (px: number) => set("fontSize", clampFontSize(px));

  useEffect(() => {
    if (settings.variant !== "t") {
      setConverter(null);
      return;
    }
    let cancelled = false;
    import("opencc-js/cn2t").then((mod) => {
      if (cancelled) return;
      const c = mod.Converter({ from: "cn", to: "t" });
      setConverter(() => (s: string) => c(s));
    }).catch(() => setConverter(null));
    return () => { cancelled = true; };
  }, [settings.variant]);

  /* 字体族保留系统中文字体回退，桌面端离线时也能正常显示 */
  const fontFamilyMap: Record<string, string> = {
    song: '"Songti SC", "SimSun", "宋体", "Noto Serif SC", "Noto Serif JP", serif',
    kai: '"Kaiti SC", "KaiTi", "楷体", "Noto Serif SC", "Noto Serif JP", serif',
    calligraphy: '"Ma Shan Zheng", "STXingkai", "华文行楷", cursive',
    handwriting: '"Zhi Mang Xing", "STXingkai", "华文行楷", cursive',
    artistic: '"Long Cang", "STKaiti", "楷体", cursive',
  };
  const fontFamily = fontFamilyMap[settings.font] ?? fontFamilyMap.song;

  /* 字号缩放：正文用 settings.fontSize（px），其余元素按比例，拼音用 em 跟随正文 */
  const size = settings.fontSize;
  const rtStyle = { fontSize: "0.55em" } as const;

  /* 装饰字体按需加载：仅当用户选择 calligraphy/handwriting/artistic 时动态插入 Google Fonts <link>（离线时静默失败，回退系统字体） */
  const decorativeFontUrlMap: Record<string, string> = {
    calligraphy: "https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap",
    handwriting: "https://fonts.googleapis.com/css2?family=Zhi+Mang+Xing&display=swap",
    artistic: "https://fonts.googleapis.com/css2?family=Long+Cang&display=swap",
  };
  useEffect(() => {
    const url = decorativeFontUrlMap[settings.font];
    if (!url) return;
    const id = `font-${settings.font}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = url;
    document.head.appendChild(link);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.font]);

  const displayTitle = useMemo(
    () => convertToTraditional(title, converter),
    [title, converter]
  );
  const displayAuthor = useMemo(
    () => convertToTraditional(author, converter),
    [author, converter]
  );
  const displayParagraphs = useMemo(
    () => paragraphs.map((p) => convertToTraditional(p, converter)),
    [paragraphs, converter]
  );
  const displayTranslation = useMemo(
    () => translation ? convertToTraditional(translation, converter) : "",
    [translation, converter]
  );
  const displayAnnotation = useMemo(
    () => annotation ? convertToTraditional(annotation, converter) : "",
    [annotation, converter]
  );
  const displayAppreciation = useMemo(
    () => appreciation ? convertToTraditional(appreciation, converter) : "",
    [appreciation, converter]
  );
  const displayDynasty = useMemo(
    () => dynasty ? convertToTraditional(dynasty, converter) : "",
    [dynasty, converter]
  );
  const displayRhythmic = useMemo(
    () => rhythmic ? convertToTraditional(rhythmic, converter) : "",
    [rhythmic, converter]
  );
  const displayTags = useMemo(
    () => (tags ?? []).map((t) => convertToTraditional(t, converter)),
    [tags, converter]
  );

  const hasAnnotation = !!(translation || annotation || appreciation);

  const titleSymbolLine = titlePinyin ? pinyinNumLineToSymbol(titlePinyin) : "";
  const titlePairs = titlePinyin && settings.showPinyin
    ? alignLineWithPinyin(displayTitle, titleSymbolLine)
    : null;
  const authorSymbolLine = authorPinyin ? pinyinNumLineToSymbol(authorPinyin) : "";
  const authorPairs = authorPinyin && settings.showPinyin
    ? alignLineWithPinyin(displayAuthor, authorSymbolLine)
    : null;

  const renderAuthorContent = () => {
    if (authorPairs) {
      return (
        <span className="inline-flex flex-wrap justify-center gap-x-0.5">
          {authorPairs.map(({ char, pinyin }, k) =>
            pinyin ? (
              <ruby key={k} className="ruby">
                {char}
                <rt className="font-sans text-text/60" style={rtStyle}>{pinyin}</rt>
              </ruby>
            ) : (
              <span key={k}>{char}</span>
            )
          )}
        </span>
      );
    }
    return <>{displayAuthor}</>;
  };

  const linkClass =
    "cursor-pointer text-primary transition-colors duration-200 hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2";

  return (
    <div className="space-y-8">
      {/* 字号快捷条：不依赖右侧栏，任何窗口宽度下都能看到 */}
      <div className="flex items-center justify-end gap-1.5 text-text/60">
        <span className="mr-1 text-xs">正文字号</span>
        <button
          type="button"
          aria-label="减小字号"
          onClick={() => setSize(size - FONT_SIZE_STEP)}
          disabled={size <= FONT_SIZE_MIN}
          className="flex h-7 w-7 items-center justify-center rounded border border-black/15 text-xs transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20"
        >
          A−
        </button>
        <span className="w-9 text-center text-xs tabular-nums" aria-live="polite">
          {size}px
        </span>
        <button
          type="button"
          aria-label="增大字号"
          onClick={() => setSize(size + FONT_SIZE_STEP)}
          disabled={size >= FONT_SIZE_MAX}
          className="flex h-7 w-7 items-center justify-center rounded border border-black/15 text-sm transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20"
        >
          A+
        </button>
      </div>

      <header className="text-center">
        <h1
          className="font-bold text-primary"
          style={{ fontFamily, fontSize: `${Math.round(size * 1.6)}px` }}
        >
          {titlePairs ? (
            <span className="inline-flex flex-wrap justify-center gap-x-0.5">
              {titlePairs.map(({ char, pinyin }, k) =>
                pinyin ? (
                  <ruby key={k} className="ruby">
                    {char}
                    <rt className="font-sans text-text/60" style={rtStyle}>{pinyin}</rt>
                  </ruby>
                ) : (
                  <span key={k}>{char}</span>
                )
              )}
            </span>
          ) : (
            displayTitle
          )}
        </h1>
        <p
          className="mt-2 flex flex-wrap items-center justify-center gap-x-1 text-text/80"
          style={{ fontSize: `${Math.round(size * 0.9)}px` }}
        >
          {authorSlug ? (
            <Link to={`/authors/${authorSlug}`} className={linkClass}>
              {renderAuthorContent()}
            </Link>
          ) : (
            renderAuthorContent()
          )}
          {dynasty ? (
            <>
              <span className="text-text/60"> · </span>
              <Link
                to={`/poems?dynasty=${encodeURIComponent(dynasty)}`}
                className={linkClass}
              >
                {displayDynasty}
              </Link>
            </>
          ) : null}
          {rhythmic ? (
            <>
              <span className="text-text/60"> · </span>
              <span className="text-text/70">词牌：</span>
              <Link
                to={`/poems?rhythmic=${encodeURIComponent(rhythmic)}`}
                className={linkClass}
              >
                {displayRhythmic}
              </Link>
            </>
          ) : null}
        </p>
        {displayTags.length > 0 && tags ? (
          <p
            className="mt-2 flex flex-wrap items-center justify-center gap-2 text-text/80"
            style={{ fontSize: `${Math.round(size * 0.75)}px` }}
          >
            <span className="shrink-0 text-text/60">标签：</span>
            {displayTags.map((displayName, i) => (
              <Link
                key={i}
                to={`/poems?tag=${encodeURIComponent(tags[i])}`}
                className="cursor-pointer rounded px-2 py-0.5 text-primary transition-colors duration-200 hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              >
                {displayName}
              </Link>
            ))}
          </p>
        ) : null}
      </header>

      <section
        className="mb-8 space-y-3 leading-loose"
        style={{ fontFamily, fontSize: `${size}px` }}
      >
        {(paragraphsPinyin && paragraphsPinyin.length > 0 && settings.showPinyin
          ? displayParagraphs.map((line, i) => ({
              line,
              pinyinLine: paragraphsPinyin[i] ?? "",
            }))
          : displayParagraphs.map((line) => ({ line, pinyinLine: "" }))
        ).map(({ line, pinyinLine }, i) => {
          const symbolLine = pinyinLine ? pinyinNumLineToSymbol(pinyinLine) : "";
          const pairs = alignLineWithPinyin(line, symbolLine);
          return (
            <p key={i} className="flex flex-wrap justify-center gap-x-0.5">
              {pairs.map(({ char, pinyin }, k) =>
                pinyin ? (
                  <ruby key={k} className="ruby">
                    {char}
                    <rt className="font-sans text-text/60" style={rtStyle}>{pinyin}</rt>
                  </ruby>
                ) : (
                  <span key={k}>{char}</span>
                )
              )}
            </p>
          );
        })}
      </section>

      {settings.showAnnotation && hasAnnotation && (
        <section className="space-y-6 border-t border-secondary/20 pt-8">
          {displayTranslation && (
            <div className="rounded-lg border border-secondary/20 p-4">
              <h2
                className="font-semibold text-primary"
                style={{ fontSize: `${Math.round(size * 0.95)}px` }}
              >
                译文
              </h2>
              <p
                className="mt-1 whitespace-pre-wrap text-text/90"
                style={{ fontSize: `${Math.round(size * 0.95)}px` }}
              >
                {displayTranslation}
              </p>
            </div>
          )}
          {displayAnnotation && (
            <div className="rounded-lg border border-secondary/20 p-4">
              <h2
                className="font-semibold text-primary"
                style={{ fontSize: `${Math.round(size * 0.95)}px` }}
              >
                注释
              </h2>
              <p
                className="mt-1 whitespace-pre-wrap text-text/90"
                style={{ fontSize: `${Math.round(size * 0.95)}px` }}
              >
                {displayAnnotation}
              </p>
            </div>
          )}
          {displayAppreciation && (
            <div className="rounded-lg border border-secondary/20 p-4">
              <h2
                className="font-semibold text-primary"
                style={{ fontSize: `${Math.round(size * 0.95)}px` }}
              >
                赏析
              </h2>
              <p
                className="mt-1 whitespace-pre-wrap text-text/90"
                style={{ fontSize: `${Math.round(size * 0.95)}px` }}
              >
                {displayAppreciation}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
