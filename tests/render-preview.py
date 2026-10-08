"""用真实的分词结果渲染仿生阅读效果预览图（展示锚点字号与颜色可调）。"""
import json, subprocess, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# 1. 用真实算法导出分词结果
JS = r'''
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const html = readFileSync("../index.html","utf8");
const m = html.match(/<script>\s*\/\* =+\s*\n\s*Bionic Reader[\s\S]*?\n<\/script>/);
let code = m[0].replace(/^<script>/,"").replace(/<\/script>$/,"");
code = code.replace(/document\.readyState === 'loading'[\s\S]*$/,"").replace(/\}\)\(\);\s*$/,"").replace(/^\s*\(\(\)\s*=>\s*\{/,"");
code += "\nglobalThis.__T={bionicFragment};\n})();\n";
const dom = new JSDOM("<!DOCTYPE html><body></body>");
globalThis.window=dom.window; globalThis.document=dom.window.document;
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
new Function(code)();
const T = globalThis.__T;
const segsOf = (text, strength) => {
  const frag = T.bionicFragment(text, strength, document);
  const segs = [];
  const walk = n => {
    if (n.nodeType === 3) { if (n.nodeValue) segs.push({t:n.nodeValue, b:false}); return; }
    if (n.nodeType === 1) { segs.push({t:n.textContent, b:n.className.includes("br-head")}); return; }
    for (const c of n.childNodes) walk(c);
  };
  for (const c of frag.childNodes) walk(c);
  return segs;
};
console.log(JSON.stringify({
  cn:   segsOf("仿生阅读是把每个词开头的几个字母加粗或改色，帮助视线在密集文本上抓住锚点。", 3),
  en:   segsOf("Bionic reading anchors your eyes to the first letters of every word.", 3),
}));
'''
open(os.path.join(HERE, "_dump3.mjs"), "w", encoding="utf8").write(JS)
env = dict(os.environ, PYTHONIOENCODING="utf-8")
r = subprocess.run(["node", "_dump3.mjs"], capture_output=True, cwd=HERE, env=env)
data = json.loads(r.stdout.decode("utf-8"))

def pick_font(size, bold=False):
    cands = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf" if bold else r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\segoeui.ttf",
    ]
    for c in cands:
        if os.path.exists(c):
            try: return ImageFont.truetype(c, size)
            except Exception: continue
    return ImageFont.load_default()

WIDTH = 1180
PAD = 40
BG = (251, 250, 247)
INK = (28, 27, 25)
DIM = (160, 156, 148)
# 调色板
TINTS = [("#b4531f", (180,83,31)), ("#1f5fb4", (31,95,180)),
         ("#1f8a5b", (31,138,91)), ("#8a1fb4", (138,31,180))]

FS = 20
img_h = 0
rows = []

def layout(segs, maxw, base_size, head_ratio, tail_color):
    """返回 (绘制指令, 行高总计)"""
    reg = pick_font(base_size, False)
    hsz = max(8, int(round(base_size * head_ratio)))
    bld = pick_font(hsz, True)
    base_reg = pick_font(base_size, False)
    lh = max(34, int(base_size * 1.75))
    lines, cur, curw = [], [], 0.0
    for s in segs:
        f = bld if s["b"] else reg
        w = f.getlength(s["t"])
        if curw + w > maxw and cur:
            lines.append(cur); cur, curw = [], 0.0
        cur.append((s["t"], s["b"], w, hsz if s["b"] else base_size))
        curw += w
    if cur: lines.append(cur)
    return lines, lh

# ---------- 准备四组对比 ----------
scenarios = [
    ("锚点字号 100%（默认）", 100, "#b4531f", "跟随正文大小，仅加粗 + 变色"),
    ("锚点字号 140%（放大）", 140, "#b4531f", "首字母明显放大，视觉入口更强"),
    ("锚点字号 200%（很大）", 200, "#1f5fb4", "锚点非常醒目，适合重度注意力困难"),
    ("锚点颜色 · 绿色", 100, "#1f8a5b", "只改颜色，字号不变"),
]

content_w = WIDTH - PAD * 2
blocks = []
for title, ratio, tint, note in scenarios:
    lines_cn, lh = layout(data["cn"], content_w, FS, ratio / 100.0, tint)
    lines_en, _ = layout(data["en"], content_w, FS, ratio / 100.0, tint)
    blocks.append((title, note, tint, ratio, lines_cn, lines_en, lh))

title_h = 86
sec_gap = 26
body_h = sum(len(b[4]) * b[6] + len(b[5]) * b[6] + 44 + sec_gap for b in blocks)
H = title_h + body_h + 40

img = Image.new("RGB", (WIDTH, H), BG)
d = ImageDraw.Draw(img)

d.text((PAD, 26), "Bionic Reading · 锚点字号与颜色", font=pick_font(25, True), fill=INK)
d.text((PAD, 60), "每个词开头被突出的那几个字 —— 大小与颜色都可以调", font=pick_font(13, False), fill=DIM)

y = title_h
for title, note, tint, ratio, lines_cn, lines_en, lh in blocks:
    rgb = tuple(int(tint[i:i+2], 16) for i in (1, 3, 5))
    # 小标题
    d.rectangle([PAD, y + 4, PAD + 3, y + 20], fill=rgb)
    d.text((PAD + 12, y + 2), title, font=pick_font(14, True), fill=INK)
    tw = pick_font(14, True).getlength(title)
    d.text((PAD + 12 + tw + 12, y + 4), note, font=pick_font(12, False), fill=DIM)
    y += 32

    for lines, base_size in ((lines_cn, FS), (lines_en, FS)):
        for ln in lines:
            x = PAD
            base_y = y
            for text, is_head, w, fsz in ln:
                if is_head:
                    f = pick_font(fsz, True)
                    # 放大时基线对齐，让锚点向上生长
                    d.text((x, base_y - (fsz - base_size)), text, font=f, fill=rgb)
                else:
                    f = pick_font(fsz, False)
                    d.text((x, base_y), text, font=f, fill=DIM)
                x += w
            y += lh
    y += sec_gap

out = os.path.join(ROOT, "preview-bionic.png")
img.save(out)
print("saved:", out, img.size)
