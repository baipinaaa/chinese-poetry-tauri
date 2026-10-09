"""流式 JSON 读取工具（无第三方依赖，CI 与本地都能跑）。

本仓库数据源实测有四种格式，全部用一个 generator 覆盖：
  1. 单行大 JSON 数组     —— gushiwen.json.gz（解压后约 250MB 全在一行）
  2. 每行一条、带尾逗号的数组 —— poems-db-master/poems*.json
  3. 标准 JSONL（每行一个对象） —— chinese-gushiwen-master/guwen/*.json、writer/*.json
  4. 上述格式的 gz 压缩版

原理：用 json.JSONDecoder.raw_decode 在滑动缓冲上逐条解码。缓冲只在成功解出一条记录后
才前移，所以跨块（chunk）边界的记录会被自动拼接。找不到 '}' 就继续读下一块；读到
文件末尾仍无法解码才报错。
"""
from __future__ import annotations

import gzip
import json
from typing import Any, Dict, Iterator, Optional

CHUNK = 1 << 20


def iter_json_records(path: str, compressed: bool = False) -> Iterator[Dict[str, Any]]:
    """逐条 yield JSON 对象（dict）。"""
    decoder = json.JSONDecoder()
    opener = gzip.open if compressed else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as fh:
        buf = ""
        pos = 0
        eof = False
        while not eof:
            chunk = fh.read(CHUNK)
            if not chunk:
                eof = True
            buf = buf[pos:] + chunk
            pos = 0
            while True:
                idx = buf.find("{", pos)
                if idx < 0 or idx >= len(buf):
                    pos = len(buf)
                    break
                try:
                    obj, end = decoder.raw_decode(buf, idx)
                except ValueError:
                    # 数据不完整（或该 '{' 不是对象起点）：保留，等下一块
                    if eof:
                        tail = buf[idx : idx + 120].replace("\n", " ")
                        raise ValueError(f"{path}: 尾部无法解析的 JSON 片段: {tail!r}")
                    pos = idx
                    break
                if isinstance(obj, dict):
                    yield obj
                pos = end
