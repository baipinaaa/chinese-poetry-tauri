"""详情页 / 列表页查询耗时实测（只读）。"""

import sqlite3
import time

DB = r"G:/AIWORK/gushi/resources/poetry_index.db"
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()

POEM_SQL = """SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
       a.name AS author_name, d.name AS dynasty_name
FROM poems p
JOIN authors a ON p.author_slug = a.slug
JOIN dynasties d ON p.dynasty_slug = d.slug
WHERE p.slug = ?"""

LIST_SQL = """SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
       a.name AS author_name, d.name AS dynasty_name
FROM poems p
JOIN authors a ON p.author_slug = a.slug
JOIN dynasties d ON p.dynasty_slug = d.slug
WHERE p.dynasty_slug = ? ORDER BY p.slug LIMIT ? OFFSET ?"""


def t(label, sql, reps=3, params=None):
    best = None
    for _ in range(reps):
        s = time.perf_counter()
        rows = cur.execute(sql, params or []).fetchall()
        e = time.perf_counter()
        ms = (e - s) * 1000
        best = ms if best is None else min(best, ms)
    print(f"  {label}: {best:.1f} ms  (rows={len(rows)})".replace("  (rows", "  rows"))
    return best


slug = cur.execute("SELECT slug FROM poems ORDER BY slug LIMIT 1").fetchone()[0]
print(f"== 详情页（示例 slug={slug}）==")
t("poems JOIN authors JOIN dynasties WHERE slug", POEM_SQL, 3, [slug])
t("poem_content WHERE slug", "SELECT paragraphs, translation, appreciation, annotation FROM poem_content WHERE slug = ?", 3, [slug])
t("poem_tags JOIN tags WHERE poem_slug", "SELECT t.name FROM poem_tags pt JOIN tags t ON pt.tag_slug = t.slug WHERE pt.poem_slug = ?", 3, [slug])

print("== 同朝代数（详情页右侧栏）==")
for d in ("tang", "song", "qing"):
    rows = cur.execute("SELECT count(*) FROM poems WHERE dynasty_slug = ?", [d]).fetchone()
    print(f"  dynasty_slug={d}: {rows[0]} 首")
t("count poems WHERE dynasty_slug", "SELECT COUNT(*) FROM poems WHERE dynasty_slug = ?", 3, ["tang"])
t("list WHERE dynasty_slug ORDER BY slug (11)", LIST_SQL, 3, ["tang", 11, 0])

print("== 列表页 ==")
t("countPoems()", "SELECT COUNT(*) as c FROM poems", 3)
t("countPoems() MAX(rowid)", "SELECT COALESCE(MAX(rowid),0) as c FROM poems", 3)
t("getPoemsAll ORDER BY slug LIMIT 50", """SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
       a.name AS author_name, d.name AS dynasty_name
FROM poems p JOIN authors a ON p.author_slug = a.slug JOIN dynasties d ON p.dynasty_slug = d.slug
ORDER BY p.slug LIMIT ? OFFSET ?""", 3, [50, 0])

con.close()
