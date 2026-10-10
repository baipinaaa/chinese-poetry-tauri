"""第二轮基准：定位 count(*)/GROUP BY/拼音之外的真实开销。"""
import os
import sqlite3
import time

DB = os.environ.get("POETRY_DB", r"G:/AIWORK/gushi/resources/poetry_index.db")


def bench(conn, label, sql, params=(), repeat=3):
    times = []
    rows = []
    for _ in range(repeat):
        t0 = time.perf_counter()
        rows = conn.execute(sql, params).fetchall()
        times.append((time.perf_counter() - t0) * 1000)
    print(f"  {label:46s} rows={len(rows):6d} best={min(times):8.1f}ms")
    return rows


conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

print("=== 计数替代方案（当前 count(*) 423ms）===")
bench(conn, "COUNT(*) FROM poems", "SELECT COUNT(*) FROM poems")
bench(conn, "MAX(rowid) FROM poems", "SELECT MAX(rowid) FROM poems")
for t in ("poem_content", "poem_tags", "poems_fts_docsize"):
    try:
        bench(conn, f"COUNT(*) FROM {t}", f"SELECT COUNT(*) FROM {t}")
    except Exception as e:
        print(f"  {t}: {e}")
bench(conn, "COUNT(*) FROM poems_fts", "SELECT COUNT(*) FROM poems_fts")

print("\n=== 侧边栏 / 启动 ===")
bench(conn, "getRhythmics: GROUP BY rhythmic", "SELECT rhythmic AS name, COUNT(*) AS c FROM poems WHERE rhythmic IS NOT NULL AND rhythmic!='' GROUP BY rhythmic ORDER BY c DESC")
bench(conn, "getAuthors(0,500) 排序", "SELECT slug,name,poem_count FROM authors ORDER BY poem_count DESC LIMIT 500 OFFSET 0")
bench(conn, "getAuthors(0,10000)", "SELECT slug,name,poem_count FROM authors ORDER BY poem_count DESC LIMIT 10000 OFFSET 0")
bench(conn, "getDynasties", "SELECT slug,name,poem_count,start_year,end_year FROM dynasties ORDER BY poem_count DESC")
bench(conn, "getTags", "SELECT slug,name,poem_count FROM tags ORDER BY poem_count DESC")

print("\n=== 详情页实际 SQL（含 JOIN）===")
slug = conn.execute("SELECT slug FROM poems ORDER BY LENGTH(slug) DESC LIMIT 1").fetchone()[0]
bench(conn, "poem+author+dynasty JOIN by slug",
      "SELECT p.slug,p.title,p.author_slug,p.dynasty_slug,p.rhythmic,p.excerpt,a.name author_name,d.name dynasty_name "
      "FROM poems p JOIN authors a ON p.author_slug=a.slug JOIN dynasties d ON p.dynasty_slug=d.slug WHERE p.slug=?", (slug,))
bench(conn, "poem_content 4 BLOB by slug",
      "SELECT paragraphs,translation,appreciation,annotation FROM poem_content WHERE slug=?", (slug,))
bench(conn, "poem_tags JOIN tags by slug",
      "SELECT t.name FROM poem_tags pt JOIN tags t ON pt.tag_slug=t.slug WHERE pt.poem_slug=?", (slug,))
print("  --- 含译文的长诗（最坏情况）---")
rich = conn.execute(
    "SELECT slug FROM poem_content WHERE translation IS NOT NULL ORDER BY LENGTH(translation)+LENGTH(paragraphs) DESC LIMIT 1"
).fetchone()
if rich:
    s = rich[0]
    bench(conn, f"content(全部 BLOB) [{s[:22]}]", "SELECT paragraphs,translation,appreciation,annotation,background FROM poem_content WHERE slug=?", (s,))

print("\n=== FTS 搜索 ===")
for q in ("明月", "静夜思", "李白"):
    toks = [c for c in q] + [q[i] + q[i + 1] for i in range(len(q) - 1)]
    match = " AND ".join(f'"{t}"' for t in toks)
    try:
        bench(conn, f"FTS MATCH {q!r}", "SELECT rowid FROM poems_fts WHERE poems_fts MATCH ? LIMIT 20", (match,))
        bench(conn, f"FTS COUNT {q!r}", "SELECT COUNT(*) FROM poems_fts WHERE poems_fts MATCH ?", (match,))
    except Exception as e:
        print(f"  {q}: {e}")
bench(conn, "LIKE 标题(慢路径)", "SELECT slug FROM poems WHERE title LIKE '%明月%' LIMIT 20")

print("\n=== ORDER BY slug 分页（列表页）===")
for off in (0, 1000, 50000, 200000):
    bench(conn, f"poems ORDER BY slug LIMIT 20 OFFSET {off}",
          "SELECT p.slug,p.title,p.author_slug,p.dynasty_slug,p.rhythmic,p.excerpt,a.name author_name,d.name dynasty_name "
          "FROM poems p JOIN authors a ON p.author_slug=a.slug JOIN dynasties d ON p.dynasty_slug=d.slug "
          "ORDER BY p.slug LIMIT 20 OFFSET ?", (off,))

print("\n=== 随机 ===")
bench(conn, "ORDER BY RANDOM() LIMIT 10 (全表)", "SELECT slug FROM poems ORDER BY RANDOM() LIMIT 10")
bench(conn, "has_content=1 ORDER BY RANDOM() LIMIT 10", "SELECT slug FROM poems WHERE has_content=1 ORDER BY RANDOM() LIMIT 10")
bench(conn, "COUNT(*) has_content=1", "SELECT COUNT(*) FROM poems WHERE has_content=1")

conn.close()
