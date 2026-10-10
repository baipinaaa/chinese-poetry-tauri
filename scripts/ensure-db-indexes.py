#!/usr/bin/env python3
"""补齐 poetry_index.db 缺失的复合索引（纯标准库，CI 与本地都能跑）。

为什么要补：仓库 Release 里那份库建得较早，缺 (dynasty_slug, slug) 这类复合索引，
于是「同朝代」列表要先按 dynasty_slug 捞出 7~29 万行再整体排序 —— 实测宋 1852ms、
词牌列表 2800ms、词牌聚合 2412ms。补齐后分别降到 0.2ms / 0.3ms / 2.7ms，
用户看到的就是「打开应用 / 进诗详情要卡几秒」变成秒开。

顺带删掉 sqlite_stat1（ANALYZE 产物）：实测它会让优化器给这类查询选更差的计划。

用法：
    python scripts/ensure-db-indexes.py src-tauri/resources/poetry_index.db
    python scripts/ensure-db-indexes.py src-tauri/resources/poetry_index.db --check   # 只检查

结果写进 $GITHUB_OUTPUT 的 changed=true/false（有 GITHUB_OUTPUT 时），
退出码始终为 0：库是只读或补索引失败都不该让构建挂掉。
"""

import os
import sqlite3
import sys
import time

INDEXES = [
    (
        "idx_poems_dynasty_slug_slug",
        "CREATE INDEX IF NOT EXISTS idx_poems_dynasty_slug_slug ON poems(dynasty_slug, slug)",
    ),
    (
        "idx_poems_rhythmic_slug",
        "CREATE INDEX IF NOT EXISTS idx_poems_rhythmic_slug ON poems(rhythmic, slug)",
    ),
    (
        "idx_poems_author_slug_slug",
        "CREATE INDEX IF NOT EXISTS idx_poems_author_slug_slug ON poems(author_slug, slug)",
    ),
]

MIN_DB_BYTES = 1024 * 1024  # 小于 1MB 的是 fetch-db.mjs 写的 0 字节占位文件


def report(changed: bool, reason: str) -> None:
    print(f"[ensure-db-indexes] changed={'true' if changed else 'false'}：{reason}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"changed={'true' if changed else 'false'}\n")


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check_only = "--check" in sys.argv
    if not args:
        report(False, "未提供数据库路径，跳过")
        return 0

    path = args[0]
    if not os.path.isfile(path) or os.path.getsize(path) < MIN_DB_BYTES:
        report(False, f"库不存在或仍是占位文件（{path}），跳过")
        return 0

    con = sqlite3.connect(path)
    try:
        if not con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'poems'"
        ).fetchone()[0]:
            report(False, "不是诗词数据库（缺 poems 表），跳过")
            return 0

        before_mb = os.path.getsize(path) / 1024 / 1024
        missing = [
            (name, ddl)
            for name, ddl in INDEXES
            if not con.execute("SELECT count(*) FROM sqlite_master WHERE name = ?", [name]).fetchone()[0]
        ]
        has_stat1 = bool(
            con.execute("SELECT count(*) FROM sqlite_master WHERE name = 'sqlite_stat1'").fetchone()[0]
        )

        if check_only:
            report(bool(missing or has_stat1), f"缺索引 {[n for n, _ in missing]}，sqlite_stat1={has_stat1}")
            return 0

        created = []
        for name, ddl in missing:
            started = time.perf_counter()
            con.execute(ddl)
            con.commit()
            print(f"[ensure-db-indexes] 已建 {name}（{time.perf_counter() - started:.1f}s）")
            created.append(name)

        dropped = False
        if has_stat1:
            con.execute("DROP TABLE sqlite_stat1")
            con.commit()
            dropped = True
            print("[ensure-db-indexes] 已删除 sqlite_stat1（ANALYZE 统计会让部分查询变慢）")

        # VACUUM 不跑：500MB 的库要几分钟，而索引新增的页本来就是紧凑的
        after_mb = os.path.getsize(path) / 1024 / 1024
        if created or dropped:
            report(True, f"新建索引 {created or '无'}，库 {before_mb:.0f}MB → {after_mb:.0f}MB")
        else:
            report(False, f"索引已齐全（库 {after_mb:.0f}MB），无需改动")
    except Exception as error:  # noqa: BLE001 —— 构建不能因为补索引失败而中断
        report(False, f"补索引失败（忽略）：{error}")
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
