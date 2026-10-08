"""对比「font-size 放大」与「transform:scale 放大」的字距差异。

用真实字体度量模拟浏览器的行内布局：
  · font-size 放大 → 该字的 advance width 变大 → 右边所有字被推走
  · transform 放大 → advance width 不变 → 右边所有字原地不动

这张图是"为什么 120% 会炸"的可视化证明。
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def pick_font(size, bold=False):
    for c in ([r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"] if bold
              else [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simsun.ttc"]):
        if os.path.exists(c):
            try: return ImageFont.truetype(c, size)
            except Exception: pass
    return ImageFont.load_default()


TEXT = "仿生阅读是一种通过视觉引导提升阅读效率的排版方式"
# 锚点：仿、引、它、开、让、大、从、降 —— 与截图里的位置一致
ANCHORS = {0, 10, 17, 20, 24, 28, 33, 36}

WIDTH, PAD = 1180, 44
BG, INK, DIM, TINT = (251, 250, 247), (28, 27, 25), (150, 146, 138), (180, 83, 31)
FS, LH = 20, 40
ZOOM = 1.20


def advance(font, ch):
    """单个字的 advance width —— 浏览器排版时累加的就是这个值。"""
    return font.getlength(ch)


def render(d, y, mode, label, note):
    reg = pick_font(FS, False)
    zoomed = pick_font(int(round(FS * ZOOM)), True)
    bold = pick_font(FS, True)

    d.rectangle([PAD, y + 3, PAD + 3, y + 19], fill=TINT)
    d.text((PAD + 13, y), label, font=pick_font(14, True), fill=INK)
    tw = pick_font(14, True).getlength(label)
    d.text((PAD + 13 + tw + 12, y + 3), note, font=pick_font(12, False), fill=DIM)
    y += 34

    maxw = WIDTH - PAD * 2
    # 先按 advance 折行 —— 这一步两种模式必须完全一致，
    # 因为 transform 不参与布局，浏览器断行时看不到它。
    lines, cur, curw = [], [], 0.0
    for i, ch in enumerate(TEXT):
        w = advance(bold if i in ANCHORS else reg, ch)
        if curw + w > maxw and cur:
            lines.append(cur); cur, curw = [], 0.0
        cur.append((i, ch, w)); curw += w
    if cur: lines.append(cur)

    for ln in lines:
        x = PAD
        for i, ch, w in ln:
            if i in ANCHORS:
                if mode == 'font':
                    # font-size 放大：格子就是放大后的宽度，字形正好填满
                    d.text((x, y), ch, font=zoomed, fill=TINT)
                else:
                    # transform:scale：格子仍是原宽度，字形以格中心为原点画大
                    gw = advance(zoomed, ch)
                    off = (gw - w) / 2
                    d.text((x - off, y - (FS * ZOOM - FS) * 0.35), ch, font=zoomed, fill=TINT)
            else:
                d.text((x, y), ch, font=reg, fill=DIM)
            x += w          # ← 关键：两种模式推进量相同（都是原格子宽度）
        y += LH
    return y + 26


H = 30 + 2 * (34 + 4 * LH + 26) + 120
img = Image.new("RGB", (WIDTH, H), BG)
d = ImageDraw.Draw(img)

d.text((PAD, 16), "锚点放大 120% · 两种实现方式的字距差异", font=pick_font(21, True), fill=INK)
d.text((PAD, 50), "同一段文字、同一套锚点位置。注意「引」「让」「从」等字右侧的间距。", font=pick_font(13, False), fill=DIM)

y = 84
y = render(d, y, 'font', "font-size: 120%（旧实现）",
           "锚点的格子变宽 → 右边所有字被推开 → 每行结尾参差不齐")
y = render(d, y, 'transform', "transform: scale(1.2)（新实现）",
           "格子宽度不变 → 右边所有字原地不动 → 字距与正文完全一致")

# 说明区
ty = y + 12
notes = [
    "浏览器排版只累加每个字的「格子宽度」(advance width)。",
    "font-size 放大 → 格子变宽 → 推开邻字（这不是 bug，是放大字号的必然结果）。",
    "transform 是绘制后缩放，不参与布局 → 格子不变 → 邻字不动。",
    "代价：放大后的字形会轻微压到左右邻居，中文方块字有留白，120~160% 下几乎看不出。",
]
for i, t in enumerate(notes):
    d.text((PAD, ty + i * 22), "· " + t, font=pick_font(12.5, False), fill=INK)

out = os.path.join(ROOT, "preview-headzoom.png")
img.save(out)
print("saved:", out, img.size)
