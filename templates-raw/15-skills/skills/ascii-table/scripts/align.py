#!/usr/bin/env python3
"""按东亚显示宽度对齐，生成 ASCII 表格。

用法: python3 align.py '<json>'
JSON 格式: {"header": ["列名", ...], "rows": [["值", ...], ...]}
"""
import json
import sys
import unicodedata


def width(s: str) -> int:
    """显示宽度：东亚宽字符（汉字/全角标点）记 2，其余记 1。"""
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in s)


def pad(s: str, w: int) -> str:
    return s + " " * (w - width(s))


def main() -> None:
    data = json.loads(sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read())
    header, rows = data["header"], data["rows"]
    cols = len(header)

    widths = [width(h) for h in header]
    for row in rows:
        for i in range(cols):
            widths[i] = max(widths[i], width(str(row[i])))

    sep = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    lines = [sep]
    lines.append("| " + " | ".join(pad(h, widths[i]) for i, h in enumerate(header)) + " |")
    lines.append(sep)
    for row in rows:
        lines.append("| " + " | ".join(pad(str(c), widths[i]) for i, c in enumerate(row)) + " |")
    lines.append(sep)

    print("\n".join(lines))


if __name__ == "__main__":
    main()
