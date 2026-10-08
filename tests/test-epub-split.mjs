// EPUB 章节切分：以**目录条目**为单位，而不是"一个文件 = 一章"。
//
// 背景（用户用真实书报的问题）：
//   博尔赫斯全集（Sigil 生成）：
//     · spine 只有 17 个文件
//     · toc.ncx 有 288 个 navPoint
//     · 15 个文件承载这 288 个标题 —— 每文件 18~19 个
//     · 靠 #sigil_toc_id_N 锚点区分同一文件内的章节
//   "一个文件 = 一章"会把 288 章读成 17 章 —— 这就是"漏读"。
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}\n       期望 ${JSON.stringify(e)}\n       实际 ${JSON.stringify(a)}`));

async function loadEpub(buf, name = 'book.epub') {
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
  const file = new w.File([buf], name, { type: 'application/epub+zip' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 3000));
  return {
    w, d,
    items: [...d.querySelectorAll('#tocList .toc-item')].map(b => ({
      text: b.textContent.replace(/^\d+/, '').trim(),
      depth: b.dataset.depth ? +b.dataset.depth : 0,
      group: b.dataset.group === '1',
      idx: +b.dataset.idx,
    })),
    // 正文里各章的实际内容长度
    bodies: null,
  };
}

/* ── 1. 一份"少文件、多标题"的书（复现 Sigil 结构）── */
console.log('\n=== 1. 多标题压在同一文件里：必须按锚点切开 ===');
{
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
     <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

  // 一个文件里塞 3 个带 sigil 锚点的章节
  const body = ['甲','乙','丙'].map((t, i) =>
    `<h1 id="sigil_toc_id_${i + 1}">第${t}章 标题${t}</h1><p>${'这是'+t+'章的正文内容。'.repeat(12)}</p>`
  ).join('\n');
  zip.file('OEBPS/one.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">
     <head><title>未知</title></head><body>${body}</body></html>`);

  // NCX：3 个 navPoint 指向同一个文件，靠锚点区分
  zip.file('toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <navMap>
      <navPoint id="n1"><navLabel><text>第甲章 标题甲</text></navLabel><content src="OEBPS/one.xhtml#sigil_toc_id_1"/></navPoint>
      <navPoint id="n2"><navLabel><text>第乙章 标题乙</text></navLabel><content src="OEBPS/one.xhtml#sigil_toc_id_2"/></navPoint>
      <navPoint id="n3"><navLabel><text>第丙章 标题丙</text></navLabel><content src="OEBPS/one.xhtml#sigil_toc_id_3"/></navPoint>
    </navMap></ncx>`);

  zip.file('content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="i">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>三章同文件</dc:title><dc:identifier id="i">x</dc:identifier></metadata>
    <manifest>
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      <item id="one" href="OEBPS/one.xhtml" media-type="application/xhtml+xml"/>
    </manifest>
    <spine toc="ncx"><itemref idref="one"/></spine></package>`);

  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const { items } = await loadEpub(buf, 'three.epub');

  console.log('     解析结果：', items.map(x => x.text).join(' | '));
  eq(items.length, 3, '一个文件里的 3 个标题 → 切成 3 章（不是 1 章）');
  eq(items.map(x => x.text), ['第甲章 标题甲', '第乙章 标题乙', '第丙章 标题丙'],
     '标题与顺序都与 NCX 一致');
}

/* ── 2. 标题顺序必须按 NCX，不能按"找到的位置"重排 ── */
console.log('\n=== 2. 顺序以目录为准（含分组标题与嵌套）===');
{
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
     <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

  // 正文里故意让「甲组」这个词在后面也出现一次，用来诱导"按文字搜索的位置排序"出错
  const body = `
    <h1 id="a1">甲组</h1>
    <h2 id="a2">一之一</h2><p>${'一之一的内容。'.repeat(20)}</p>
    <h2 id="a3">一之二</h2><p>${'一之二的内容。'.repeat(20)}</p>
    <h1 id="b1">乙组</h1>
    <h2 id="b2">二之一</h2><p>${'二之一的内容。'.repeat(20)}</p>
    <p>这里再次提到甲组，用来干扰按文字定位的实现。</p>`;
  zip.file('OEBPS/one.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">
     <head><title>未知</title></head><body>${body}</body></html>`);

  zip.file('toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <navMap>
      <navPoint id="n1"><navLabel><text>甲组</text></navLabel><content src="OEBPS/one.xhtml#a1"/>
        <navPoint id="n2"><navLabel><text>一之一</text></navLabel><content src="OEBPS/one.xhtml#a2"/></navPoint>
        <navPoint id="n3"><navLabel><text>一之二</text></navLabel><content src="OEBPS/one.xhtml#a3"/></navPoint>
      </navPoint>
      <navPoint id="n4"><navLabel><text>乙组</text></navLabel><content src="OEBPS/one.xhtml#b1"/>
        <navPoint id="n5"><navLabel><text>二之一</text></navLabel><content src="OEBPS/one.xhtml#b2"/></navPoint>
      </navPoint>
    </navMap></ncx>`);

  zip.file('content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="i">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>嵌套</dc:title><dc:identifier id="i">x</dc:identifier></metadata>
    <manifest>
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      <item id="one" href="OEBPS/one.xhtml" media-type="application/xhtml+xml"/>
    </manifest>
    <spine toc="ncx"><itemref idref="one"/></spine></package>`);

  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const { items } = await loadEpub(buf, 'nested.epub');

  console.log('     解析结果：');
  items.forEach(x => console.log(`       depth=${x.depth}${x.group ? ' [分组]' : ''}  ${x.text}`));

  eq(items.map(x => x.text), ['甲组', '一之一', '一之二', '乙组', '二之一'],
     '顺序与 NCX 完全一致（未被"文字出现位置"重排）');
  ok(items[0].group, '「甲组」被识别为分组标题（有子项）');
  ok(items[3].group, '「乙组」被识别为分组标题');
  ok(items[0].depth === 0 && items[1].depth === 1, '层级：分组 0，子项 1');
  ok(items[3].depth === 0 && items[4].depth === 1, '层级：乙组 0，子项 1');
  ok(!items[1].group && !items[2].group, '子项不是分组标题');
}

/* ── 3. 用合成样本覆盖"真实书"那种结构 ──
   这一节替代了早先"读本机某本真实书"的做法。
   理由：测试**不该依赖任何人的私人文件**（路径一换就失效，
   而且会让别人以为"测试必须自备某本书"）。
   那种书的关键特征其实是可以合成出来的：
     · spine 文件少、navPoint 多，靠 #锚点区分
     · 多级嵌套 + 分组标题
   下面就用 toc.epub（由 make-toc-epub.mjs 生成）来覆盖。 */
console.log('\n=== 3. 合成样本：多标题压在同一文件（真实书的典型结构）===');
{
  const { d, items } = await loadEpub(readFileSync(new URL('./toc.epub', import.meta.url)), 'toc.epub');
  console.log(`     解析出 ${items.length} 个条目`);
  ok(items.length >= 8, `条目数 ${items.length} ≥ 8（没有被压成"一个文件一章"）`);
  const groups = items.filter(x => x.group);
  ok(groups.length === 3, `识别出 3 个分组标题（实际 ${groups.length}）`);
  const titles = items.map(x => x.text);
  ok(titles.includes('恶棍列传') && titles.includes('小径分岔的花园'),
     '分组标题来自 nav.xhtml 而非 <title> 占位名');

  /* ★ 分组行在侧栏里必须是"不可落到空正文"的标题行：
     点它要跳到它的**第一个子项**，而不是停在自己。
     做法是 buildToc 把 data-idx 改写成子项下标。
     这里直接查 DOM 属性，锁住这个行为（回归：曾经分组整批退化成普通章节，
     点进去就是空白页）。 */
  const dom = [...d.querySelectorAll('#tocList .toc-item')];
  const groupBtns = dom.filter(b => b.dataset.group === '1');
  ok(groupBtns.length === 3, `侧栏里有 3 个分组行（实际 ${groupBtns.length}）`);
  const ownIdx = groupBtns.map(b => dom.indexOf(b));
  const jumpIdx = groupBtns.map(b => +b.dataset.idx);
  ok(jumpIdx.every((v, i) => v !== ownIdx[i]),
     `★ 分组行跳向子项而非自己（自身 ${ownIdx.join(',')} → 目标 ${jumpIdx.join(',')}）`);
  ok(dom.filter(b => b.dataset.depth === '1').every(b => b.dataset.group !== '1'),
     '子项都不带分组标记');
  ok(/\.toc-item\[data-group="1"\]/.test(html), 'CSS 里有 .toc-item[data-group="1"] 规则');
}

/* ── 4. 分组标题与子项**分处不同文件**时也必须认出分组 ──
   回归测试：早先 isGroupHeading 的判据是"下一个同文件条目的 depth 更深"，
   而真实 EPUB 常见形态是"每个标题一个文件"（父标题单独占一个文件），
   此时同文件里没有下一个条目，判据恒为 false，
   于是「恶棍列传」这类分组标题退化成普通章节 —— 多级目录被拉平。
   这里用 toc.epub 之外的**最小合成样本**把这条锁死。 */
console.log('\n=== 4. 父标题单独成文件时，仍须识别为分组 ===');
{
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
     <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

  const longText = '这是一段足够长的正文内容，用来确保它不会被"太短"的规则过滤掉。'.repeat(2);
  // ★ 父标题页**独占一个文件**（book1-title.html），子项在另外的文件
  zip.file('OEBPS/book1-title.html',
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">
     <head><title>Untitled</title></head><body><h1>甲卷</h1></body></html>`);
  zip.file('OEBPS/book1-ch1.html',
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">
     <head><title>ch1</title></head><body><h1>子篇一</h1><p>${longText}</p></body></html>`);

  // EPUB3 nav：父项带 <ol> 子项，指向**不同文件**
  zip.file('OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
     <head><title>目录</title></head><body>
     <nav epub:type="toc"><ol>
       <li><a href="book1-title.html">甲卷</a>
         <ol><li><a href="book1-ch1.html">子篇一</a></li></ol>
       </li>
     </ol></nav></body></html>`);

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
   <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="i">
     <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>父子分文件</dc:title><dc:identifier id="i">x</dc:identifier></metadata>
     <manifest>
       <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
       <item id="t" href="book1-title.html" media-type="application/xhtml+xml"/>
       <item id="c" href="book1-ch1.html" media-type="application/xhtml+xml"/>
     </manifest>
     <spine><itemref idref="t"/><itemref idref="c"/></spine></package>`);

  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const { items } = await loadEpub(buf, 'split-group.epub');
  console.log('     解析结果：');
  items.forEach(x => console.log(`       depth=${x.depth}${x.group ? ' [分组]' : ''}  ${x.text}`));

  eq(items.map(x => x.text), ['甲卷', '子篇一'], '两个标题都保留且顺序正确');
  ok(items[0].group, '★ 父标题独占文件时仍被识别为分组标题（回归）');
  ok(!items[1].group, '子篇不是分组标题');
  ok(items[1].depth === 1, '子篇深度为 1');

  //  EPUB2 的 ncx 走同一套判定，也要覆盖
  const zip2 = new JSZip();
  zip2.file('mimetype', 'application/epub+zip');
  zip2.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
     <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip2.file('OEBPS/book1-title.html',
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">
     <head><title>Untitled</title></head><body><h1>乙卷</h1></body></html>`);
  zip2.file('OEBPS/book1-ch1.html',
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">
     <head><title>ch1</title></head><body><h1>子篇二</h1><p>${longText}</p></body></html>`);
  zip2.file('toc.ncx', `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <navMap>
      <navPoint id="n1"><navLabel><text>乙卷</text></navLabel><content src="OEBPS/book1-title.html"/>
        <navPoint id="n2"><navLabel><text>子篇二</text></navLabel><content src="OEBPS/book1-ch1.html"/></navPoint>
      </navPoint>
    </navMap></ncx>`);
  zip2.file('content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="i">
     <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>父子分文件</dc:title><dc:identifier id="i">x</dc:identifier></metadata>
     <manifest>
       <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
       <item id="t" href="OEBPS/book1-title.html" media-type="application/xhtml+xml"/>
       <item id="c" href="OEBPS/book1-ch1.html" media-type="application/xhtml+xml"/>
     </manifest>
     <spine toc="ncx"><itemref idref="t"/><itemref idref="c"/></spine></package>`);

  const buf2 = await zip2.generateAsync({ type: 'nodebuffer' });
  const r2 = await loadEpub(buf2, 'split-group-ncx.epub');
  r2.items.forEach(x => console.log(`       depth=${x.depth}${x.group ? ' [分组]' : ''}  ${x.text}`));
  eq(r2.items.map(x => x.text), ['乙卷', '子篇二'], 'NCX：两个标题都保留');
  ok(r2.items[0].group, '★ NCX 分支同样识别分组标题（回归）');
  ok(!r2.items[1].group, 'NCX：子篇不是分组标题');
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
