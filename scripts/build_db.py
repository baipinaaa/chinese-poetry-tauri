#!/usr/bin/env python3
"""诗词数据管线。

阶段说明
--------
stage1 (sources)  : 三个带译文的源 → `_build/sources.db`（原样保留各源字段，不做合并）
stage2 (final)    : 阶段一产物 + chinese-poetry（诗集/标签/朝代/拼音）→ `poetry_index.db`

用法
----
    python scripts/build_db.py --stage sources [--limit N] [--data-dir DIR]
    python scripts/build_db.py --stage final   [--data-dir DIR] [--out FILE]

数据目录默认取环境变量 GUSHI_DATA_DIR，否则 <仓库>/../gushi-data。
"""
from __future__ import annotations

import argparse
import gzip
import html
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.jsonstream import iter_json_records  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
BUILD_DIR = REPO / "_build"

# ---------------------------------------------------------------- 文本清洗

_TAG_RE = re.compile(r"<[^>]+>")
_TAIL_HINT_RE = re.compile(r"[（(]\s*(?:写|做|找|给|加|补|译|译注|赏析|注释|翻译)[^）)]{0,12}[）)]\s*$")
_BLANK_RE = re.compile(r"[ \t\u3000\xa0]+")
_HAN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
# gushiwen 的正文里几乎没有 <br/>：段与段之间是用**连续 &nbsp;**（常见两个）分隔的，
# 而单个 &nbsp; 只是词牌与题名之间的排版空格。两者必须区分，
# 否则连续 nbsp 被解码成空格后整首诗的段落会连成一行（正文看起来「连在一起没分开」）。
_NBSP_RUN_RE = re.compile(
    r"(?i)(?:&nbsp;|&#160;|&#xa0;|\xa0)(?:[ \t\u3000]*(?:&nbsp;|&#160;|&#xa0;|\xa0))+"
)
# 句末标点后紧跟的单个 &nbsp; 也是结构分隔（如曲牌记录里「既乐而康。&nbsp;云中君&nbsp;&nbsp;望云中帝服…」
# 的曲名），否则曲名会粘到上一句末尾。
_AFTER_PUNCT_NBSP_RE = re.compile(r"(?i)(?<=[。！？!?；;])(?:&nbsp;|&#160;|&#xa0;|\xa0)+")


def strip_html(text: str) -> str:
    """把 gushiwen 的 HTML 片段压成纯文本，块级标签与连续 nbsp 转成换行。"""
    if not text:
        return ""
    s = text.replace("\r\n", "\n").replace("\r", "\n")
    s = _NBSP_RUN_RE.sub("\n", s)  # 连续 &nbsp; = 段落分隔，必须在实体解码之前
    s = _AFTER_PUNCT_NBSP_RE.sub("\n", s)  # 句末标点后的单个 &nbsp; 同样是分隔
    s = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", s)
    s = re.sub(r"(?i)</\s*(p|div|li|tr)\s*>", "\n", s)
    s = _TAG_RE.sub("", s)
    s = html.unescape(s)  # 覆盖 &nbsp; &amp; &#39; 等全部实体（比手工映射表全）
    s = s.replace("\u00a0", " ").replace("\u3000", " ")
    return s


_SENT_END_RE = re.compile(r"(?<=[。！？!?])")


def paragraphs(text: str) -> List[str]:
    """按行切段，去掉空白行与行内多余空格。"""
    if not text:
        return []
    out: List[str] = []
    for raw in strip_html(text).split("\n"):
        line = _BLANK_RE.sub(" ", raw).strip()
        if line:
            out.append(line)
    return out


def poem_lines(text: str) -> List[str]:
    """正文分行：结构分段优先，剩下的长段按句末标点断句、两句一行。

    gushiwen 的正文 HTML 里大多**没有任何内部分隔**：整首诗（上下阕、各联）被包在
    一对 <br/> 里，例如「晶帘一片伤心白，云鬟香雾成遥隔。无语问添衣，桐阴月已西。」，
    结构上拿不到换行信息，只能按句末标点断句；再按诗词排版惯例两句合成一行
    （一联/一拍一行），否则详情页正文会连成一大片。
    """
    out: List[str] = []
    for para in paragraphs(text):
        parts = [p.strip() for p in _SENT_END_RE.split(para) if p.strip()]
        if len(parts) <= 2:
            out.append(para)
            continue
        for i in range(0, len(parts), 2):
            pair = "".join(parts[i : i + 2]).strip()
            if pair:
                out.append(pair)
    return out


def join_paragraphs(lines: Optional[Iterable[str]]) -> Optional[str]:
    if not lines:
        return None
    text = "\n".join(x for x in lines if x)
    return text or None


def clean_text_value(value: Optional[str]) -> str:
    """解码 HTML 实体（&nbsp; &amp; &#39; …）并压缩空白，用于标题/作者/朝代等短字段。"""
    if not value:
        return ""
    return _BLANK_RE.sub(" ", html.unescape(str(value))).strip()


def clean_title(title: Optional[str]) -> str:
    """解码实体 + 去掉标题尾部的 AI 提示残留，例如「静夜思（写翻译）」。"""
    if not title:
        return ""
    t = _BLANK_RE.sub(" ", html.unescape(str(title))).strip()
    for _ in range(4):
        new = _TAIL_HINT_RE.sub("", t).strip()
        if new == t:
            break
        t = new
    return t


def body_key(text: str, n: int = 16) -> str:
    """正文前 n 个汉字，作为跨源匹配键。"""
    if not text:
        return ""
    han = "".join(ch for ch in text if _HAN_RE.match(ch))
    return han[:n]


# ---------------------------------------------------------------- 生卒年

_YEAR_RE = re.compile(r"(前)?\s*(\d{1,4})")


def _pick_year(seg: str) -> Optional[str]:
    m = _YEAR_RE.search(seg)
    if not m:
        return None
    num = m.group(2).lstrip("0") or "0"
    return ("-" + num) if m.group(1) else num


def parse_lifespan(intro: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """从简介里解析生卒年，返回 (birth, death)；缺失返回 (None, None)。"""
    if not intro:
        return (None, None)
    m = re.search(r"[（(]([^）)]{1,40})[）)]", intro[:80])
    if not m:
        return (None, None)
    parts = re.split(r"[－—\-~～至]", m.group(1))
    if len(parts) != 2:
        return (None, None)
    birth, death = _pick_year(parts[0]), _pick_year(parts[1])
    for v in (birth, death):
        if v is not None and not 1 <= len(v.lstrip("-")) <= 4:
            return (None, None)
    return (birth, death)


# ---------------------------------------------------------------- 源：gushiwen

def _sons_map(sons: Any) -> Dict[str, Any]:
    """sons 实测是 dict[str, dict]，但也兼容 list[dict] 的写法。"""
    if isinstance(sons, dict):
        return sons
    if isinstance(sons, list):
        out: Dict[str, Any] = {}
        for item in sons:
            if isinstance(item, dict):
                name = item.get("name") or item.get("title")
                if name:
                    out[str(name)] = item
        return out
    return {}


def _son_content(node: Any) -> List[str]:
    if isinstance(node, dict):
        return paragraphs(node.get("content") or "")
    if isinstance(node, list):
        out: List[str] = []
        for x in node:
            out.extend(paragraphs(x if isinstance(x, str) else (x or {}).get("content") or ""))
        return out
    if isinstance(node, str):
        return paragraphs(node)
    return []


def split_translation_annotation(lines: List[str]) -> Tuple[List[str], List[str]]:
    """gushiwen 的「译文及注释」把两块放在同一段里，用「注释」小标题分隔。"""
    for i, line in enumerate(lines):
        core = line.strip().strip("：: ").replace("\u00a0", "").strip()
        if core in ("注释", "注解", "词句注释", "注释词语", "注释及译文", "注"):
            return lines[:i], lines[i + 1 :]
    if lines and lines[0].strip().strip("：: ") in ("译文", "翻译", "白话译文", "译文："):
        return lines[1:], []
    return lines, []


def read_gushiwen(data_dir: Path, limit: Optional[int]) -> Iterator[Dict[str, Any]]:
    src = data_dir / "gushiwen-main" / "gushiwen.json.gz"
    if not src.exists():
        print(f"[warn] 缺文件，跳过 gushiwen 源: {src}")
        return
    n = 0
    for rec in iter_json_records(str(src), compressed=True):
        title = clean_title(rec.get("title"))
        content = poem_lines(rec.get("content") or "")
        if not title or not content:
            continue
        sons = _sons_map(rec.get("sons"))
        trans: List[str] = []
        anno: List[str] = []
        cankao: List[str] = []
        for key in ("译文及注释", "译文及注释二", "译文"):  # 二版只在没有一版时用
            node = sons.get(key)
            if node is None:
                continue
            lines = _son_content(node)
            t, a = split_translation_annotation(lines)
            if not trans:
                trans = t
            if not anno:
                anno = a
            if isinstance(node, dict) and node.get("cankao"):
                cankao = paragraphs(node.get("cankao") or "")
            if trans and anno:
                break
        appreciation: List[str] = []
        for key in ("赏析", "鉴赏", "赏析二"):
            node = sons.get(key)
            if node is None:
                continue
            appreciation = _son_content(node)
            if appreciation:
                break
        background = _son_content(sons.get("创作背景") or {})

        yield {
            "src": "gushiwen",
            "src_id": str(rec.get("href") or rec.get("id") or ""),
            "title": title,
            "author": clean_text_value(rec.get("author")) or None,
            "dynasty": clean_text_value(rec.get("dynasty")) or None,
            "body": "\n".join(content),
            "translation": join_paragraphs(trans),
            "annotation": join_paragraphs(anno),
            "appreciation": join_paragraphs(appreciation),
            "background": join_paragraphs(background),
            "meta": {
                "href": rec.get("href"),
                "cankao": join_paragraphs(cankao),
                "sonKeys": sorted(sons.keys()),
            },
        }
        n += 1
        if limit and n >= limit:
            return


# ---------------------------------------------------------------- 源：poems-db

def read_poems_db(data_dir: Path, limit: Optional[int]) -> Iterator[Dict[str, Any]]:
    folder = data_dir / "poems-db-master"
    files = sorted(folder.glob("poems[0-9].json"))
    if not files:
        files = sorted(folder.glob("poems*.json"))
    if not files:
        print(f"[warn] 缺文件，跳过 poems-db 源: {folder}")
        return
    n = 0
    for f in files:
        for rec in iter_json_records(str(f)):
            title = clean_title(rec.get("name"))
            content = poem_lines(join_paragraphs(rec.get("content")) or "")
            if not title or not content:
                continue
            appreciation = list(rec.get("appreciation") or []) + list(rec.get("appreciation_res") or [])
            yield {
                "src": "poemsdb",
                "src_id": str((rec.get("_id") or {}).get("$oid") or rec.get("onlyId") or ""),
                "title": title,
                "author": clean_text_value(rec.get("author")) or None,
                "dynasty": clean_text_value(rec.get("dynasty")) or None,
                "body": "\n".join(content),
                "translation": join_paragraphs(rec.get("translate")),
                "annotation": join_paragraphs(rec.get("notes")),
                "appreciation": join_paragraphs(appreciation),
                "background": None,
                "meta": {
                    "tags": rec.get("tags"),
                    "type": rec.get("type"),
                    "format": rec.get("format"),
                    "onlyId": rec.get("onlyId"),
                    "sourceLink": rec.get("sourceLink"),
                    "translate_res": rec.get("translate_res"),
                    "appreciation_res": rec.get("appreciation_res"),
                    "reference": rec.get("reference"),
                    "updateAt": rec.get("updateAt"),
                },
            }
            n += 1
            if limit and n >= limit:
                return


# ---------------------------------------------------------------- 源：guwen

def read_guwen(data_dir: Path, limit: Optional[int]) -> Iterator[Dict[str, Any]]:
    folder = data_dir / "chinese-gushiwen-master" / "guwen"
    files = sorted(folder.glob("guwen*.json"))
    if not files:
        print(f"[warn] 缺文件，跳过 guwen 源: {folder}")
        return
    n = 0
    for f in files:
        for rec in iter_json_records(str(f)):
            title = clean_title(rec.get("title"))
            content = poem_lines(rec.get("content") or "")
            if not title or not content:
                continue
            yield {
                "src": "guwen",
                "src_id": str((rec.get("_id") or {}).get("$oid") or ""),
                "title": title,
                "author": clean_text_value(rec.get("writer")) or None,
                "dynasty": clean_text_value(rec.get("dynasty")) or None,
                "body": "\n".join(content),
                "translation": join_paragraphs(paragraphs(rec.get("translation") or "")),
                "annotation": join_paragraphs(paragraphs(rec.get("remark") or "")),
                "appreciation": join_paragraphs(paragraphs(rec.get("shangxi") or "")),
                "background": None,
                "meta": {"type": rec.get("type"), "audioUrl": rec.get("audioUrl")},
            }
            n += 1
            if limit and n >= limit:
                return


def read_writers(data_dir: Path, limit: Optional[int]) -> Iterator[Dict[str, Any]]:
    folder = data_dir / "chinese-gushiwen-master" / "writer"
    files = sorted(folder.glob("writer*.json"))
    n = 0
    for f in files:
        for rec in iter_json_records(str(f)):
            name = clean_text_value(rec.get("name"))
            if not name:
                continue
            intro = strip_html(rec.get("simpleIntro") or "").strip()
            birth, death = parse_lifespan(intro)
            yield {
                "name": name,
                "src": "gushiwen",
                "intro": intro or None,
                "birth": birth,
                "death": death,
                "avatar": (rec.get("headImageUrl") or "").strip() or None,
                "detail": rec.get("detailIntro") or None,
            }
            n += 1
            if limit and n >= limit:
                return


# ---------------------------------------------------------------- 阶段一

SRC_SCHEMA = """
DROP TABLE IF EXISTS src_poem;
DROP TABLE IF EXISTS src_author;
CREATE TABLE src_poem (
  id           INTEGER PRIMARY KEY,
  src          TEXT NOT NULL,
  src_id       TEXT,
  title        TEXT NOT NULL,
  author       TEXT,
  dynasty      TEXT,
  body         TEXT NOT NULL,
  body_key     TEXT NOT NULL,
  translation  TEXT,
  annotation   TEXT,
  appreciation TEXT,
  background   TEXT,
  meta         TEXT,
  UNIQUE (src, title, author)
);
CREATE TABLE src_author (
  name   TEXT PRIMARY KEY,
  src    TEXT,
  intro  TEXT,
  birth  TEXT,
  death  TEXT,
  avatar TEXT,
  detail TEXT
);
"""


def print_stats(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    print("\n=== 阶段一产物统计 ===")
    cur.execute(
        """SELECT src, COUNT(*),
                  SUM(translation IS NOT NULL),
                  SUM(annotation IS NOT NULL),
                  SUM(appreciation IS NOT NULL),
                  SUM(background IS NOT NULL)
             FROM src_poem GROUP BY src ORDER BY src"""
    )
    print(f"{'源':<12}{'条数':>9}{'译文':>9}{'注释':>9}{'赏析':>9}{'背景':>9}")
    total = [0, 0, 0, 0, 0]
    for row in cur.fetchall():
        print(f"{row[0]:<12}{row[1]:>9,}{row[2]:>9,}{row[3]:>9,}{row[4]:>9,}{row[5]:>9,}")
        for i in range(5):
            total[i] += row[i + 1] or 0
    print(f"{'合计':<12}{total[0]:>9,}{total[1]:>9,}{total[2]:>9,}{total[3]:>9,}{total[4]:>9,}")

    cur.execute("SELECT COUNT(DISTINCT body_key) FROM src_poem")
    keys = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM src_poem")
    rows = cur.fetchone()[0]
    print(f"body_key 去重: {keys:,} / {rows:,} 行（重复率 {100 * (1 - keys / max(rows, 1)):.1f}%）")
    cur.execute("SELECT COUNT(*) FROM src_author WHERE avatar IS NOT NULL")
    av = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM src_author")
    au = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM src_author WHERE birth IS NOT NULL")
    life = cur.fetchone()[0]
    print(f"作者: {au:,} 人（有头像 {av:,}，解析出生卒年 {life:,}）")

    cur.execute("SELECT COUNT(*) FROM src_poem WHERE body_key = ''")
    empty = cur.fetchone()[0]
    if empty:
        print(f"[warn] body_key 为空的行: {empty}")


def stage_sources(data_dir: Path, limit: Optional[int]) -> Path:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    out = BUILD_DIR / "sources.db"
    if out.exists():
        out.unlink()
    conn = sqlite3.connect(str(out))
    conn.executescript(SRC_SCHEMA)
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")

    insert = (
        "INSERT OR IGNORE INTO src_poem "
        "(src, src_id, title, author, dynasty, body, body_key, translation, annotation, appreciation, background, meta) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    counters: Dict[str, int] = {}
    cleaned_titles = 0
    t0 = time.time()
    for name, reader in (("gushiwen", read_gushiwen), ("poemsdb", read_poems_db), ("guwen", read_guwen)):
        n = 0
        for rec in reader(data_dir, limit):
            if "（写" in rec["title"] or "(写" in rec["title"] or "（做" in rec["title"]:
                cleaned_titles += 1
            conn.execute(
                insert,
                (
                    rec["src"], rec["src_id"], rec["title"], rec["author"], rec["dynasty"],
                    rec["body"], body_key(rec["body"]), rec["translation"], rec["annotation"],
                    rec["appreciation"], rec["background"],
                    json.dumps(rec["meta"], ensure_ascii=False) if rec["meta"] else None,
                ),
            )
            n += 1
        counters[name] = n
        conn.commit()
        print(f"[sources] {name}: 读入 {n:,} 条  ({time.time() - t0:.1f}s)")

    a_ins = "INSERT OR REPLACE INTO src_author (name, src, intro, birth, death, avatar, detail) VALUES (?,?,?,?,?,?,?)"
    an = 0
    for a in read_writers(data_dir, limit):
        conn.execute(a_ins, (a["name"], a["src"], a["intro"], a["birth"], a["death"], a["avatar"], a["detail"]))
        an += 1
    conn.commit()
    print(f"[sources] 作者: {an:,} 人")
    if cleaned_titles:
        print(f"[sources] 标题含 AI 提示残留（清洗后仍保留）: {cleaned_titles}")

    print_stats(conn)
    conn.execute("VACUUM")
    conn.close()
    print(f"\n写出: {out}  ({out.stat().st_size / 1024 / 1024:.1f} MB, 用时 {time.time() - t0:.1f}s)")
    return out


# ---------------------------------------------------------------- 拼音 / 归一化

DICT_PATH = REPO / "scripts" / "data" / "pinyin.dict.json"
_NON_KEY_RE = re.compile(r"[^\u4e00-\u9fffA-Za-z0-9]")
_pinyin: Optional[Dict[str, str]] = None


class Pinyin:
    """字级拼音字典（由 scripts/gen-pinyin-dict.mjs 用 pinyin-pro 导出）。

    仅用于建库期给「三源独有诗」生成 slug；前端展示走运行时 pinyin-pro（词级消歧，更准）。
    """

    def __init__(self, path: Path = DICT_PATH) -> None:
        if path.exists():
            self.table: Dict[str, str] = json.loads(path.read_text(encoding="utf-8"))
        else:
            self.table = {}
            print(f"[warn] 缺拼音字典 {path}，slug 将退化为 han-<hex>")
        self.miss = 0

    def slugify(self, text: Optional[str], fallback: str = "x") -> str:
        parts: List[str] = []
        for ch in text or "":
            if "\u4e00" <= ch <= "\u9fff":
                py = self.table.get(ch)
                if py:
                    parts.append(py)
                else:
                    self.miss += 1
                    parts.append(f"han{ord(ch):x}")
            elif ch.isascii() and ch.isalnum():
                parts.append(ch.lower())
        return "-".join(parts) or fallback


def norm_key(text: Optional[str]) -> str:
    """匹配键归一化：只留汉字/字母/数字，去掉标点、空格与「・」。

    先解码 HTML 实体：gushiwen 的标题带字面 `&nbsp;`（如「子规&nbsp;[一作…」），
    解码后与另一源的「子规 [一作…」归一到同一个键，跨源去重才能命中，
    否则同一首诗会同时以两条记录出现在列表里（用户看到的重复条目）。
    """
    return _NON_KEY_RE.sub("", html.unescape(text or "")).lower()


def gz(text: Optional[str]) -> Optional[bytes]:
    """与库中既有 BLOB 一致的 gzip 压缩文本（前端 src/lib/compress.ts 会自动解压）。"""
    if not text:
        return None
    return gzip.compress(text.encode("utf-8"), 6)


def unique_slug(base: str, used: set) -> str:
    if base not in used:
        used.add(base)
        return base
    i = 2
    while f"{base}-{i}" in used:
        i += 1
    s = f"{base}-{i}"
    used.add(s)
    return s


# ---------------------------------------------------------------- 朝代

# 三源朝代名 → 旧库 dynasty.slug
DYNASTY_FIX: Dict[str, str] = {
    "唐": "tang", "唐代": "tang", "宋": "song", "宋代": "song",
    "元": "yuan", "元代": "yuan", "明": "ming", "明代": "ming",
    "清": "qing", "清代": "qing", "先秦": "xian-qin", "五代": "wu-dai",
    "五代十国": "wu-dai", "南北朝": "nan-bei-chao", "两汉": "han", "汉": "han",
    "魏晋": "wei-jin", "隋": "sui", "隋代": "sui", "金": "jin-chao", "金朝": "jin-chao",
    "辽": "liao", "辽朝": "liao", "近代": "jin-dai", "近现代": "jin-dai",
    "现代": "xian-dai", "当代": "dang-dai", "未知": "unknown", "": "unknown",
}

# slug -> (显示名, 起始年, 结束年)；"前" 前缀表示公元前
DYNASTY_YEARS: Dict[str, Tuple[str, Optional[str], Optional[str]]] = {
    "xian-qin": ("先秦", "前1046", "前221"),
    "chun-qiu": ("春秋", "前770", "前476"),
    "zhan-guo": ("战国", "前475", "前221"),
    "chu": ("楚", "前1115", "前223"),
    "han": ("汉", "前202", "220"),
    "wei-jin": ("魏晋", "220", "420"),
    "jin": ("晋", "265", "420"),
    "nan-bei-chao": ("南北朝", "420", "589"),
    "sui": ("隋代", "581", "618"),
    "tang": ("唐代", "618", "907"),
    "wu-dai": ("五代", "907", "960"),
    "song": ("宋代", "960", "1279"),
    "liao": ("辽朝", "916", "1125"),
    "jin-chao": ("金朝", "1115", "1234"),
    "yuan": ("元代", "1271", "1368"),
    "ming": ("明代", "1368", "1644"),
    "qing": ("清代", "1636", "1912"),
    "jin-dai": ("近代", "1840", "1919"),
    "xian-dai": ("现代", "1919", "1949"),
    "dang-dai": ("当代", "1949", None),
    "unknown": ("未知", None, None),
}

# 作者别名 → 旧库既有 slug
AUTHOR_FIX: Dict[str, str] = {"佚名": "wu-ming-shi", "无名氏": "wu-ming-shi", "不详": "wu-ming-shi"}


# ---------------------------------------------------------------- 阶段二：合并建库

FINAL_SCHEMA = """
DROP TABLE IF EXISTS poems;
DROP TABLE IF EXISTS poem_content;
DROP TABLE IF EXISTS authors;
DROP TABLE IF EXISTS dynasties;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS poem_tags;
DROP TABLE IF EXISTS schema_version;
DROP VIEW  IF EXISTS poem_rich;

CREATE TABLE authors (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  poem_count  INTEGER NOT NULL DEFAULT 0,
  description BLOB DEFAULT NULL,
  birth_year  TEXT DEFAULT NULL,
  death_year  TEXT DEFAULT NULL,
  avatar      TEXT DEFAULT NULL
);

CREATE TABLE dynasties (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  poem_count INTEGER NOT NULL DEFAULT 0,
  start_year TEXT DEFAULT NULL,
  end_year   TEXT DEFAULT NULL
);

CREATE TABLE poems (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  author_slug  TEXT NOT NULL,
  dynasty_slug TEXT NOT NULL,
  rhythmic     TEXT DEFAULT NULL,
  excerpt      TEXT DEFAULT NULL,
  source       TEXT DEFAULT NULL,
  has_content  INTEGER NOT NULL DEFAULT 0,
  meta         TEXT DEFAULT NULL
);

CREATE TABLE poem_content (
  slug         TEXT PRIMARY KEY,
  paragraphs   BLOB NOT NULL,
  translation  BLOB DEFAULT NULL,
  appreciation BLOB DEFAULT NULL,
  annotation   BLOB DEFAULT NULL,
  background   BLOB DEFAULT NULL
);

CREATE TABLE tags (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  poem_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE poem_tags (
  poem_slug TEXT NOT NULL,
  tag_slug  TEXT NOT NULL,
  PRIMARY KEY (poem_slug, tag_slug)
);

CREATE TABLE schema_version (
  version     INTEGER PRIMARY KEY,
  update_time TEXT DEFAULT CURRENT_TIMESTAMP
);
"""

# 只含三件套任一非空的诗；供「热门诗词」与搜索过滤
POEM_RICH_VIEW = """
CREATE VIEW poem_rich AS
SELECT p.slug            AS slug,
       p.title           AS title,
       p.author_slug     AS author_slug,
       a.name            AS author_name,
       p.dynasty_slug    AS dynasty_slug,
       d.name            AS dynasty_name,
       p.excerpt         AS excerpt,
       c.translation IS NOT NULL  AS has_translation,
       c.annotation IS NOT NULL   AS has_annotation,
       c.appreciation IS NOT NULL AS has_appreciation,
       (CASE WHEN c.translation  IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN c.annotation   IS NOT NULL THEN 1 ELSE 0 END +
        CASE WHEN c.appreciation IS NOT NULL THEN 1 ELSE 0 END) AS richness
  FROM poems p
  JOIN poem_content c ON c.slug = p.slug
  LEFT JOIN authors   a ON a.slug = p.author_slug
  LEFT JOIN dynasties d ON d.slug = p.dynasty_slug
 WHERE c.translation IS NOT NULL OR c.annotation IS NOT NULL OR c.appreciation IS NOT NULL;
"""

FINAL_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_poems_author_slug  ON poems(author_slug)",
    "CREATE INDEX IF NOT EXISTS idx_poems_dynasty_slug ON poems(dynasty_slug)",
    "CREATE INDEX IF NOT EXISTS idx_poem_tags_tag_slug ON poem_tags(tag_slug)",
    "CREATE INDEX IF NOT EXISTS idx_poems_title        ON poems(title)",
    "CREATE INDEX IF NOT EXISTS idx_poems_title_author ON poems(title, author_slug)",
    "CREATE INDEX IF NOT EXISTS idx_poems_has_content  ON poems(has_content, dynasty_slug)",
    "CREATE INDEX IF NOT EXISTS idx_authors_name       ON authors(name)",
]

SRC_FIELDS = ("translation", "annotation", "appreciation", "background")


def enrich_from_sources(
    conn: sqlite3.Connection, src_db: Path, py: Pinyin, stats: Dict[str, int]
) -> None:
    """把三源内容合并进已复制的旧库数据；三源独有诗另建条目。"""
    cur = conn.cursor()

    cur.execute("ATTACH DATABASE ? AS src", (str(src_db),))

    # 现有作者：name -> slug
    author_by_name: Dict[str, str] = {n: s for s, n in cur.execute("SELECT slug, name FROM authors")}
    used_author_slugs = set(author_by_name.values())
    new_authors: List[Tuple[str, str]] = []

    # 现有朝代 slug 集合
    known_dyn = {s for (s,) in cur.execute("SELECT slug FROM dynasties")}

    # 旧库 (title, author) -> slug
    key2slug: Dict[Tuple[str, str], str] = {}
    for slug, title, aname in cur.execute(
        "SELECT p.slug, p.title, a.name FROM poems p LEFT JOIN authors a ON a.slug = p.author_slug"
    ):
        key2slug.setdefault((norm_key(title), norm_key(aname)), slug)
    print(f"[final] 旧库匹配键: {len(key2slug):,}")

    # 已有内容标记（避免逐行 SELECT）
    have: Dict[str, Tuple[int, int, int, int]] = {
        slug: (int(bool(t)), int(bool(a)), int(bool(ap)), int(bool(bg)))
        for slug, t, a, ap, bg in cur.execute(
            "SELECT slug, translation, annotation, appreciation, background FROM poem_content"
        )
    }

    used_poem_slugs = {s for (s,) in cur.execute("SELECT slug FROM poems")}

    # 按「内容丰度」取 rowid（只排序小整数，避免把正文/译文等大 BLOB 拖进排序临时文件）
    cur.execute(
        "SELECT rowid FROM src.src_poem ORDER BY "
        "(translation IS NULL) + (annotation IS NULL) + (appreciation IS NULL), "
        "(background IS NULL), rowid"
    )
    rid_list = [r[0] for r in cur.fetchall()]
    print(f"[final] 源记录排序完成: {len(rid_list):,}")

    seen: set = set()
    enrich_groups: Dict[Tuple[str, ...], List[Tuple]] = {}
    new_poem_rows: List[Tuple] = []
    new_content_rows: List[Tuple] = []
    new_tag_rows: List[Tuple] = []
    src_counter: Dict[str, int] = {}
    pick = conn.cursor()

    SRC_SELECT = (
        "SELECT src, src_id, title, author, dynasty, body, translation, annotation, "
        "appreciation, background, meta FROM src.src_poem WHERE rowid = ?"
    )

    for n, rid in enumerate(rid_list, 1):
        row = pick.execute(SRC_SELECT, (rid,)).fetchone()
        if row is None:
            continue
        src, src_id, title, author, dynasty, body, tr, an, ap, bg, meta = row
        key = (norm_key(title), norm_key(author))
        if key in seen:
            continue
        seen.add(key)
        src_counter[src] = src_counter.get(src, 0) + 1
        slug = key2slug.get(key)

        if slug is None:
            # ---- 三源独有：新建诗条目
            a_slug = author_by_name.get(author or "")
            if a_slug is None:
                fixed = AUTHOR_FIX.get(author or "")
                if fixed and fixed in used_author_slugs:
                    a_slug = fixed
                else:
                    a_slug = unique_slug(py.slugify(author or "", "unknown-author"), used_author_slugs)
                    new_authors.append((a_slug, author or "未知"))
                author_by_name[author or ""] = a_slug
            d_slug = DYNASTY_FIX.get((dynasty or "").strip(), "unknown")
            p_slug = unique_slug(f"{a_slug}-{py.slugify(title, 'untitled')}", used_poem_slugs)
            excerpt = (body or "").split("\n", 1)[0][:60] or None
            new_poem_rows.append(
                (p_slug, title, a_slug, d_slug, None, excerpt, src, 1 if (tr or an or ap) else 0, meta)
            )
            # paragraphs 统一存 JSON 数组字符串（与旧库 legacy 数据形态一致）。
            # 前端 src/lib/db.ts 的 parseParagraphLines() 两种形态都能解析，
            # 但保持单一形态可以避免下游消费者再踩 JSON.parse 抛异常的坑。
            body_json = json.dumps([line for line in (body or "").split("\n") if line], ensure_ascii=False)
            new_content_rows.append((p_slug, gz(body_json), gz(tr), gz(an), gz(ap), gz(bg)))
            new_tag_rows.append((p_slug, "shi-ci"))
            stats["inserted"] += 1
        else:
            # ---- 命中旧库：只补空列
            flags = have.get(slug, (0, 0, 0, 0))
            cols: List[str] = []
            vals: List[Any] = []
            for i, (col, val) in enumerate(zip(SRC_FIELDS, (tr, an, ap, bg))):
                if val and not flags[i]:
                    cols.append(col)
                    vals.append(gz(val))
                    have[slug] = tuple(1 if j == i else flags[j] for j in range(4))
            if cols:
                vals.append(slug)
                enrich_groups.setdefault(tuple(cols), []).append(tuple(vals))
                stats["enriched"] += 1
            if tr or an or ap:
                stats["rich_hits"] += 1
        stats["scanned"] += 1

        if n % 20000 == 0:
            conn.commit()
            print(f"[final]   已处理 {n:,}/{len(rid_list):,}")

    conn.commit()

    print(f"[final] 源记录扫描 {stats['scanned']:,}")
    for s, n in sorted(src_counter.items()):
        print(f"[final]   {s}: {n:,}")

    if new_authors:
        cur.executemany("INSERT OR IGNORE INTO authors (slug, name) VALUES (?,?)", new_authors)
        stats["new_authors"] = len(new_authors)
    if enrich_groups:
        for cols, rows in enrich_groups.items():
            stmt = f"UPDATE poem_content SET {', '.join(c + '=?' for c in cols)} WHERE slug=?"
            cur.executemany(stmt, rows)
        print(f"[final] 富化语句批次: {len(enrich_groups)} 组 / {stats['enriched']:,} 条")
    if new_poem_rows:
        cur.executemany(
            "INSERT OR IGNORE INTO poems (slug,title,author_slug,dynasty_slug,rhythmic,excerpt,source,has_content,meta) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            new_poem_rows,
        )
        cur.executemany(
            "INSERT OR IGNORE INTO poem_content (slug,paragraphs,translation,annotation,appreciation,background) "
            "VALUES (?,?,?,?,?,?)",
            new_content_rows,
        )
        cur.executemany("INSERT OR IGNORE INTO poem_tags (poem_slug, tag_slug) VALUES (?,?)", new_tag_rows)
    conn.commit()
    cur.execute("DETACH DATABASE src")
    conn.commit()


def fill_authors(conn: sqlite3.Connection, src_db: Path) -> None:
    """用三源作者简介/生卒年/头像补 authors 表。"""
    cur = conn.cursor()
    cur.execute("ATTACH DATABASE ? AS src", (str(src_db),))
    rows = list(
        cur.execute("SELECT name, intro, birth, death, avatar FROM src.src_author")
    )
    cur.execute("DETACH DATABASE src")
    conn.commit()

    by_name = {n: s for s, n in cur.execute("SELECT slug, name FROM authors")}
    groups: Dict[Tuple[str, ...], List[Tuple]] = {}
    for name, intro, birth, death, avatar in rows:
        slug = by_name.get(name) or AUTHOR_FIX.get(name)
        if not slug:
            continue
        cols: List[str] = []
        vals: List[Any] = []
        if intro:
            cols.append("description")
            vals.append(gz(intro))
        if birth:
            cols.append("birth_year")
            vals.append(birth)
        if death:
            cols.append("death_year")
            vals.append(death)
        if avatar:
            cols.append("avatar")
            vals.append(avatar)
        if not cols:
            continue
        vals.append(slug)
        groups.setdefault(tuple(cols), []).append(tuple(vals))
    filled = 0
    for cols, gro in groups.items():
        stmt = f"UPDATE authors SET {', '.join(c + '=?' for c in cols)} WHERE slug=?"
        cur.executemany(stmt, gro)
        filled += len(gro)
    conn.commit()
    print(f"[final] 作者补全: {filled:,} 人（源 {len(rows):,} 人）")


def fill_dynasties(conn: sqlite3.Connection) -> None:
    """补齐朝代起止年份；三源出现的新朝代一并建条目。"""
    cur = conn.cursor()
    cur.execute("SELECT slug FROM dynasties")
    have = {s for (s,) in cur.fetchall()}
    py = Pinyin()
    for slug, (name, start, end) in DYNASTY_YEARS.items():
        if slug in have:
            cur.execute("UPDATE dynasties SET start_year=?, end_year=? WHERE slug=?", (start, end, slug))
        else:
            cur.execute(
                "INSERT OR IGNORE INTO dynasties (slug, name, poem_count, start_year, end_year) VALUES (?,?,0,?,?)",
                (slug, name, start, end),
            )
    cur.execute("SELECT slug, name FROM dynasties")
    for slug, name in cur.fetchall():
        if slug not in DYNASTY_YEARS:
            cur.execute("UPDATE dynasties SET name=? WHERE slug=?", (name, slug))
    conn.commit()


def recount(conn: sqlite3.Connection) -> None:
    """重算 poem_count / has_content。

    注：必须先建 poems(author_slug)/(dynasty_slug) 索引，否则相关子查询退化为
    O(作者数 × 诗词数) 的全表扫描（实测会让整个阶段从几分钟涨到几十分钟）。
    """
    cur = conn.cursor()
    cur.execute("CREATE INDEX IF NOT EXISTS idx_poems_author_slug  ON poems(author_slug)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_poems_dynasty_slug ON poems(dynasty_slug)")

    cur.execute("DROP TABLE IF EXISTS temp._agg")
    cur.execute("CREATE TEMP TABLE _agg AS SELECT author_slug AS s, COUNT(*) AS c FROM poems GROUP BY author_slug")
    cur.execute("CREATE INDEX temp.idx_agg_s ON _agg(s)")
    cur.execute("UPDATE authors SET poem_count = COALESCE((SELECT c FROM _agg WHERE s = authors.slug), 0)")

    cur.execute("DROP TABLE IF EXISTS temp._aggd")
    cur.execute("CREATE TEMP TABLE _aggd AS SELECT dynasty_slug AS s, COUNT(*) AS c FROM poems GROUP BY dynasty_slug")
    cur.execute("CREATE INDEX temp.idx_aggd_s ON _aggd(s)")
    cur.execute("UPDATE dynasties SET poem_count = COALESCE((SELECT c FROM _aggd WHERE s = dynasties.slug), 0)")

    cur.execute("DROP TABLE IF EXISTS temp._aggt")
    cur.execute("CREATE TEMP TABLE _aggt AS SELECT tag_slug AS s, COUNT(*) AS c FROM poem_tags GROUP BY tag_slug")
    cur.execute("CREATE INDEX temp.idx_aggt_s ON _aggt(s)")
    cur.execute("UPDATE tags SET poem_count = COALESCE((SELECT c FROM _aggt WHERE s = tags.slug), 0)")

    cur.execute("UPDATE poems SET has_content = 0")
    cur.execute(
        "UPDATE poems SET has_content = 1 WHERE EXISTS (SELECT 1 FROM poem_content c "
        "WHERE c.slug = poems.slug AND (c.translation IS NOT NULL OR c.annotation IS NOT NULL "
        "OR c.appreciation IS NOT NULL))"
    )
    cur.execute("INSERT OR IGNORE INTO tags (slug, name, poem_count) VALUES ('shi-ci','诗词',0)")
    conn.commit()
    print("[final] 计数重算完成")


def final_stats(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    print("\n=== 阶段二产物统计 ===")
    for label, sql in (
        ("诗词总数", "SELECT COUNT(*) FROM poems"),
        ("正文行数", "SELECT COUNT(*) FROM poem_content"),
        ("有译文", "SELECT COUNT(*) FROM poem_content WHERE translation IS NOT NULL"),
        ("有注释", "SELECT COUNT(*) FROM poem_content WHERE annotation IS NOT NULL"),
        ("有赏析", "SELECT COUNT(*) FROM poem_content WHERE appreciation IS NOT NULL"),
        ("有背景", "SELECT COUNT(*) FROM poem_content WHERE background IS NOT NULL"),
        ("has_content=1", "SELECT COUNT(*) FROM poems WHERE has_content = 1"),
        ("poem_rich 视图", "SELECT COUNT(*) FROM poem_rich"),
        ("作者", "SELECT COUNT(*) FROM authors"),
        ("作者有简介", "SELECT COUNT(*) FROM authors WHERE description IS NOT NULL"),
        ("作者有生卒年", "SELECT COUNT(*) FROM authors WHERE birth_year IS NOT NULL"),
        ("朝代", "SELECT COUNT(*) FROM dynasties"),
        ("标签", "SELECT COUNT(*) FROM tags"),
    ):
        print(f"{label:<16}{cur.execute(sql).fetchone()[0]:>10,}")
    print("\n分朝代（poem_rich 视图内）:")
    for name, n in cur.execute(
        "SELECT dynasty_name, COUNT(*) c FROM poem_rich GROUP BY dynasty_name ORDER BY c DESC LIMIT 8"
    ):
        print(f"  {name or '?':<8}{n:>9,}")
    cur.execute("SELECT name, poem_count FROM authors ORDER BY poem_count DESC LIMIT 5")
    print("\n作者 Top5（复算后）:")
    for name, n in cur.fetchall():
        print(f"  {name:<8}{n:>9,}")
    dup = cur.execute(
        "SELECT COUNT(*) FROM (SELECT slug FROM poems GROUP BY slug HAVING COUNT(*)>1)"
    ).fetchone()[0]
    print(f"\nslug 重复: {dup}")


def stage_final(src_db: Path, old_db: Path, out: Path, fts: bool = False) -> Path:
    if not old_db.exists():
        raise FileNotFoundError(f"缺旧库（chinese-poetry 侧）: {old_db}")
    if not src_db.exists():
        raise FileNotFoundError(f"缺阶段一产物: {src_db}（先跑 --stage sources）")
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    py_root = Pinyin()
    conn = sqlite3.connect(str(out))
    conn.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
    conn.executescript(FINAL_SCHEMA)
    t0 = time.time()

    # 1) 复制旧库结构数据
    #    ⚠ 旧库里的三源记录（gushiwen / poemsdb / guwen）是历史导入的脏数据：正文没分行、
    #    标题残留 &nbsp; 等实体，而且 slug 与阶段一的干净版本不同（同一首诗会变成两条）。
    #    所以这里只保留 chinese-poetry 原站数据（source IS NULL），三源全部改由 sources.db 重写；
    #    同时把 source 列一并复制（原实现漏了这一列，导致最终库来源信息丢失）。
    conn.execute("ATTACH DATABASE ? AS old", (str(old_db),))
    conn.execute(
        "INSERT INTO poems (slug,title,author_slug,dynasty_slug,rhythmic,excerpt,source) "
        "SELECT slug,title,author_slug,dynasty_slug,rhythmic,excerpt,source FROM old.poems WHERE source IS NULL"
    )
    for table, cols in (
        ("authors", "slug,name,poem_count,description"),
        ("dynasties", "slug,name,poem_count"),
        ("tags", "slug,name,poem_count"),
    ):
        conn.execute(f"INSERT INTO {table} ({cols}) SELECT {cols} FROM old.{table}")
        n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"[final] 复制 {table:<14}{n:>9,}  ({time.time() - t0:.1f}s)")
    conn.execute(
        "INSERT INTO poem_content (slug,paragraphs,translation,appreciation,annotation,background) "
        "SELECT c.slug,c.paragraphs,c.translation,c.appreciation,c.annotation,c.background "
        "FROM old.poem_content c JOIN old.poems p ON p.slug = c.slug WHERE p.source IS NULL"
    )
    conn.execute(
        "INSERT INTO poem_tags (poem_slug,tag_slug) "
        "SELECT pt.poem_slug,pt.tag_slug FROM old.poem_tags pt "
        "JOIN old.poems p ON p.slug = pt.poem_slug WHERE p.source IS NULL"
    )
    print(
        f"[final] 复制 {'poems(原站)':<12}{conn.execute('SELECT COUNT(*) FROM poems').fetchone()[0]:>9,}"
        f" / poem_content {conn.execute('SELECT COUNT(*) FROM poem_content').fetchone()[0]:>9,}"
        f" / poem_tags {conn.execute('SELECT COUNT(*) FROM poem_tags').fetchone()[0]:>9,}"
        f"  ({time.time() - t0:.1f}s)"
    )
    conn.commit()
    conn.execute("DETACH DATABASE old")
    conn.commit()

    fill_dynasties(conn)

    # 2) 合并三源
    stats = dict(scanned=0, enriched=0, inserted=0, rich_hits=0, new_authors=0)
    enrich_from_sources(conn, src_db, py_root, stats)
    print(
        f"[final] 富化命中旧库 {stats['enriched']:,} 首，新增三源独有诗 {stats['inserted']:,} 首"
        f"（其中带译文/注释/赏析 {stats['rich_hits']:,} 首）"
    )
    if py_root.miss:
        print(f"[final] 拼音缺字（回退 han-<hex>）: {py_root.miss:,}")

    # 3) 作者与计数
    fill_authors(conn, src_db)
    recount(conn)

    # 4) 索引 / 视图
    for stmt in FINAL_INDEXES:
        conn.execute(stmt)
    conn.execute(POEM_RICH_VIEW)
    if fts:
        n = build_fts(conn)
        print(f"[final] 已建 FTS5 标题/作者索引：{n:,} 行")
    conn.execute("INSERT OR REPLACE INTO schema_version (version, update_time) VALUES (3, datetime('now'))")
    conn.commit()

    final_stats(conn)
    conn.execute("VACUUM")
    conn.close()
    print(f"\n写出: {out}  ({out.stat().st_size / 1024 / 1024:.1f} MB, 用时 {time.time() - t0:.1f}s)")
    return out


# ---------------------------------------------------------------- FTS

# FTS5 标题/作者索引。
# 中文不能被 unicode61 自然分词，所以入库前把文本手动切成「单字 + 相邻字对」的空格串：
#   「静夜思」 -> 「静 夜 思 静夜 夜思」
# 查询侧用同一套切分做 AND 组合（示例：「静夜」-> "静" AND "夜" AND "静夜"），
# 于是 1/2/3+ 字的子串查询都能命中倒排索引。
# 为什么不用 trigram：trigram 对 <3 字的查询必定返回 0（中文两字词很常见），
# 而回退 LIKE 要全表扫描 474,270 行（实测 3.3s，原 Next.js 版是 10.8s）。
# ⚠ 切分逻辑必须与前端 src/lib/db.ts 的 toFtsMatch() 保持一致。
FTS_DROP = "DROP TABLE IF EXISTS poems_fts"
FTS_CREATE = (
    "CREATE VIRTUAL TABLE poems_fts USING fts5"
    "(title, author, tokenize='unicode61', content='')"
)

# \w 在 Python 里默认匹配 Unicode 字母/数字（含汉字），用来滤掉标点与空白
_WORD_RE = re.compile(r"\w", re.UNICODE)


def gram_text(s: Optional[str]) -> str:
    """切成 unicode61 可索引的空格串：单字 + 相邻字对（标点/空白先剔除，故跨标点也能命中）。"""
    if not s:
        return ""
    chars = [c for c in s if _WORD_RE.match(c)]
    toks = list(chars)
    toks.extend(chars[i] + chars[i + 1] for i in range(len(chars) - 1))
    return " ".join(toks)


def populate_fts(conn: sqlite3.Connection) -> int:
    rows = [
        (rid, gram_text(title), gram_text(author))
        for rid, title, author in conn.execute(
            "SELECT p.rowid, p.title, COALESCE(a.name,'') FROM poems p "
            "LEFT JOIN authors a ON a.slug = p.author_slug"
        )
    ]
    conn.executemany("INSERT INTO poems_fts (rowid, title, author) VALUES (?,?,?)", rows)
    return len(rows)


def build_fts(conn: sqlite3.Connection) -> int:
    """重建 FTS5 索引（先 DROP，保证分词方式与当前实现一致），返回行数。"""
    conn.execute(FTS_DROP)
    conn.execute(FTS_CREATE)
    return populate_fts(conn)


def add_fts(db: Path) -> None:
    """对已有库补建 FTS5 索引，避免重跑整个 final 阶段。"""
    t0 = time.time()
    conn = sqlite3.connect(db)
    try:
        n = build_fts(conn)
        conn.commit()
        print(
            f"[fts] poems_fts: {n:,} 行，用时 {time.time() - t0:.1f}s，"
            f"库 {db.stat().st_size / 1024 / 1024:.1f} MB"
        )
    finally:
        conn.close()


# ---------------------------------------------------------------- 入口

def default_data_dir() -> Path:
    env = os.environ.get("GUSHI_DATA_DIR")
    if env:
        return Path(env)
    return REPO.parent / "gushi-data"


def default_old_db() -> Path:
    return REPO.parent / "resources" / "poetry_index.db"


def main() -> int:
    ap = argparse.ArgumentParser(description="诗词数据管线")
    ap.add_argument("--stage", choices=["sources", "final", "all", "fts"], default="sources")
    ap.add_argument("--data-dir", type=Path, default=None)
    ap.add_argument("--limit", type=int, default=None, help="每个源只读 N 条（调试用）")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--old-db", type=Path, default=None, help="chinese-poetry 侧旧库（默认 <仓库>/../resources/poetry_index.db）")
    ap.add_argument("--fts", action="store_true", help="额外建 FTS5(trigram) 标题/作者索引（体积 +几十 MB）")
    args = ap.parse_args()

    if args.stage == "fts":
        add_fts(args.out or (BUILD_DIR / "poetry_index.db"))
        return 0

    data_dir = args.data_dir or default_data_dir()
    if not data_dir.exists():
        print(f"[error] 数据目录不存在: {data_dir}", file=sys.stderr)
        return 2
    print(f"[build] 仓库: {REPO}")
    print(f"[build] 数据: {data_dir}")

    src_db = BUILD_DIR / "sources.db"
    if args.stage in ("sources", "all"):
        src_db = stage_sources(data_dir, args.limit)
    if args.stage in ("final", "all"):
        stage_final(
            src_db,
            args.old_db or default_old_db(),
            args.out or (BUILD_DIR / "poetry_index.db"),
            fts=args.fts,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
