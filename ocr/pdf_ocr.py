"""扫描件 PDF → 带文字层的 PDF（OCR 桥接）。

用途：bionic-reader 只能读"有文字层"的 PDF。扫描件（每页一张图）读不了，
      用这个脚本先 OCR 一遍，生成一个**视觉上与原书完全一致、但每页多了
      透明文字层**的新 PDF。之后直接把这个新 PDF 拖进阅读器即可。

为什么是"加文字层"而不是"导出 TXT"：
  - 保留原书页面（扫描图），可以对照原版式
  - 生成的 PDF 用任何阅读器都能选中/搜索文字，不局限于本项目
  - 中文丢字、错字时还能对着原图看，不至于无从核对

用法：
    python pdf_ocr.py <输入.pdf> [-o 输出.pdf] [--dpi 300] [--pages 1-20]
                       [--lang ch] [--workers 4]

依赖：pymupdf、rapidocr-onnxruntime、Pillow（见 requirements-ocr.txt）
"""

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pymupdf

# RapidOCR 的 onnxruntime 会自己开满 CPU 线程；再叠加多进程会过度订阅。
# 默认用**线程池**而不是进程池，原因有两个：
#   1. 本沙箱禁止创建命名管道，multiprocessing 直接 PermissionError
#   2. onnxruntime 推理本身会释放 GIL，线程池的并行度在实际场景里够用
os.environ.setdefault('OMP_NUM_THREADS', '2')


def _render_one(args):
    """子进程任务：渲染单页为 PNG，返回 (页码, png字节, 宽, 高, dpi)"""
    pdf_path, page_index, dpi = args
    doc = pymupdf.open(pdf_path)
    try:
        page = doc.load_page(page_index)
        zoom = dpi / 72.0
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        return page_index, pix.tobytes('png'), pix.width, pix.height, dpi
    finally:
        doc.close()


def _ocr_one(args):
    """子进程任务：OCR 一张 PNG，返回 (页码, 行列表, 宽, 高)"""
    page_index, png_bytes, w, h, dpi = args
    # 延迟导入：子进程里才加载模型，避免主进程白白吃内存
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from rapidocr import ocr_image

    tmp = Path(__file__).resolve().parent / '.ocr-tmp'
    tmp.mkdir(exist_ok=True)
    png_path = tmp / f'p{page_index + 1:05d}.png'
    png_path.write_bytes(png_bytes)
    try:
        rows = ocr_image(png_path)
    finally:
        try:
            png_path.unlink()
        except OSError:
            pass
    return page_index, rows, w, h


def _group_rows_to_lines(rows, y_tol_ratio=0.6):
    """把 OCR 的文本框按 y 聚成"行"，再按 x 排序拼成整行文字。

    RapidOCR 对中文常常把**一行正文切成好几个框**（换行处、标点处断），
    所以必须先聚行；否则写进 PDF 的文字层会是一段段碎的。
    """
    if not rows:
        return []

    # 按 y 排序后线性扫描聚类
    rows = sorted(rows, key=lambda r: (r['y'], r['x']))
    clusters = []
    for r in rows:
        placed = False
        for c in clusters:
            # 用行高的一半作为容差，比固定值稳
            tol = max(r['h'], c['h']) * y_tol_ratio * 0.5
            if abs(r['y'] - c['y']) <= tol:
                c['items'].append(r)
                c['h'] = max(c['h'], r['h'])
                c['y'] = sum(i['y'] for i in c['items']) / len(c['items'])
                placed = True
                break
        if not placed:
            clusters.append({'y': r['y'], 'h': r['h'], 'items': [r]})

    clusters.sort(key=lambda c: c['y'])
    lines = []
    for c in clusters:
        items = sorted(c['items'], key=lambda i: i['x'])
        # 同一行内按间距决定要不要补空格（中文不补）
        text = ''
        prev = None
        for it in items:
            if prev is not None:
                gap = it['x'] - (prev['x'] + prev['w'])
                a, b = prev['text'][-1:], it['text'][:1]
                cjk = lambda ch: bool(ch) and (
                    '\u3000' <= ch <= '\u303f' or '\u3040' <= ch <= '\u30ff'
                    or '\u4e00' <= ch <= '\u9fff' or '\uff00' <= ch <= '\uffef')
                if gap > c['h'] * 0.25 and not cjk(a) and not cjk(b):
                    text += ' '
            text += it['text']
            prev = it
        if not text.strip():
            continue
        lines.append({
            'text': text.strip(),
            'x0': min(i['x'] for i in items),
            'x1': max(i['x'] + i['w'] for i in items),
            'y': c['y'],
            'h': c['h'],
            'score': sum(i['score'] for i in items) / len(items),
        })
    return lines


def _merge_lines_to_paragraphs(lines, page_w):
    """把行合并成段落，返回 [{text, x, y0, y1, size}]。

    判据（与前端 pdf-parser.js 保持一致，但这里是为了写文字层，
    所以**不做断词还原**——文字层要贴合原图，逐行写更稳）：
      - 行间距突然变大 → 新段
      - 行首缩进（x 明显大于正文左边距）→ 新段
      - 上一行以句末标点结尾 → 新段
    """
    if not lines:
        return []

    xs = sorted(round(l['x0']) for l in lines)
    # 正文左边距 = 出现最多的 x0
    from collections import Counter
    body_left = Counter(xs).most_common(1)[0][0]
    sizes = Counter(round(l['h']) for l in lines)
    body_size = sizes.most_common(1)[0][0]

    paras = []
    buf = []
    for i, l in enumerate(lines):
        new_para = False
        if buf:
            prev = lines[i - 1]
            gap = l['y'] - prev['y']
            if gap > body_size * 2.0:
                new_para = True
            elif l['x0'] - body_left > body_size * 0.8:
                new_para = True
            elif prev['text'][-1:] in '。！？；：”』）)':
                new_para = True
            elif l['h'] > body_size * 1.2 or l['h'] < body_size * 0.82:
                new_para = True
        if new_para:
            paras.append(buf)
            buf = []
        buf.append(l)
    if buf:
        paras.append(buf)

    out = []
    for p in paras:
        out.append({
            'text': ''.join(x['text'] for x in p),
            'x0': min(x['x0'] for x in p),
            'x1': max(x['x1'] for x in p),
            'y0': min(x['y'] - x['h'] / 2 for x in p),
            'y1': max(x['y'] + x['h'] / 2 for x in p),
            'size': sum(x['h'] for x in p) / len(p),
            'score': sum(x['score'] for x in p) / len(p),
            'lines': p,
        })
    return out


def _pick_cjk_font():
    """选一个能写中文的字体文件（pymupdf 内置的 CJK 字体优先）。

    pymupdf 自带 'china-s'（简体）等内置 CJK 字体，用 `fontname=` 直接引用，
    不需要外部 ttf，也不受沙箱限制。
    """
    for name in ('china-s', 'china-ss', 'japan', 'korea'):
        try:
            if pymupdf.Font(fontname=name):
                return name
        except Exception:
            continue
    return None


def ocr_pdf(src_pdf, out_pdf, dpi=300, pages=None, workers=4, lang='ch', progress=True):
    """主流程：逐页渲染 → OCR → 写回文字层 → 输出新 PDF。"""
    src_pdf = str(src_pdf)
    doc = pymupdf.open(src_pdf)
    total = doc.page_count
    doc.close()

    targets = list(range(total)) if pages is None else [p - 1 for p in pages if 1 <= p <= total]
    if not targets:
        raise SystemExit('没有要处理的页面')

    if workers <= 1 or len(targets) < 2:
        rendered = [_render_one((src_pdf, i, dpi)) for i in targets]
        ocr_results = []
        for j, item in enumerate(rendered):
            if progress:
                print(f'  OCR {j + 1}/{len(rendered)} …', flush=True)
            ocr_results.append(_ocr_one(item))
    else:
        if progress:
            print(f'  渲染 {len(targets)} 页 @ {dpi}dpi（{workers} 线程）…', flush=True)
        rendered = [None] * len(targets)
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(_render_one, (src_pdf, i, dpi)): k
                    for k, i in enumerate(targets)}
            done = 0
            for f in as_completed(futs):
                k = futs[f]
                rendered[k] = f.result()
                done += 1
                if progress and done % 5 == 0:
                    print(f'    渲染 {done}/{len(targets)}', flush=True)

        if progress:
            print(f'  OCR {len(targets)} 页（{workers} 线程）…', flush=True)
        ocr_results = [None] * len(targets)
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(_ocr_one, item): k for k, item in enumerate(rendered)}
            done = 0
            for f in as_completed(futs):
                k = futs[f]
                ocr_results[k] = f.result()
                done += 1
                if progress:
                    pi, rows, w, h = ocr_results[k]
                    print(f'    OCR {done}/{len(targets)}  第{pi + 1}页 {len(rows)}框', flush=True)

    # 写文字层：保留原页面（扫描图），用 insert_text 叠加不可见文字
    doc = pymupdf.open(src_pdf)
    fontname = _pick_cjk_font()
    if progress:
        print(f'  写入文字层（CJK 字体：{fontname}）…', flush=True)

    stats = []
    for pi, rows, w, h in ocr_results:
        page = doc.load_page(pi)
        # OCR 图上的像素坐标 → PDF 点坐标
        scale = 72.0 / dpi
        lines = _group_rows_to_lines(rows)
        paras = _merge_lines_to_paragraphs(lines, w)

        # 每页统一字号。
        # ★ 关键：字号必须**逐页取一个代表值**，不能按每段框高各自算。
        #   OCR 框的高度随"这段有几行"而变（单行框 vs 三行框差很多），
        #   按框高算出来的字号会散成 13.5/15.0/15.2/16.9… 一大串。
        #   后果不只是难看：前端 pdf-parser.js 靠"字号是否明显不同"
        #   判断标题，字号一散，整页正文就会被误判成一堆标题
        #   （实测第 45 页 210 字全部被标成 h3）。
        #   这里取页内行高的**中位数**作为全页字号 —— 中位数对
        #   "标题行特别大 / 页脚特别小"这类离群值不敏感。
        line_h = sorted(l['h'] for l in lines if l['h'] > 0)
        if line_h:
            page_size = line_h[len(line_h) // 2] * scale * 0.95
        else:
            page_size = 10.0
        page_size = max(4.0, min(page_size, 40.0))

        written = 0
        for para in paras:
            text = para['text']
            if not text.strip():
                continue
            x = para['x0'] * scale
            # y1 是"框底"，PDF 的基线约在框底往上 1/4 字高处
            y = para['y1'] * scale
            try:
                page.insert_text(
                    pymupdf.Point(x, y),
                    text,
                    fontname=fontname,
                    fontsize=page_size,
                    render_mode=3,      # 3 = 不可见（只供检索/选择，不影响观感）
                    overlay=True,
                )
                written += 1
            except Exception as e:
                if progress:
                    print(f'    第{pi + 1}页写入失败：{e}', flush=True)
        stats.append((pi + 1, len(rows), len(paras), written))

    doc.save(out_pdf, garbage=3, deflate=True)
    doc.close()

    if progress:
        tot_boxes = sum(s[1] for s in stats)
        tot_para = sum(s[3] for s in stats)
        print(f'  完成：{len(stats)} 页，{tot_boxes} 个文本框 → {tot_para} 段文字层')
    return stats


def main():
    ap = argparse.ArgumentParser(description='扫描件 PDF → 带文字层 PDF（OCR）')
    ap.add_argument('input', help='输入 PDF')
    ap.add_argument('-o', '--output', help='输出 PDF（默认 <输入名>.ocr.pdf）')
    ap.add_argument('--dpi', type=int, default=300, help='渲染 DPI（默认 300）')
    ap.add_argument('--pages', help='只处理这些页，如 1-20 或 1,5,9')
    ap.add_argument('--workers', type=int, default=4, help='并行进程数（默认 4）')
    args = ap.parse_args()

    src = Path(args.input)
    if not src.exists():
        raise SystemExit(f'找不到文件：{src}')
    out = Path(args.output) if args.output else src.with_suffix('.ocr.pdf')

    pages = None
    if args.pages:
        pages = []
        for part in args.pages.split(','):
            part = part.strip()
            if '-' in part:
                a, b = part.split('-', 1)
                pages.extend(range(int(a), int(b) + 1))
            elif part:
                pages.append(int(part))

    t0 = time.time()
    print(f'输入：{src}')
    print(f'输出：{out}')
    ocr_pdf(src, out, dpi=args.dpi, pages=pages, workers=args.workers)
    print(f'耗时 {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
