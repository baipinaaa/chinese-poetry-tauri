"""实验：ANALYZE 是否能让 ORDER BY slug + dynasty_slug 过滤 走主键扫描（免排序）。

现状：poems 表无 sqlite_stat1（没有统计信息），优化器选择 idx_poems_dynasty_slug + 临时排序，
对宋（29 万首）要 ~2.5s；若能改成按主键顺序扫表 + 过滤，则只需扫几十行。

用法：python perf/bench_analyze.py [--analyze]
      --analyze 会真的执行 ANALYZE（写入 sqlite_stat1），否则只测量。
"""

import sqlite3
import sys
import time

DB = r"G:/AIWORK/gushi/resources/poetry_index.db"

LIST_SQL = """SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
       a.name AS author_name, d.name AS dynasty_name
FROM poems p
JOIN authors a ON p.author_slug = a.slug
JOIN dynasties d ON p.dynasty_slug = d.slug
WHERE p.dynasty_slug = ? ORDER BY p.slug LIMIT ? OFFSET ?"""

RHY_SQL = """SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
       a.name AS author_name, d.name AS dynasty_name
FROM poems p
JOIN authors a ON p.author_slug = a.slug
JOIN dynasties d ON p.dynasty_slug = d.slug
WHERE p.rhythmic = ? ORDER BY p.slug LIMIT ? OFFSET ?"""

RHY_GROUP_SQL = ("SELECT rhythmic AS name, COUNT(*) AS poem_count FROM poems "
                 "WHERE rhythmic IS NOT NULL AND rhythmic != '' GROUP BY rhythmic "
                 "ORDER BY poem_count DESC")


def measure(cur, label, sql, params, reps=2):
    best = None
    for _ in range(reps):
        s = time.perf_counter()
        rows = cur.execute(sql, params).fetchall()
        e = time.perf_counter()
        ms = (e - s) * 1000
        best = ms if best is None else min(best, ms)
    print(f"  {label}: {best:.1f} ms")
    return best


def plan(cur, sql, params):
    return [r[3] for r in cur.execute("EXPLAIN QUERY PLAN " + sql, params)]


def suite(con, tag):
    cur = con.cursor()
    print(f"== {tag} ==")
    print("  [宋] plan:", plan(cur, LIST_SQL, ["song", 11, 0]))
    measure(cur, "宋 同朝代列表 LIMIT 11", LIST_SQL, ["song", 11, 0])
    measure(cur, "唐 同朝代列表 LIMIT 11", LIST_SQL, ["tang", 11, 0])
    measure(cur, "宋 第 5 页 LIMIT 50", LIST_SQL, ["song", 50, 200])
    measure(cur, "词牌列表 浣溪沙 LIMIT 50", RHY_SQL, ["浣溪沙", 50, 0])
    measure(cur, "词牌分组 TOP", RHY_GROUP_SQL, [])


con = sqlite3.connect(DB)  # 可写
suite(con, "ANALYZE 之前")

if "--analyze" in sys.argv:
    print("== 执行 ANALYZE（可能耗时数分钟）==")
    s = time.perf_counter()
    con.execute("ANALYZE")
    con.commit()
    print(f"  ANALYZE 完成：{(time.perf_counter() - s):.1f} s")
    rows = con.execute("SELECT tbl, idx, stat FROM sqlite_stat1 WHERE tbl='poems' ORDER BY idx").fetchall()
    for r in rows:
        print(f"  stat1 {r[0]} / {r[1]}: {r[2][:80]}")
    suite(con, "ANALYZE 之后")

con.close()
