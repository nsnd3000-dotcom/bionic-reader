// PDF 原版阅读器测试：静态契约 + 纯函数
//
// 设计取舍：pdf.js 的实际渲染**不在这里测**（需要网络 + 真浏览器画布），
// 由浏览器端 e2e 覆盖。这里锁定的是"改代码时最容易悄悄改坏"的东西：
//   · 关键 DOM 节点与工具栏控件是否齐备
//   · 可视区渲染（虚拟化）的三条不变式是否还在
//   · 中文 PDF 的 cMaps 配置有没有丢
//   · 旧的"重排 PDF"实现有没有被误留（会造成两套语义）
// 全部离线，不依赖 CDN。
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 取出主脚本块，注入测试探针
const m = html.match(/<script>\s*\/\* =+\s*\n\s*Bionic Reader[\s\S]*?\n<\/script>/);
if (!m) { console.error('没找到主脚本块'); process.exit(1); }
let code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
code = code.replace(/document\.readyState === 'loading'[\s\S]*$/, '');
code = code.replace(/\}\)\(\);\s*$/, '');
code = code.replace(/^\s*\(\(\)\s*=>\s*\{/, '');
code += `\nglobalThis.__PDF = {
  pdfView, PDFJS_ESM_CDNS, PDFJS_UMD_CDNS, PDFJS_VERSION,
  _pdfFitScale, _pdfComputeScale, loadPDFJS,
  openPDFViewer, closePDFViewer, closeReflowReader,
  savePDFProgress, loadPDFProgress, _pdfGotoPage, _pdfUpdateBar,
};\n})();\n`;

// 最小 DOM 桩
const store = new Map();
const stubEl = () => {
  const el = {
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { (f === undefined ? !this._s.has(c) : f) ? this._s.add(c) : this._s.delete(c); },
      contains: c => el.classList._s.has(c),
    },
    style: { setProperty() {}, getPropertyValue: () => '' },
    dataset: {}, textContent: '', value: '', checked: false, disabled: false, hidden: false,
    children: [], files: null,
    addEventListener() {}, removeEventListener() {}, appendChild() {}, replaceChildren() {},
    querySelector: () => null, querySelectorAll: () => [],
    click() {}, remove() {}, setAttribute() {}, blur() {}, focus() {},
    scrollTo() {}, getContext: () => ({}),
    clientWidth: 1000, clientHeight: 800, offsetTop: 0, scrollTop: 0,
    scrollHeight: 10000, firstElementChild: null,
  };
  return el;
};
globalThis.window = globalThis;
globalThis.document = {
  readyState: 'complete',
  documentElement: { style: { setProperty() {}, getPropertyValue: () => '' } },
  body: { classList: stubEl().classList, appendChild() {} },
  querySelector: () => stubEl(),
  querySelectorAll: () => [],
  createElement: () => stubEl(),
  createDocumentFragment: () => stubEl(),
  addEventListener() {},
  head: { appendChild() {} },
};
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.Node = class Node {};
globalThis.IntersectionObserver = class {
  constructor() {} observe() {} unobserve() {} disconnect() {}
};
globalThis.File = class File {};
globalThis.DataTransfer = class { constructor() { this.items = { add() {} }; this.files = []; } };

new Function(code)();
const P = globalThis.__PDF;

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}\n       期望 ${JSON.stringify(e)}\n       实际 ${JSON.stringify(a)}`));

console.log('\n【1】工具栏与页面容器的 DOM 契约');

{
  const ids = [
    'pdfBar', 'pdfPages', 'pdfZoomIn', 'pdfZoomOut', 'pdfFitWidth', 'pdfFitPage',
    'pdfHighlight', 'pdfHlToggle', 'pdfPrevPage', 'pdfNextPage',
    'pdfPageInput', 'pdfPageTotal', 'pdfZoomLabel',
  ];
  const missing = ids.filter(id => !html.includes(`id="${id}"`));
  eq(missing, [], '所有 PDF 工具栏控件都在 DOM 里');
}

{
  ok(/<div id="pdfPages"><\/div>/.test(html) || /id="pdfPages"/.test(html),
     '页面容器 #pdfPages 存在');
  // #pdfPages 必须在 #scroller 内部，才会跟着一起滚动
  const sc = html.match(/<div id="scroller">([\s\S]*?)<\/div>\s*<div id="progress">/);
  ok(sc && sc[1].includes('id="pdfPages"'), '#pdfPages 在 #scroller 内部（随滚动容器走）');
  ok(sc && sc[1].includes('id="reader"'), '#reader 也在 #scroller 内部');
}

{
  // 三种缩放模式必须都可达
  ok(html.includes("fitMode: 'width'"), '默认缩放模式是"适应宽度"');
  ok(/fitMode = 'width'/.test(html) && /fitMode = 'page'/.test(html) && /fitMode = 'none'/.test(html),
     'width / page / none 三种缩放模式都有赋值路径');
}

console.log('\n【2】可视区渲染（虚拟化）——325 页不能全渲染');

{
  // 必须用 IntersectionObserver 而不是"一次性渲染全部"
  ok(/new IntersectionObserver/.test(html), '用 IntersectionObserver 驱动渲染');
  ok(/_pdfUnrenderPage/.test(html), '有销毁页面的函数');
  ok(/_pdfRenderPage/.test(html), '有渲染页面的函数');
  // 离屏要销毁 canvas
  ok(/children|canvas/.test(html) && /\.remove\(\)/.test(html), '销毁时会移除 canvas');
}

{
  // rootMargin 必须留缓冲，否则滚动时会看到大片空白
  const rm = html.match(/rootMargin:\s*'([^']+)'/);
  ok(rm, '设置了 rootMargin');
  if (rm) {
    const pct = parseInt(rm[1], 10);
    ok(pct >= 100, `rootMargin 有足够缓冲（${rm[1]}），滚动时不会露白`);
  }
}

{
  // 占位盒要在渲染前就按尺寸建好，否则滚动条长度不对、页码跳转没目标
  ok(/_pdfBuildPlaceholders/.test(html), '建占位盒的函数存在');
  ok(/\.pdf-page\{/.test(html), '占位盒有 CSS 规则');
  // 占位盒必须 flex:0 0 auto，否则会被压扁
  ok(/flex:0 0 auto/.test(html), '占位盒不被 flex 压扁');
  // 高度写在内联 style 上（按每页真实视口算）
  ok(/el\.style\.height\s*=/.test(html), '占位盒高度按页设置');
}

{
  // devicePixelRatio：高分屏要按物理像素渲染
  ok(/devicePixelRatio/.test(html), '考虑了 devicePixelRatio（高分屏不发虚）');
  ok(/Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/.test(html),
     'dpr 封顶 2（再高只会白白吃显存）');
}

console.log('\n【3】整块高亮');

{
  ok(/TextLayer/.test(html), '用了 pdf.js 的 TextLayer 来定位文字块');
  // ★ 空 div 必须藏掉，否则会画出莫名其妙的色点
  ok(/if \(!\(d\.textContent \|\| ''\)\.trim\(\)\) \{ d\.style\.display = 'none'; continue; \}/.test(html),
     '空文字块被隐藏（避免画出零星色点）');
  // 高亮靠 CSS 类切换，不是逐元素改样式（性能 + 可关闭）
  ok(/body\.pdf-hl \.pdf-tl span\.pdf-anchor\{/.test(html),
     '高亮用 body.pdf-hl 类切换（且只作用于锚点字）');
  ok(/rgba\(var\(--pdf-hl-rgb/.test(html),
     '高亮用色带底色（不是加粗/换字号），且颜色来自变量');
  // 文字层默认透明，只用于选中/复制
  ok(/color:transparent/.test(html), '文字层默认透明（不遮挡原图）');
}

{
  // 高亮开关不能被抽样结果一刀切禁用：抽样会漏，禁用会让用户以为坏了
  ok(!/cb\.disabled = !anyText/.test(html),
     '高亮开关不因抽样未命中而禁用（抽样会漏，禁用会误导）');
  ok(/looksScanned/.test(html), '用 looksScanned 表达"抽样暂未发现"而不是硬禁用');
}

{
  /* ★ 逐页实时统计：打开时的抽样会漏，只有"实际渲染过的页"才可靠。
     实测踩过 —— 一本只有 4 页有文字的书，20 页抽样全部落空，
     提示却说"多半是扫描件"，用户以为功能坏了。 */
  ok(/textSeenPages/.test(html), '统计"实际见过文字的页数"');
  ok(/renderedPages/.test(html), '统计"实际渲染过的页数"');
  ok(/_pdfUpdateHlHint/.test(html), '有专门的函数按实际情况更新提示');
  ok(/if \(blocks > 0\) pdfView\.textSeenPages\+\+/.test(html),
     '渲染出文字块时累加计数');
  // 换书/关闭要清零，否则上一本的计数会串台
  const resets = (html.match(/pdfView\.textSeenPages = 0/g) || []).length;
  ok(resets >= 2, `打开与关闭都会清零计数（找到 ${resets} 处）`);
}

{
  // 纯扫描件必须在界面上**说出来**，而不是"勾了没反应"
  ok(/本页无文字层/.test(html), '纯扫描件时在开关旁显示"本页无文字层"');
  ok(/ocr\//.test(html) && /纯扫描件/.test(html),
     '明确告知是纯扫描件，并指向 ocr/ 脚本');
  // 打开时的 toast 不能断言"是扫描件"（抽样不可靠）
  ok(!/抽样未发现文字层（多半是扫描件）/.test(html),
     '打开时不再断言"是扫描件"（抽样会漏）');
  ok(/抽样暂未发现文字层/.test(html), '改为"暂未发现"，并提示可翻页确认');
}

console.log('\n【3b】锚点高亮：只高亮几个字，不是整行');

{
  /* 用户要的是"像仿生阅读那样只突出几个字"，而不是整行糊一片底色。
     做法：把文字块拆成单字 span，只给锚点字上色。
     在 PDF 上"加粗词首"做不到（已栅格化），但"只给几个字加底色"等价可行。 */
  ok(/_pdfSplitBlocksIntoChars/.test(html), '有"把文字块拆成单字"的函数');
  ok(/pdf-anchor/.test(html), '锚点字有独立 class');
  ok(/body\.pdf-hl \.pdf-tl span\.pdf-anchor\{/.test(html),
     '只有锚点字（span.pdf-anchor）加底色，不是所有 span');
  // 旧的"整块上色"规则必须不再是默认行为
  ok(!/body\.pdf-hl \.pdf-tl span\{/.test(html),
     '旧的"给所有 span 上底色"规则已移除（否则又变成整行高亮）');
}

{
  // 锚点算法必须复用仿生阅读那一套，保证 PDF 与 EPUB 行为一致
  ok(/computeHanAnchors\(text, strength\)/.test(html),
     '复用 computeHanAnchors（与 EPUB/TXT 同一套锚点规则）');
  ok(/state\.prefs\.strength/.test(html), '强度取自用户设置，不是写死的');
}

{
  /* ★ PDF 的"块"是按基线切的行片段，常不以标点开头，
     算法第一遍（标点后/段首）不会触发 → 整块可能 0 锚点（实测出现过空行）。
     所以块首要补一个锚点。 */
  ok(/块首补位/.test(html), '有"块首补位"逻辑（否则片段行会没有锚点）');
  ok(/anchors\.set\(i, 1\)/.test(html), '补位锚点长度为 1 个字');
  // 块尾要回避：色带贴行右缘会像悬空色斑
  ok(/块尾去位/.test(html) && /anchors\.delete\(chars\.length - 1\)/.test(html),
     '块尾去位（避免色带贴在行右缘）');
}

{
  /* ★ 拆字定位的两个关键点，都被实测坑过：
     (a) 容器宽度必须等于原 span 的实测宽度 —— 用 width:100% 会把短块
         拉伸到整页宽，色带漂到行外（实测最大漂移 353px）
     (b) 定位要用像素累加，一层定位 —— 把原 span 包进同样定位的容器会造成
         定位叠加 */
  ok(/const r0 = d\.getBoundingClientRect\(\)/.test(html),
     '拆字前量出原 span 的实际几何');
  ok(/const parentRect = d\.parentNode\.getBoundingClientRect\(\)/.test(html),
     '换算成相对父容器的坐标（避免叠加）');
  ok(/const totalW = r0\.width/.test(html), '切分基准用实测宽度，不用 100%');
  ok(/const x = \(acc \/ total\) \* totalW/.test(html), '字符位置用像素累加');
  ok(/width:\$\{cw\.toFixed\(1\)\}px/.test(html), '每个字有固定宽度的盒子（色带正好覆盖该字）');
}

{
  // 全角/半角宽度估算：中文按 1，西文按 0.5
  ok(/_pdfCharWidth/.test(html), '有字符宽度估算函数');
  ok(/return 1;/.test(html) && /return 0\.5;/.test(html),
     '全角算 1、半角算 0.5');
}

{
  // 原 span 必须保留在 DOM（只是 visibility:hidden），否则失去选中/复制能力
  ok(/d\.style\.visibility = 'hidden'/.test(html),
     '原 span 隐藏而非删除（保留选中/复制）');
  ok(!/d\.remove\(\)/.test(html), '不把原 span 从 DOM 移除');
}

{
  // 拆解过的块要打标记，避免重复拆（缩放重建时会重新生成 DOM）
  ok(/d\.dataset\.split === '1'/.test(html), '拆过的块有标记，不会重复拆');
}

console.log('\n【3c】高亮的颜色与不透明度可调');

{
  /* 底色压在原图之上 —— 太浓会妨碍阅读。
     早期写死 rgba(255,214,0,.55)，用户反馈"太黄了"。
     现在颜色与浓淡都走 CSS 变量，默认 0.22。 */
  ok(/--pdf-hl-rgb/.test(html), '底色用 CSS 变量控制（可换色）');
  ok(/--pdf-hl-alpha/.test(html), '不透明度用 CSS 变量控制（可调浓淡）');
  // 默认必须比早期的 0.55 淡得多
  ok(/--pdf-hl-alpha, \.22/.test(html), '默认不透明度是 0.22（早期 0.55 太黄）');
  ok(!/rgba\(255,214,0,\.55\)/.test(html), '写死的 0.55 已移除');
  // 颜色必须真的可配，不能把黄色写死在规则里
  ok(/rgba\(var\(--pdf-hl-rgb/.test(html), '规则里的颜色来自变量，不是写死的黄');
}

{
  // 用 RGB 三元组 + 独立 alpha，是为了让"整块档"能对 alpha 做 calc()
  ok(/hexToRgbTriplet/.test(html), '有 hex → RGB 三元组的转换函数');
  ok(/_pdfCharWidth/.test(html) && /HL_COLORS/.test(html), '有预设高亮色表');
  const hl = html.match(/const HL_COLORS = \[([\s\S]*?)\];/);
  ok(hl, 'HL_COLORS 已定义');
  if (hl) {
    const colors = hl[1].match(/#[0-9a-f]{6}/gi) || [];
    ok(colors.length >= 4, `预设色至少 4 种（实际 ${colors.length}）`);
    // 用户明确要"绿、红之类"
    ok(colors.some(c => /^#(7e|8|9|a|b|c)[0-9a-f]/.test(c.toLowerCase())) || colors.includes('#7ed957'),
       '有绿色');
    ok(colors.includes('#ff7b72') || colors.some(c => /^#ff[0-9a-f]{4}$/i.test(c)), '有红色系');
    ok(colors.includes('#ffd600'), '保留黄色（默认）');
  }
}

{
  // 设置面板必须有对应控件
  ok(/id="hlSwatches"/.test(html), '设置面板里有高亮色板');
  ok(/id="hlPicker"/.test(html), '有自定义取色器');
  ok(/id="rHlAlpha"/.test(html), '有不透明度滑块');
  ok(/id="vHlAlpha"/.test(html), '有不透明度的数值回显');
  // 滑块范围要合理：不能到 100%（那会完全盖住原图）
  const r = html.match(/id="rHlAlpha"[^>]*min="(\d+)"[^>]*max="(\d+)"/);
  ok(r, '滑块有 min/max');
  if (r) {
    ok(+r[1] >= 5, `下限 ${r[1]}% 不至于完全看不见`);
    ok(+r[2] <= 70, `上限 ${r[2]}% 不至于糊住原文`);
  }
}

{
  // 控件必须真的接到 prefs 上（避免"加了 UI 但没接线"）
  ok(/hlColor: '#ffd600'/.test(html), 'hlColor 有默认值');
  ok(/hlAlpha: 22/.test(html), 'hlAlpha 默认 22');
  ok(/state\.prefs\.hlColor = b\.dataset\.hl/.test(html), '色块点击写入 hlColor');
  ok(/state\.prefs\.hlAlpha = v/.test(html), '滑块写入 hlAlpha');
  ok(/setProperty\('--pdf-hl-rgb'/.test(html), 'applyPrefs 写入颜色变量');
  ok(/setProperty\('--pdf-hl-alpha'/.test(html), 'applyPrefs 写入不透明度变量');
}

{
  /* ★ 改设置必须**立刻生效**，不用重开 PDF。
     色带是 CSS 背景，改变量浏览器自己会重绘 —— 不需要重建文字层。
     所以这里不该出现"重新打开文档"之类的调用。 */
  const app = html.match(/function applyPrefs\(\)[\s\S]*?\n\}/);
  ok(app, '能定位到 applyPrefs');
  if (app) {
    ok(!/getDocument|_pdfRescale|openPDFViewer/.test(app),
       'applyPrefs 不触发 PDF 重载（只改 CSS 变量即可实时生效）');
  }
}

{
  // 非法色值不能把高亮弄没：兜底回默认色
  ok(/return '255,214,0'/.test(html), '色值解析失败时回退默认黄，不会让高亮消失');
}

console.log('\n【3d】英文锚点：每个词的前 1~2 个字母');

{
  /* computeHanAnchors 只处理**汉字**（那套规则基于"中文没有空格、
     靠标点和虚词透出词边界"）。拉丁词走过去一个锚点都拿不到 ——
     实测纯英文 PDF 每行只有"块首补位"那一个孤零零的锚点，
     连 internationalization 这种长词都完全不标。
     所以要单独补一条拉丁词规则。 */
  ok(/英文（拉丁）词的锚点/.test(html), '有英文锚点逻辑');
  ok(/const enLen = strength >= 3 \? 2 : 1/.test(html),
     '按强度取 1 或 2 个字母（默认档取 2）');
  ok(/if \(HAN_RE\.test\(w\)\) continue/.test(html),
     '汉字跳过英文规则（两套规则互不干扰）');
  ok(/if \(!\/\[A-Za-z\]\/\.test\(w\)\) continue/.test(html),
     '纯数字不锚（如 2026）');
  // 短词保护：词长 <= 2 时最多标 1 个，否则整个词被标就失去对比
  ok(/w\.length <= 2 \? 1 : Math\.min\(enLen, w\.length - 1\)/.test(html),
     '短词只标 1 个字母（避免整词被标、失去锚定对比）');
  // 复用同一套词边界定义，不要另造正则
  ok(/WORD_RE\.lastIndex = 0;[\s\S]{0,200}WORD_RE\.exec\(text\)/.test(html),
     '复用 WORD_RE 识别词边界（与其它格式一致）');
}

{
  // 强度 1~2 时应该只有 1 个字母 —— 这是"最克制"的档
  const m = html.match(/const enLen = strength >= (\d+) \? (\d+) : (\d+)/);
  ok(m, '能读出强度分档');
  if (m) {
    ok(+m[3] === 1, `弱强度（1~2 档）只标 ${m[3]} 个字母`);
    ok(+m[2] === 2, `强度 >= ${m[1]} 时标 ${m[2]} 个字母`);
  }
}

{
  // 不能覆盖已有锚点（块首补位算出来的那个）
  ok(/if \(!anchors\.has\(start\)\) anchors\.set\(start, n\)/.test(html),
     '不覆盖已有锚点，避免重复标注');
}

console.log('\n【4】pdf.js 加载与中文 PDF 的 cMaps');

{
  eq(P.PDFJS_ESM_CDNS.every(u => u.endsWith('.mjs')), true,
     'ESM 回退列表只有 .mjs（import() 不能执行 UMD）');
  eq(P.PDFJS_UMD_CDNS.every(u => u.endsWith('.js')), true, 'UMD 兜底列表是 .js');
  ok(P.PDFJS_ESM_CDNS.length >= 2, 'ESM 至少 2 个 CDN 回退');
  ok(P.PDFJS_UMD_CDNS.length >= 1, 'UMD 至少 1 个兜底');
  ok(/_loadPDFJSViaScript/.test(html), 'UMD 走 <script src> 注入（import() 吃不了）');
}

{
  // ★ 中文 PDF 的生死线：cMaps 不给 → 不报错但整页 0 字符
  ok(/cMapUrl:/.test(html), '配了 cMapUrl');
  ok(/cMapPacked:\s*true/.test(html), '配了 cMapPacked');
  ok(/pdfjs-dist@\$\{pdfjsVersion\}\/cmaps\//.test(html),
     'cMapUrl 与 pdfjsVersion 同版本（版本错位会拉不到）');
  // worker 也要同版本，否则 pdf.js 拒绝运行
  ok(/pdf\.worker\.min\.mjs/.test(html), 'workerSrc 指向对应版本的 worker');
}

{
  // ESM 命名空间冻结，不能挂自定义属性
  ok(!/_finishPDFJS[\s\S]{0,300}lib\.__version\s*=/.test(html),
     '不往 ESM 命名空间上挂 __version（会抛 Cannot assign to property）');
}

console.log('\n【5】旧的"重排 PDF"必须彻底移除（避免两套语义）');

{
  const gone = [
    'parsePDF', '_pdfRebuildRows', '_pdfRowsToParagraphs',
    '_pdfDetectRepeatLines', '_pdfCjkLen', '_pdfNeedsSpace',
    'PDF_NO_TEXT', 'isPDF:',
  ];
  const left = gone.filter(k => html.includes(k));
  eq(left, [], '旧的 PDF 重排实现已全部清除');
}

{
  // PDF 不该再进重排管线
  ok(!/chapters\.push\(\{ title: chTitle/.test(html), '没有"每页一章"的切章代码了');
  // goHome 必须能同时处理两种模式
  ok(/if \(pdfView\.doc\) \{[\s\S]{0,400}closePDFViewer\(\)/.test(html),
     'goHome 会关闭 PDF 视图器');
}

console.log('\n【6】模式互斥与状态隔离');

{
  ok(/body\.pdf-mode #reader/.test(html), 'PDF 模式下隐藏重排阅读器');
  ok(/body:not\(\.pdf-mode\) #pdfBar/.test(html), '非 PDF 模式下隐藏工具栏');
  ok(/closeReflowReader\(\)/.test(html), '切到 PDF 时清掉重排阅读器内容');
  ok(/closePDFViewer\(\)/.test(html), '切回重排时会关闭 PDF 视图器');
}

{
  // 两种进度分开存：语义不同（{chapter,ratio} vs {page}），混存会互相覆盖
  ok(/PDF_PROGRESS_KEY/.test(html), 'PDF 进度用独立的存储键');
  const oldKey = html.match(/const PROGRESS_KEY = '([^']+)'/);
  const pdfKey = html.match(/const PDF_PROGRESS_KEY = '([^']+)'/);
  ok(oldKey && pdfKey && oldKey[1] !== pdfKey[1], 'PDF 进度键与重排进度键不相同');
}

{
  /* ★ 设置面板在 PDF 模式下**必须能打开**。
     ------------------------------------------------------------
     踩过的坑（而且这条测试最初还把这个 bug 当成"预期行为"锁住了）：
     早期把 #btnPanel 跟 #btnBionic 一起禁用，理由是"仿生参数对 PDF 无效"。
     但 PDF 高亮的**颜色和不透明度就在同一个面板里** ——
     禁用面板等于把用户锁在门外："设置点不进去，就没法调高亮颜色"。

     正解分两层：
       · 只禁用真正无效的那个**开关**（#btnBionic，二态开关会误导）
       · 面板保持可用；面板里无效的**小节**（#bionicSec / #typesetSec）
         用 CSS 按 body.pdf-mode 隐藏 */
  ok(/\$\('#btnPanel'\)\.disabled = false/.test(html),
     'PDF 模式下设置按钮保持可用（否则没法调高亮颜色）');
  ok(/\$\('#btnBionic'\)\.disabled = true/.test(html),
     '只禁用真正无效的仿生开关');
  ok(!/\['#btnBionic', '#btnPanel'\]\.forEach[\s\S]{0,120}disabled = true/.test(html),
     '不再把面板和仿生开关一起批量禁用（goHome 里的恢复逻辑不算）');
}

{
  // 面板里"对 PDF 无效"的两节用 CSS 隐藏（不是删 DOM —— 切回去要还原）
  ok(/body\.pdf-mode #bionicSec,/.test(html), 'PDF 模式下隐藏「仿生阅读」一节');
  ok(/body\.pdf-mode #typesetSec\{display:none\}/.test(html), 'PDF 模式下隐藏「排版」一节');
  ok(/id="bionicSec"/.test(html) && /id="typesetSec"/.test(html), '两节都有 id 供 CSS 定位');

  // ★「PDF 高亮」一节绝不能被隐藏，否则等于又锁上了
  ok(/id="pdfHlSec"/.test(html), '「PDF 高亮」一节有 id');
  const hiddenRules = html.match(/body\.pdf-mode[^{]*\{[^}]*display\s*:\s*none[^}]*\}/g) || [];
  ok(!hiddenRules.some(r => r.includes('pdfHlSec')),
     '「PDF 高亮」一节在 PDF 模式下不被隐藏');
}

{
  // 回首页要恢复入口，否则换书后仿生开关永远是灰的
  ok(/\['#btnBionic', '#btnPanel'\]\.forEach[\s\S]{0,120}disabled = false/.test(html),
     '回首页时恢复被禁用的入口');
}

console.log('\n【7】纯函数：适配缩放');

{
  // 用最小 DOM 桩，clientWidth 固定 1000 → 减去 40 留白
  const s = P._pdfFitScale({ width: 480, height: 700 });
  ok(Math.abs(s - (960 / 480)) < 0.001, `适应宽度算得对（480pt 宽 → ${s.toFixed(2)}x）`);

  // 极窄页不该算出夸张的缩放（下限 0.2）
  const s2 = P._pdfFitScale({ width: 100000, height: 700 });
  ok(s2 >= 0.2, '超大页宽时缩放不会低于下限 0.2');
}

{
  // 适应整页必须同时受宽和高约束
  P.pdfView.baseViewport = { width: 600, height: 800 };
  P.pdfView.fitMode = 'width';
  const w = P._pdfComputeScale();
  P.pdfView.fitMode = 'page';
  const p = P._pdfComputeScale();
  ok(p <= w, '适应整页的缩放不会大于适应宽度');
  P.pdfView.fitMode = 'none';
  P.pdfView.scale = 1.75;
  eq(P._pdfComputeScale(), 1.75, 'none 模式直接用用户设定的缩放');
}

console.log('\n【8】进度存取');

{
  store.clear();
  // savePDFProgress 要求"已打开文档"才写，所以给个占位 doc
  P.pdfView.doc = { numPages: 100 };
  P.pdfView.docId = 'book.pdf|100|123';
  P.pdfView.current = 42;
  P.savePDFProgress();
  const got = P.loadPDFProgress('book.pdf|100|123');
  eq(got && got.page, 42, '存进去的页码能读回来');

  eq(P.loadPDFProgress('别的书.pdf|1|1'), null, '没存过的书返回 null');

  // 没有文档时不该写
  store.clear();
  P.pdfView.doc = null;
  P.pdfView.docId = 'book.pdf|100|123';
  P.savePDFProgress();
  eq(store.size, 0, '没打开文档时不写进度');
}

{
  // 进度表不能无限增长
  store.clear();
  P.pdfView.doc = { numPages: 100 };
  for (let i = 0; i < 30; i++) {
    P.pdfView.docId = `b${i}.pdf|1|${i}`;
    P.pdfView.current = i + 1;
    P.savePDFProgress();
  }
  const all = JSON.parse(store.get('bionic.pdfProgress.v1'));
  ok(Object.keys(all).length <= 20, `进度表被裁剪到 20 条以内（实际 ${Object.keys(all).length}）`);
}

// 收尾：还原全局，避免影响其它测试文件
P.pdfView.doc = null;
P.pdfView.docId = '';

console.log(`\n通过 ${pass} / 失败 ${fail}\n`);
if (fail) process.exitCode = 1;
