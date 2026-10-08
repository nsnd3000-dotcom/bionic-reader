// EPUB 目录（TOC）解析：必须读 nav.xhtml / toc.ncx，而不是靠 spine 猜标题。
//
// 背景（用户报的问题）：
//   旧实现只读 spine，标题靠猜（<h1> → <title> → "第 N 节"），于是
//     · 封面/版权页被当成章节（spine 里有，但 linear="no"）
//     · 标题不准（<title> 常与正文标题不一致）
//     · **层级全丢** —— 一部文集里"书 → 篇"的结构在 spine 里是平铺的
//   正确做法是读 EPUB 的目录文件，那里有准确标题和嵌套层级。
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}\n       期望 ${JSON.stringify(e)}\n       实际 ${JSON.stringify(a)}`));

/* 起一个页面实例，并把指定 EPUB 导入，返回解析后的目录条目 */
async function loadEpub(epubPath) {
  const buf = readFileSync(new URL(epubPath, import.meta.url));
  const dom = new JSDOM(html, {
    url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.JSZip = JSZip;
      win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      Object.defineProperty(win, 'innerWidth', { value: 1400, writable: true });
      win.Element.prototype.scrollIntoView = function(){};
      win.HTMLElement.prototype.scrollIntoView = function(){};
    },
  });
  await new Promise(r => setTimeout(r, 250));
  const w = dom.window, d = w.document;
  const input = d.querySelector('#fileInput') || d.querySelector('input[type=file]');
  const file = new w.File([buf], epubPath.split('/').pop(), { type: 'application/epub+zip' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2200));
  const items = [...d.querySelectorAll('#tocList .toc-item')].map(b => ({
    text: b.textContent.replace(/\s+/g, ' ').trim(),
    depth: b.dataset.depth ? +b.dataset.depth : 0,
    paddingLeft: w.getComputedStyle(b).paddingLeft,
  }));
  return { w, d, items };
}

console.log('\n=== 1. 多级目录（nav.xhtml）：标题取自目录，层级保留 ===');
{
  const { items } = await loadEpub('./toc.epub');
  console.log('     侧栏条目：');
  items.forEach((it, i) => console.log(`       ${i + 1}. depth=${it.depth} pad=${it.paddingLeft}  ${it.text}`));

  const titles = items.map(x => x.text.replace(/^\d+/, ''));
  // 标题必须来自 nav.xhtml，而不是 <title> 或 "第 N 节"
  ok(titles.includes('恶棍列传'), '一级标题「恶棍列传」出现（来自 nav）');
  ok(titles.includes('小径分岔的花园'), '一级标题「小径分岔的花园」出现');
  ok(titles.includes('杜撰集'), '一级标题「杜撰集」出现');
  ok(titles.includes('心狠手辣的解放者莫雷尔'), '二级标题「心狠手辣的解放者莫雷尔」出现');
  ok(titles.includes('特隆、乌克巴尔、奥比斯·特蒂乌斯'), '二级标题「特隆…」出现');

  // 标题准确性：旧实现会拿到 <title> 里的 "ch1"/"Untitled"，目录里才是真标题
  ok(!titles.some(t => /^(ch\d|Untitled|Cover|Copyright)$/i.test(t)),
     '没有出现 <title> 里的占位名（ch1 / Untitled / Cover）');
  ok(!titles.some(t => /^第 \d+ 节$/.test(t)), '没有出现"第 N 节"这种兜底编号');

  // 层级：一级 0，二级 >=1，且二级有更大的左内边距
  const lv1 = items.filter(x => x.depth === 0);
  const lv2 = items.filter(x => x.depth >= 1);
  ok(lv1.length === 3, `一级条目 3 个（实际 ${lv1.length}）`);
  ok(lv2.length === 5, `二级条目 5 个（实际 ${lv2.length}）`);
  const pad1 = parseInt(lv1[0].paddingLeft), pad2 = parseInt(lv2[0].paddingLeft);
  ok(pad2 > pad1, `二级条目缩进更深（${pad2}px > ${pad1}px）—— 层级可见`);

  // 顺序应与 nav 中一致
  eq(titles.slice(0, 4),
     ['恶棍列传', '心狠手辣的解放者莫雷尔', '难以置信的冒名者汤姆·卡斯特罗', '小径分岔的花园'],
     '目录顺序与 nav.xhtml 一致');
}

console.log('\n=== 2. linear="no" 的页面不进正文 ===');
{
  const { items } = await loadEpub('./toc.epub');
  const titles = items.map(x => x.text);
  ok(!titles.some(t => /Cover|版权|Copyright/i.test(t)),
     '封面/版权页（linear="no"）没有被当成章节');
  ok(!titles.some(t => /^目录$/.test(t.replace(/^\d+/, '').trim())),
     '目录页本身没有出现在目录里');
}

console.log('\n=== 3. EPUB 2 的 toc.ncx 也能解析 ===');
{
  // 用 fixture.epub（老格式：spine toc="ncx"）
  const { items } = await loadEpub('./fixture.epub');
  console.log('     侧栏条目：');
  items.forEach((it, i) => console.log(`       ${i + 1}. depth=${it.depth}  ${it.text}`));
  ok(items.length >= 3, `解析出 ${items.length} 个条目`);
  ok(items.every(x => x.text.length > 1), '每个条目都有标题');
}

console.log('\n=== 4. 没有目录文件时优雅回退 ===');
{
  // big.epub 是自动生成的、没有 nav/ncx —— 必须仍能读，退回猜标题
  const { items } = await loadEpub('./big.epub');
  ok(items.length > 10, `无目录文件时仍解析出 ${items.length} 章（回退到标题推断）`);
  ok(items.every(x => x.text.length > 0), '回退路径下每章仍有标题');
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
