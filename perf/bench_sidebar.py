"""侧边栏/统计类查询耗时实测（只读）+ 索引清单。

用途：定位启动卡顿的 SQL 来源，验证 MAX(rowid) 替代 COUNT(*) 的收益。
"""

import sqlite3
import time

DB = r"G:/AIWORK/gushi/resources/poetry_index.db"
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
cur = con.cursor()

print("== 索引清单 ==")
for name, tbl, sql in cur.execute(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY tbl_name"
):
    print(f"  {tbl}.{name}: {sql}")
print("== 表清单 ==")
for (name,) in cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
    print(f"  {name}")
print("== sqlite_stat1 是否存在 ==")
row = cur.execute(
    "SELECT count(*) FROM sqlite_master WHERE name='sqlite_stat1'"
).fetchone()
print(f"  sqlite_stat1 表数：{row[0]}")


def t(label, sql, reps=1, params=None):
    best = None
    for _ in range(reps):
        s = time.perf_counter()
        cur.execute(sql, params or []).fetchall()
        e = time.perf_counter()
        ms = (e - s) * 1000
        best = ms if best is None else min(best, ms)
    print(f"  {label}: {best:.1f} ms")


print("== 侧边栏数据 ==")
t("dynasties (480)", "SELECT slug, name, poem_count, start_year, end_year FROM dynasties ORDER BY poem_count DESC", 1)
t("authors LIMIT 500 (387)", "SELECT slug, name, poem_count FROM authors ORDER BY poem_count DESC LIMIT ? OFFSET ?", 1, [500, 0])
t("tags (494)", "SELECT slug, name, poem_count FROM tags ORDER BY poem_count DESC", 1)
t("rhythmics (502)", "SELECT rhythmic AS name, COUNT(*) AS poem_count FROM poems WHERE rhythmic IS NOT NULL AND rhythmic != '' GROUP BY rhythmic ORDER BY poem_count DESC", 1)

print("== 统计类 ==")
t("COUNT(*) poems (651)", "SELECT COUNT(*) as c FROM poems", 1)
t("MAX(rowid) poems", "SELECT COALESCE(MAX(rowid), 0) AS c FROM poems", 1)
t("COUNT(*) authors (655)", "SELECT COUNT(*) as c FROM authors", 1)
t("COUNT(*) dynasties (659)", "SELECT COUNT(*) as c FROM dynasties", 1)

print("== 词牌分组：只取 TOP 12 是否更快 ==")
t("GROUP BY rhythmic LIMIT 12", "SELECT rhythmic AS name, COUNT(*) AS poem_count FROM poems WHERE rhythmic IS NOT NULL AND rhythmic != '' GROUP BY rhythmic ORDER BY poem_count DESC LIMIT 12", 1)
t("COUNT(*) rhythmic=? (523)", "SELECT COUNT(*) as c FROM poems WHERE rhythmic = ?", 1, ["浣溪沙"])

con.close()
