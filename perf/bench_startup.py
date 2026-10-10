"""模拟桌面版启动 → 首页 → 诗详情页 的完整查询序列，找剩余慢点。

用法：python perf/bench_startup.py
输出每一段的单次耗时（ms）与累计，便于对比优化前后。
"""

import sqlite3
import time

DB = r"G:/AIWORK/gushi/resources/poetry_index.db"

LIST_COLS = """SELECT p.slug, p.title, p.author_slug, p.dynasty_slug, p.rhythmic, p.excerpt,
       a.name AS author_name, d.name AS dynasty_name
FROM poems p JOIN authors a ON p.author_slug = a.slug JOIN dynasties d ON p.dynasty_slug = d.slug"""

STEPS = [
    # ---- 启动（Rust status_of / DbGate）----
    ("启动 status: count(*) poems", "SELECT count(*) FROM poems", []),
    ("启动 status: count(*) 改为 MAX(rowid)", "SELECT COALESCE(MAX(rowid),0) FROM poems", []),
    # ---- 首页 ----
    ("首页 countPoems", "SELECT COUNT(*) as c FROM poems", []),
    ("首页 countAuthors", "SELECT COUNT(*) as c FROM authors", []),
    ("首页 countDynasties", "SELECT COUNT(*) as c FROM dynasties", []),
    ("首页推荐 富化随机(has_content)", f"{LIST_COLS} WHERE p.has_content = 1 ORDER BY RANDOM() LIMIT 6", []),
    ("首页随机 slug (RANDOM 全表)", "SELECT slug FROM poems ORDER BY RANDOM() LIMIT 6", []),
    # ---- 侧栏（每次进页面挂载一次；内存缓存只查一次）----
    ("侧栏 朝代列表", "SELECT slug, name, poem_count FROM dynasties ORDER BY poem_count DESC", []),
    ("侧栏 诗人 TOP500", "SELECT slug, name, poem_count FROM authors ORDER BY poem_count DESC LIMIT 500", []),
    ("侧栏 标签", "SELECT slug, name, poem_count FROM tags ORDER BY poem_count DESC", []),
    ("侧栏 词牌聚合", "SELECT rhythmic AS name, COUNT(*) AS c FROM poems WHERE rhythmic IS NOT NULL AND rhythmic != '' GROUP BY rhythmic ORDER BY c DESC", []),
    # ---- 诗详情页 ----
    ("详情 取诗(主键 slug)", f"{LIST_COLS} WHERE p.slug = ?", ["lu-you-dong-xi-tai-yi-shou"]),
    ("详情 正文 BLOB", "SELECT translation, annotation, appreciation FROM poem_content WHERE slug = ?", ["lu-you-dong-xi-tai-yi-shou"]),
    ("详情 同朝代侧栏 11 首", f"{LIST_COLS} WHERE p.dynasty_slug = ? ORDER BY p.slug LIMIT 11", ["song"]),
    ("详情 作者简介", "SELECT slug, name, description FROM authors WHERE slug = ?", ["lu-you"]),
]


def run(con, reps=2):
    cur = con.cursor()
    total = 0.0
    print(f"{'步骤':<38}{'耗时(ms)':>10}")
    print("-" * 50)
    for label, sql, params in STEPS:
        best = None
        for _ in range(reps):
            t = time.perf_counter()
            cur.execute(sql, params).fetchall()
            e = time.perf_counter()
            ms = (e - t) * 1000
            best = ms if best is None else min(best, ms)
        total += best
        print(f"{label:<38}{best:>10.1f}")
    print("-" * 50)
    print(f"{'合计':<38}{total:>10.1f} ms")
    # 若把 count(*) 两处换成 MAX(rowid)，可省多少
    print("\n注：『启动 status: count(*) poems』与『首页 countPoems』各换 MAX(rowid) 后各约 1ms")


con = sqlite3.connect(DB)
con.execute("PRAGMA mmap_size = 268435456")
con.execute("PRAGMA cache_size = -60000")
run(con)
con.close()
