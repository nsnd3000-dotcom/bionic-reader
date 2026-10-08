"""字距对照实验：用真实字体度量，验证"加粗处的额外空白"是否被消除。

在浏览器的行内布局里，一个"重字"如果字体的 advance width 不变，
外框就会溢到相邻字的格里 —— 视觉上表现为锚点前后各多出一块空白。

本脚本用 Windows 自带的中文字体直接量：
  advance(常规字)  vs  advance(粗体字)
两者一旦不等，就会在行内累积成可见的缝隙。
"""
import os
from PIL import ImageFont

FONTS = [
    ("微软雅黑 msyh",  r"C:\Windows\Fonts\msyh.ttc"),
    ("微软雅黑 Bold",  r"C:\Windows\Fonts\msyhbd.ttc"),
    ("宋体 simsun",    r"C:\Windows\Fonts\simsun.ttc"),
    ("黑体 simhei",    r"C:\Windows\Fonts\simhei.ttf"),
]

SAMPLE = "暮地香蕉公司好似一阵旋风刮到这里在小镇中心扎下根来"

def has(p):
    return os.path.exists(p)

print("=" * 62)
print("A. 字体文件可用性")
for name, path in FONTS:
    print(f"  {'ok  ' if has(path) else 'MISS'} {name:<16} {path}")

print()
print("=" * 62)
print("B. 同一字体族内：常规 vs 粗体的字宽（advance width）")
print(f"   样本：{SAMPLE[:8]}…（{len(SAMPLE)} 字）")
print()
hdr = f"  {'字体':<18}{'常规总宽':>10}{'粗体总宽':>10}{'差值':>10}{'每字差':>10}"
print(hdr)
print("  " + "-" * 58)

for label, path in FONTS:
    if not has(path):
        continue
    try:
        reg = ImageFont.truetype(path, 40)
    except Exception as e:
        print(f"  {label:<18} 加载失败 {e}")
        continue
    # 用 variation / index 取粗体；取不到就退回同一文件
    bold = reg
    for boldpath in (r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if has(boldpath) and os.path.basename(boldpath).split('.')[0] in path.lower():
            bold = ImageFont.truetype(boldpath, 40)
            break
    wr = reg.getlength(SAMPLE)
    wb = bold.getlength(SAMPLE)
    print(f"  {label:<18}{wr:>10.2f}{wb:>10.2f}{wb - wr:>10.2f}{(wb - wr) / len(SAMPLE):>10.3f}")

print()
print("=" * 62)
print("C. 结论")
print("  若『每字差』≈ 0：加粗不会改变字宽，行内不会因为加粗而多出空白。")
print("  若『每字差』> 0.5px：每个加粗字都会推开邻字，整行累积成明显缝隙。")
