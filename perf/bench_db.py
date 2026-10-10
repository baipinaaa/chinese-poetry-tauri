"""实测 poetry_index.db 各类查询耗时，定位卡顿来源。"""
import os
import sqlite3
import time

DB = os.environ.get("POETRY_DB", r"G:/AIWORK/gushi/resources/poetry_index.db")


def ms(t0):
    return f"{(time.perf_counter() - t0) * 1000:.1f}ms"


def bench(conn, label, sql, params=(), repeat=3):
    times = []
    rows = []
    for _ in range(repeat):
        t0 = time.perf_counter()
        rows = conn.execute(sql, params).fetchall()
        times.append((time.perf_counter() - t0) * 1000)
    n = len(rows)
    size = 0
    for r in rows[:50]:
        for v in r:
            if isinstance(v, (str, bytes)):
                size += len(v)
    print(f"  {label:50s} rows={n:6d} first50_B={size:9d} best={min(times):8.1f}ms")
    return rows


print(f"DB: {DB}")
print(f"size = {os.path.getsize(DB) / 1024 / 1024:.1f} MB")
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

print("\n=== counts ===")
bench(conn, "COUNT(*) poems", "SELECT COUNT(*) FROM poems")
bench(conn, "COUNT(*) authors", "SELECT COUNT(*) FROM authors")

print("\n[样本]")
sample = conn.execute(
    "SELECT slug, LENGTH(paragraphs) plen, LENGTH(translation) tlen FROM poem_content "
    "ORDER BY LENGTH(paragraphs) DESC LIMIT 1"
).fetchone()
print(f"  最大 paragraphs: slug={sample['slug']} plen={sample['plen']} tlen={sample['tlen']}")
psample = conn.execute(
    "SELECT slug, title, author_slug, dynasty_slug FROM poems WHERE slug = ?", (sample["slug"],)
).fetchone()
print(f"  -> poem row: {dict(psample) if psample else None}")
aslug = conn.execute("SELECT author_slug FROM poems LIMIT 1").fetchone()[0]

print("\n[★ 启动 / 路由导航类]")
bench(conn, "SELECT * FROM authors LIMIT 100   <-- navigate()", "SELECT * FROM authors LIMIT 100")
bench(conn, "authors 轻字段 LIMIT 100", "SELECT slug,name,poem_count,birth_year,death_year FROM authors LIMIT 100")
bench(conn, "SELECT * FROM poems LIMIT 100    <-- navigate()", "SELECT * FROM poems LIMIT 100")
bench(conn, "poems 轻字段 LIMIT 100", "SELECT slug,title,author_slug,dynasty_slug FROM poems LIMIT 100")
bench(conn, "SELECT * FROM dynasties", "SELECT * FROM dynasties")
bench(conn, "SELECT * FROM tags", "SELECT * FROM tags")

print("\n[★ 详情页类]")
bench(conn, "poems WHERE slug (主表)", "SELECT * FROM poems WHERE slug = ?", (sample["slug"],))
bench(conn, "poem_content WHERE slug (含 BLOB)", "SELECT * FROM poem_content WHERE slug = ?", (sample["slug"],))
bench(conn, "poems JOIN authors WHERE slug", "SELECT p.*, a.name FROM poems p LEFT JOIN authors a ON a.slug=p.author_slug WHERE p.slug=?", (sample["slug"],))
bench(conn, "author by slug", "SELECT * FROM authors WHERE slug = ?", (aslug,))

print("\n[★ 列表页 / 分页]")
bench(conn, "poems LIMIT 20 OFFSET 0", "SELECT slug,title,author_slug,dynasty_slug FROM poems LIMIT 20 OFFSET 0")
bench(conn, "poems LIMIT 20 OFFSET 100000", "SELECT slug,title,author_slug,dynasty_slug FROM poems LIMIT 20 OFFSET 100000")
bench(conn, "authors LIMIT 20 OFFSET 1000", "SELECT slug,name FROM authors LIMIT 20 OFFSET 1000")

print("\n[★ 过滤 / 搜索]")
bench(conn, "DISTINCT dynasty_slug FROM poems", "SELECT DISTINCT dynasty_slug FROM poems")
bench(conn, "poems WHERE dynasty_slug=唐 LIMIT 20", "SELECT slug,title FROM poems WHERE dynasty_slug='tang' LIMIT 20")
bench(conn, "poems WHERE author_slug=? LIMIT 20", "SELECT slug,title FROM poems WHERE author_slug = ? LIMIT 20", (aslug,))
bench(conn, "LIKE title", "SELECT slug,title FROM poems WHERE title LIKE '%明月%' LIMIT 20")
try:
    bench(conn, "FTS5 match", "SELECT slug FROM poems_fts WHERE poems_fts MATCH ? LIMIT 20", ("明月",))
except Exception as e:
    print(f"  FTS err: {e}")

print("\n[★ BLOB 解码成本（若为 gzip）]")
import gzip
rows = conn.execute("SELECT paragraphs FROM poem_content WHERE slug = ?", (sample["slug"],)).fetchall()
blob = rows[0][0]
print(f"  blob type={type(blob)} len={len(blob) if blob else 0}")
if isinstance(blob, (bytes, bytearray)):
    print(f"  head bytes = {bytes(blob[:4]).hex()}")
    t0 = time.perf_counter()
    for _ in range(5):
        gzip.decompress(blob)
    print(f"  gzip.decompress x5 best={ms(t0)}")

conn.close()
