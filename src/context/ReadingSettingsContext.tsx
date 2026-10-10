/**
 * 阅读设置全局状态，供详情页右侧栏与 PoemReader 共用。
 * 桌面版移植：原 Web 版 context/ReadingSettingsContext.tsx，去掉 "use client"，
 * 继续使用 localStorage 持久化用户偏好（简繁、字体、拼音、注解）。
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "poetry-reading-settings";

export type PoemFont = "song" | "kai" | "calligraphy" | "handwriting" | "artistic";

/** 正文字号（px）范围、步长与默认值 */
export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 36;
export const FONT_SIZE_STEP = 2;
export const FONT_SIZE_DEFAULT = 20;

/** 把任意输入夹到合法字号区间 */
export function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return FONT_SIZE_DEFAULT;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(px)));
}

export interface ReadingSettings {
  variant: "s" | "t";
  font: PoemFont;
  /** 正文字号（px） */
  fontSize: number;
  showPinyin: boolean;
  showAnnotation: boolean;
}

const defaultSettings: ReadingSettings = {
  variant: "s",
  font: "song",
  fontSize: FONT_SIZE_DEFAULT,
  showPinyin: true,
  showAnnotation: true,
};

function loadSettings(): ReadingSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<ReadingSettings>;
    const fontKeys: PoemFont[] = ["song", "kai", "calligraphy", "handwriting", "artistic"];
    const font = parsed.font && fontKeys.includes(parsed.font as PoemFont)
      ? (parsed.font as PoemFont)
      : "song";
    return {
      variant: parsed.variant === "t" ? "t" : "s",
      font,
      fontSize: typeof parsed.fontSize === "number" ? clampFontSize(parsed.fontSize) : FONT_SIZE_DEFAULT,
      showPinyin: parsed.showPinyin !== false,
      showAnnotation: parsed.showAnnotation !== false,
    };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(s: ReadingSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

type SetReadingSettings = <K extends keyof ReadingSettings>(
  key: K,
  value: ReadingSettings[K]
) => void;

const ReadingSettingsContext = createContext<{
  settings: ReadingSettings;
  set: SetReadingSettings;
} | null>(null);

export function ReadingSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ReadingSettings>(defaultSettings);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const set = useCallback(<K extends keyof ReadingSettings>(
    key: K,
    value: ReadingSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <ReadingSettingsContext.Provider value={{ settings, set }}>
      {children}
    </ReadingSettingsContext.Provider>
  );
}

export function useReadingSettings() {
  const ctx = useContext(ReadingSettingsContext);
  if (!ctx) {
    return {
      settings: defaultSettings,
      set: (() => {}) as SetReadingSettings,
    };
  }
  return ctx;
}
