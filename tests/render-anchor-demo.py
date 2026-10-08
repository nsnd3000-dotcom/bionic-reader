"""渲染"锚点修复前后"对比图 —— 用截图里的真实文本与真实算法输出。

重点展示这次修复的两件事：
  A. 锚点密度与位置：修复前是"每 7 字机械打点 + 标点后 + 词尾"，
     修复后改为"每个语义小句开头一个锚点"。
  B. 锚点占位：修复前每个锚点都会把邻字推开（加粗字形更宽），
     修复后锚点只圈一个字、字距与正文完全一致。
"""
import json, subprocess, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ---------- 1. 取真实算法输出 ----------
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
// 用户截图里的那段《枯枝败叶》
const TEXT = "暮地，香蕉公司好似一阵旋风刮到这里，在小镇中心扎下根来。尾随其后的是“枯枝败叶”，一堆由其他地方的人类渣滓和物质垃圾组成的杂乱、喧嚣的“枯枝败叶”。这是那场越来越遥远、越来越令人难以置信的内战的遗物。";
console.log(JSON.stringify({ text: TEXT, now: segsOf(TEXT, 3) }));
'''
open(os.path.join(HERE, "_dump_anchor.mjs"), "w", encoding="utf8").write(JS)
env = dict(os.environ, PYTHONIOENCODING="utf-8")
r = subprocess.run(["node", "_dump_anchor.mjs"], capture_output=True, cwd=HERE, env=env)
if r.returncode != 0:
    raise SystemExit("node 失败: " + r.stderr.decode("utf-8", "replace"))
data = json.loads(r.stdout.decode("utf-8"))
TEXT, NOW = data["text"], data["now"]


def pick_font(size, bold=False):
    for c in ([r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"] if bold
              else [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simsun.ttc"]):
        if os.path.exists(c):
            try: return ImageFont.truetype(c, size)
            except Exception: pass
    return ImageFont.load_default()


# ---------- 2. 重建"修复前"的锚点分布 ----------
# 旧算法：段首 + 每个标点之后 + 距上次锚点超过 7 个汉字就补一个。
# 这段代码照抄旧实现，只为出对比图，不参与线上逻辑。
LEGACY_PUNCT = set("。！？；：，、…—～·「」『』（）〔〕【】《》〈〉“”‘’") | set(".!?;:,\"')]}")
LEGACY_STRIDE = 7

def legacy_anchors(text):
    a, since, after = set(), 10**9, True
    for i, ch in enumerate(text):
        if ch in " \t\u3000":
            continue
        if ch in LEGACY_PUNCT:
            after = True
            continue
        if "\u4e00" <= ch <= "\u9fff":
            if after or since >= LEGACY_STRIDE:
                a.add(i); since = 0
            else:
                since += 1
            after = False
        else:
            after = False; since += 1
    return a

OLD_IDX = legacy_anchors(TEXT)
OLD = [{"t": TEXT[i], "b": i in OLD_IDX} for i in range(len(TEXT))]


def merge(segs):
    out = []
    for s in segs:
        if not s["t"]: continue
        if out and out[-1]["b"] == s["b"]: out[-1]["t"] += s["t"]
        else: out.append({"t": s["t"], "b": s["b"]})
    return out

OLD = merge(OLD)
NOW = merge(NOW)

# ---------- 3. 绘制 ----------
WIDTH, PAD = 1180, 44
BG, INK, DIM = (251, 250, 247), (28, 27, 25), (150, 146, 138)
TINT = (180, 83, 31)
FS, LH = 20, 38

def render(d, y, segs, tint, label, note, head_ratio=1.0):
    reg = pick_font(FS, False)
    hsz = max(8, int(round(FS * head_ratio)))
    bld = pick_font(hsz, True)
    maxw = WIDTH - PAD * 2

    d.rectangle([PAD, y + 3, PAD + 3, y + 19], fill=tint)
    d.text((PAD + 13, y), label, font=pick_font(14, True), fill=INK)
    tw = pick_font(14, True).getlength(label)
    d.text((PAD + 13 + tw + 12, y + 3), note, font=pick_font(12, False), fill=DIM)
    y += 32

    # 折行（按真实 advance width 累加）
    lines, cur, curw = [], [], 0.0
    for s in segs:
        f = bld if s["b"] else reg
        w = f.getlength(s["t"])
        if curw + w > maxw and cur:
            lines.append(cur); cur, curw = [], 0.0
        cur.append((s["t"], s["b"], w)); curw += w
    if cur: lines.append(cur)

    for ln in lines:
        x = PAD
        for t, is_head, w in ln:
            if is_head:
                # 放大时基线对齐（锚点向上生长）
                d.text((x, y - (hsz - FS)), t, font=bld, fill=tint)
            else:
                d.text((x, y), t, font=reg, fill=DIM)
            x += w
        y += LH + max(0, hsz - FS) // 2
    return y + 26


H = 30 + (32 + 7 * LH + 26) * 2 + 40
img = Image.new("RGB", (WIDTH, H), BG)
d = ImageDraw.Draw(img)

d.text((PAD, 18), "锚点算法 · 修复前后对比", font=pick_font(23, True), fill=INK)
d.text((PAD, 52), "同一段文字（《枯枝败叶》），同一套字号与行高", font=pick_font(13, False), fill=DIM)

y = 88
y = render(d, y, OLD, (140, 136, 130),
           "修复前", "段首 + 标点后 + 「每 7 字兜底」机械打点 → 锚点密集且落在词中间", 1.0)
y = render(d, y, NOW, TINT,
           "修复后", "每个语义小句开头一个锚点 → 稀疏、且永远落在词的开头", 1.0)
y = render(d, y, OLD, (140, 136, 130),
           "修复前 + 放大 160%", "锚点两侧被推开，整页看起来「四处漏风」", 1.6)
y = render(d, y, NOW, TINT,
           "修复后 + 放大 160%", "锚点只圈一个字，并用负 margin 收紧侧边空白", 1.6)

out = os.path.join(ROOT, "preview-anchors.png")
img.save(out)
print("saved:", out, img.size)
print("修复前锚点数:", sum(1 for s in OLD if s["b"]),
      " 修复后锚点数:", sum(1 for s in NOW if s["b"]))
