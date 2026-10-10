"""给库补建缺失的复合索引，并实测前后耗时。

缺失索引导致的慢查询（实测，477MB / 473,983 首）：
  - WHERE dynasty_slug=? ORDER BY slug  → 宋 1852ms（详情页右侧栏「同朝代」）
  - WHERE rhythmic=?       ORDER BY slug  → 2800ms（词牌列表）
  - GROUP BY rhythmic                    → 2360ms（侧栏词牌 TOP）
  - WHERE author_slug=?    ORDER BY slug  → 作者页（待测）

用法：python perf/add_indexes.py
"""

import os
import sqlite3
import time

DB = r"G:/AIWORK/gushi/resources/poetry_index.db"

LIST_COLS = """SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
       a.name AS author_name, d.name AS dynasty_name
FROM poems p JOIN authors a ON p.author_slug = a.slug JOIN dynasties d ON p.dynasty_slug = d.slug"""

SQLS = {
    "同朝代[宋] LIMIT 11": (f"{LIST_COLS} WHERE p.dynasty_slug = ? ORDER BY p.slug LIMIT ? OFFSET ?", ["song", 11, 0]),
    "同朝代[唐] LIMIT 11": (f"{LIST_COLS} WHERE p.dynasty_slug = ? ORDER BY p.slug LIMIT ? OFFSET ?", ["tang", 11, 0]),
    "词牌[浣溪沙] LIMIT 50": (f"{LIST_COLS} WHERE p.rhythmic = ? ORDER BY p.slug LIMIT ? OFFSET ?", ["浣溪沙", 50, 0]),
    "词牌分组 TOP": ("SELECT rhythmic AS name, COUNT(*) AS poem_count FROM poems WHERE rhythmic IS NOT NULL AND rhythmic != '' GROUP BY rhythmic ORDER BY poem_count DESC", []),
    "作者[陆游] LIMIT 50": (f"{LIST_COLS} WHERE p.author_slug = (SELECT slug FROM authors WHERE name='陆游') ORDER BY p.slug LIMIT ? OFFSET ?", [50, 0]),
    "统计 MAX(rowid)": ("SELECT COALESCE(MAX(rowid),0) FROM poems", []),
}

INDEXES = [
    ("idx_poems_dynasty_slug_slug", "CREATE INDEX IF NOT EXISTS idx_poems_dynasty_slug_slug ON poems(dynasty_slug, slug)"),
    ("idx_poems_rhythmic_slug", "CREATE INDEX IF NOT EXISTS idx_poems_rhythmic_slug ON poems(rhythmic, slug)"),
    ("idx_poems_author_slug_slug", "CREATE INDEX IF NOT EXISTS idx_poems_author_slug_slug ON poems(author_slug, slug)"),
]


def size_mb(path):
    return os.path.getsize(path) / 1024 / 1024


def suite(con, tag, reps=2):
    cur = con.cursor()
    print(f"--- {tag} ---")
    for label, (sql, params) in SQLS.items():
        best = None
        rows = 0
        for _ in range(reps):
            s = time.perf_counter()
            rows = len(cur.execute(sql, params).fetchall())
            e = time.perf_counter()
            ms = (e - s) * 1000
            best = ms if best is None else min(best, ms)
        print(f"  {label}: {best:.1f} ms ({rows} 行)")
    print(f"  [库大小] {size_mb(DB):.0f} MB")


con = sqlite3.connect(DB)
print(f"起始库大小：{size_mb(DB):.0f} MB")
suite(con, "加索引之前")

for name, sql in INDEXES:
    if con.execute("SELECT count(*) FROM sqlite_master WHERE name=?", [name]).fetchone()[0]:
        print(f"  {name} 已存在，跳过")
        continue
    s = time.perf_counter()
    con.execute(sql)
    con.commit()
    print(f"  CREATE {name}: {(time.perf_counter() - s):.1f} s")

print(f"加索引后库大小：{size_mb(DB):.0f} MB")
suite(con, "加索引之后")

con.execute("ANALYZE")
con.commit()
suite(con, "ANALYZE 之后", reps=1)

cur = con.cursor()
print("--- 宋同朝代查询计划 ---")
for r in cur.execute("EXPLAIN QUERY PLAN " + SQLS["同朝代[宋] LIMIT 11"][0], SQLS["同朝代[宋] LIMIT 11"][1]):
    print("  " + r[3])
con.close()
