"""RapidOCR 桥接：把图片 OCR 成带坐标的文本行。

为什么是 RapidOCR：
  - pip 可装，纯 ONNX 推理，不依赖 Windows 包身份 / WinRT 文件代理
    （Windows 自带 OCR 在这台机器上不可用，见 ocr/README-ocr.md 的记录）
  - 自带中英文检测+识别模型，首次运行会自动下载到用户目录

输出结构与 pdf-parser.js 的 `_rebuildRows` 输入对齐：
    [ { text, x, y, w, h, score } ]   y 已经翻成"从上到下递增"，方便直接聚行
"""

import sys
from pathlib import Path


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR()
    return _engine


def ocr_image(image_path):
    """对单张图片做 OCR。

    返回 [{'text','x','y','w','h','score','box'}]，按阅读顺序（上→下，左→右）排序。
    y 是该框中心的纵坐标（原图坐标系，原点在左上）。
    """
    engine = get_engine()
    result, _elapse = engine(str(image_path))
    if not result:
        return []

    rows = []
    for box, text, score in result:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        rows.append({
            'text': text,
            'x': round(x0, 1),
            'y': round((y0 + y1) / 2, 1),
            'w': round(x1 - x0, 1),
            'h': round(y1 - y0, 1),
            'score': round(float(score), 3),
            'box': [[round(p[0], 1), round(p[1], 1)] for p in box],
        })

    rows.sort(key=lambda r: (r['y'], r['x']))
    return rows


if __name__ == '__main__':
    p = sys.argv[1]
    rows = ocr_image(p)
    print(f'# {p}  识别出 {len(rows)} 个文本框')
    for r in rows[:35]:
        print(f"  y={r['y']:7.1f} x={r['x']:7.1f} h={r['h']:5.1f} s={r['score']:.2f}  {r['text']}")
