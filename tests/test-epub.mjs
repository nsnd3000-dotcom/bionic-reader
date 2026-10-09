// 用真实 EPUB 文件端到端验证解析器（含真实 JSZip）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/<script>\s*\/\* =+\s*\n\s*Bionic Reader[\s\S]*?\n<\/script>/);
let code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
code = code.replace(/document\.readyState === 'loading'[\s\S]*$/, '');
code = code.replace(/\}\)\(\);\s*$/, '');
code = code.replace(/^\s*\(\(\)\s*=>\s*\{/, '');
code += `\nglobalThis.__T = { parseEPUB, stripTags, toParagraphs };\n})();\n`;

const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://example.com' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.TextDecoder = TextDecoder;
window.JSZip = JSZip;        // 预置，使 loadJSZip() 走同步返回分支
globalThis.JSZip = JSZip;

new Function(code)();
const T = globalThis.__T;

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}\n       期望 ${JSON.stringify(e)}\n       实际 ${JSON.stringify(a)}`));

// ---------- 构造一个真实结构的 EPUB ----------
async function buildEPUB() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试书籍 &amp; 副标题</dc:title>
    <dc:creator>某作者</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="cover.html" media-type="application/xhtml+xml"/>
    <item id="tocpage" href="toc.html" media-type="application/xhtml+xml"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover"/>
    <itemref idref="tocpage"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
  </spine>
</package>`);

  zip.file('OEBPS/cover.html', `<html><head><title>Cover</title></head>
<body><div><img src="cover.jpg" alt=""/></div></body></html>`);

  zip.file('OEBPS/toc.html', `<html><head><title>目录</title></head><body><h1>目录</h1>
<p>第一章 起始</p><p>第二章 发展</p><p>第三章 结束</p></body></html>`);

  zip.file('OEBPS/ch1.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章 起始</title></head><body>
<h1>第一章 起始</h1>
<p>这是第一章的正文内容，用来验证段落抽取是否正确。</p>
<p>第二个段落，包含 <em>强调</em> 与 <strong>粗体</strong> 标签。</p>
<p>特殊实体：&amp; &lt; &gt; &quot; &nbsp; &#x4E2D;</p>
<script>var evil = "不该出现";</script>
</body></html>`);

  zip.file('OEBPS/text/ch2.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body>
<h2>第二章 发展</h2>
<p>第二章在某子目录里，用于验证相对路径拼接。</p>
<p>第二段。</p>
</body></html>`);

  zip.file('OEBPS/ch3.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第三章 结束</title></head><body>
<p>第三章没有标题标签，应该回退到 title。</p>
<p>最后一段内容，测试结束。</p>
</body></html>`);

  const buf = await zip.generateAsync({ type: 'uint8array' });
  /* ★ 只在样本不存在时才写盘。
     这个文件是"权威样本"：test-epub-toc.mjs 与 test-ui.mjs 都会读它。
     但早先这里无条件 writeFileSync，于是**每跑一次测试就重写一遍**，
     后果有两个：
       1) 工作区永远不干净 —— `git status` 总显示 tests/fixture.epub 被改，
          新用户跑完测试会以为改坏了什么；
       2) 测试之间通过文件产生隐式耦合，动手改样本时容易互相影响。
     样本本身由本文件定义，只要仓库里有（已提交）就不必重新生成。 */
  if (!existsSync(new URL('./fixture.epub', import.meta.url))) {
    writeFileSync(new URL('./fixture.epub', import.meta.url), buf);
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

console.log('\n=== EPUB 端到端解析 ===');
const buf = await buildEPUB();
const book = await T.parseEPUB(buf, () => {});

eq(book.title, '测试书籍 & 副标题', '书名解析 + XML 实体还原');
eq(book.chapters.length, 3, '跳过封面与目录页，剩 3 章');
ok(book.chapters.every(c => c.body.length >= 10), '每章都有正文');
eq(book.chapters[0].title, '第一章 起始', 'h1 作为章节标题');
eq(book.chapters[1].title, '第二章 发展', '子目录章节正确读取（相对路径拼接）');
eq(book.chapters[2].title, '第三章 结束', '无标题标签时回退 <title>');

console.log('\n--- 正文内容校验 ---');
const c1 = book.chapters[0].body;
ok(c1.includes('第一章的正文内容'), '正文段落被抽取');
ok(!c1.includes('不该出现'), 'script 内容被剔除');
ok(c1.includes('&') && c1.includes('<') && c1.includes('>'), 'XML 实体正确还原');
ok(!c1.includes('\u00a0'), 'nbsp 被归一化');
ok(!/<[a-z]/i.test(c1), '正文中无残留 HTML 标签');
ok(c1.includes('强调'), 'em 标签的内部文字被保留');
ok(!c1.startsWith('第一章 起始\n第一章 起始'), 'title 未在正文首行重复');

console.log('\n--- 段落切分 ---');
const paras = T.toParagraphs(c1);
ok(paras.length >= 3, `第一章切出 ${paras.length} 段`);
ok(paras.some(p => p.text.includes('实体')), '实体行成为独立段落');

console.log('\n--- 错误处理 ---');
try {
  await T.parseEPUB(new TextEncoder().encode('this is not a zip').buffer, () => {});
  ok(false, '非 ZIP 输入应当抛错');
} catch (e) {
  ok(true, `非 ZIP 输入正确抛错：${e.message.slice(0, 40)}`);
}
try {
  const emptyZip = new JSZip();
  emptyZip.file('hello.txt', 'nothing here');
  const b = await emptyZip.generateAsync({ type: 'uint8array' });
  await T.parseEPUB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), () => {});
  ok(false, '无 container.xml 应抛错');
} catch (e) {
  ok(/container\.xml/.test(e.message), `缺 container.xml 正确报错：${e.message.slice(0, 40)}`);
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
