import sqlite3

DB = r"G:/AIWORK/gushi/resources/poetry_index.db"
c = sqlite3.connect(DB)
print("=== 所有对象 DDL ===")
for name, typ, sql in c.execute(
    "SELECT name, type, sql FROM sqlite_master ORDER BY type DESC, name"
):
    print(f"--- [{typ}] {name}")
    if sql:
        print("   ", sql.replace("\n", "\n    "))
print("\n=== 行数（用 sqlite_stat1 若存在）===")
try:
    for r in c.execute("SELECT tbl, idx, stat FROM sqlite_stat1 ORDER BY tbl"):
        print("   ", r)
except Exception as e:
    print("   无 sqlite_stat1:", e)
print("\n=== MAX(rowid) vs COUNT(*) ===")
print("   MAX(rowid) =", c.execute("SELECT MAX(rowid) FROM poems").fetchone()[0])
c.close()
