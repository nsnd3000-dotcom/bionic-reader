"""把扫描件 PDF 渲染成 PNG，供 OCR 使用。

依赖 pymupdf（`python -m pip install pymupdf`）。渲染 DPI 越高 OCR 越准，
但耗时线性增长；中文扫描书稿 200~300 DPI 是常见甜点。

注意：pymupdf 1.24+ 的正式入口是 `import pymupdf`；
老代码里的 `import fitz` 在部分安装形态下会解析到一个**空的命名空间包**，
表现为 `module 'fitz' has no attribute 'open'` —— 所以这里只用 `pymupdf`。
"""

import sys
from pathlib import Path

import pymupdf


def render_pages(pdf_path, out_dir, dpi=300, pages=None, fmt='png'):
    """把 PDF 每页渲染成图片，返回 [(页码(从1起), 图片路径), ...]"""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = pymupdf.open(pdf_path)
    zoom = dpi / 72.0
    mat = pymupdf.Matrix(zoom, zoom)

    targets = range(doc.page_count) if pages is None else [p - 1 for p in pages]
    results = []
    for i in targets:
        if i < 0 or i >= doc.page_count:
            continue
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        path = out_dir / f'page-{i + 1:04d}.{fmt}'
        pix.save(str(path))
        results.append((i + 1, path))
    doc.close()
    return results


if __name__ == '__main__':
    pdf = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else 'rendered'
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 300
    pages = [int(x) for x in sys.argv[4].split(',')] if len(sys.argv) > 4 else None
    res = render_pages(pdf, outdir, dpi, pages)
    print(f'渲染 {len(res)} 页 → {outdir}')
    for p, path in res[:5]:
        print(' ', p, path, path.stat().st_size, 'bytes')
