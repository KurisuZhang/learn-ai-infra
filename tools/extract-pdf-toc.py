#!/usr/bin/env python3
"""把两本本地 PDF 的书签树导出成 data/toc/pdf-*.json

为什么要导出：手册里 PDF 资料映射写成「图解大模型 › 第3章 › 3.1.5 …（p102）」，
其中 p102 是 PDF 物理页序。浏览器原生 PDF 阅读器支持 `#page=N`，所以只要能把
「小节号/标题 → 物理页」查出来，就能生成精确跳页链接。

用法：python3 tools/extract-pdf-toc.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    import pymupdf  # type: ignore
except ImportError:  # 兼容旧版本 PyMuPDF
    import fitz as pymupdf  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "toc"

BOOKS = [
    {
        "id": "pdf-book",
        "file": "AI-Infra-Book.pdf",
        "title": "AI-Infra-Book",
        "subtitle": "《深入理解 AI Infra：量化分析与系统设计》",
    },
    {
        "id": "pdf-llm",
        "file": "图解大模型_生成式AI原理与实战_Jay_Alammar,_Maartey.pdf",
        "title": "图解大模型",
        "subtitle": "生成式 AI 原理与实战（Jay Alammar & Maarten Grootendorst）",
    },
]

NUMBER_RE = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,2}){0,3}|[A-Z]\.\d{1,2})\s")


def norm(text: str) -> str:
    """去掉编号与空白，用于标题比对。"""
    return NUMBER_RE.sub("", text).replace("\u3000", " ").strip()


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures = []
    for book in BOOKS:
        path = ROOT / book["file"]
        if not path.exists():
            failures.append(f"缺少文件：{path}")
            continue
        doc = pymupdf.open(path)
        entries = []
        for level, title, page in doc.get_toc(simple=True):
            title = title.replace("\u3000", " ").strip()
            number = ""
            match = NUMBER_RE.match(title)
            if match:
                number = match.group(1)
            entries.append(
                {
                    "level": level,
                    "title": title,
                    "number": number,
                    "clean": norm(title),
                    "page": page,
                }
            )
        payload = {
            "source": book["file"],
            "title": book["title"],
            "subtitle": book["subtitle"],
            "pageCount": doc.page_count,
            "bookmarks": len(entries),
            "entries": entries,
        }
        out = OUT_DIR / f"{book['id']}.json"
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"✔ {out.relative_to(ROOT)}（{payload['pageCount']} 页 / {payload['bookmarks']} 书签）")
        doc.close()

    if failures:
        for item in failures:
            print(f"✘ {item}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
