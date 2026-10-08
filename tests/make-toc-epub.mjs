// 造一个"多级目录"的 EPUB，复现用户遇到的漏读问题：
//   · 有 nav.xhtml（EPUB 3），带 2 级嵌套
//   · 有 linear="no" 的封面/版权页
//   · 有 <title> 与 <h1> 不一致的页面
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const zip = new JSZip();

zip.file('mimetype', 'application/epub+zip');
zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

const pages = {
  'cover.html':  ['Cover', '封面图片占位'],
  'copyright.html': ['Copyright', '版权所有 保留一切权利'],
  'toc.html':    ['目录', '目录\n恶棍列传\n小径分岔的花园\n杜撰集'],
  'book1-title.html': ['Untitled', '恶棍列传'],
  'book1-ch1.html': ['ch1', '心狠手辣的解放者莫雷尔'],
  'book1-ch2.html': ['ch2', '难以置信的冒名者汤姆·卡斯特罗'],
  'book2-title.html': ['Untitled', '小径分岔的花园'],
  'book2-ch1.html': ['ch1', '特隆、乌克巴尔、奥比斯·特蒂乌斯'],
  'book2-ch2.html': ['ch2', '《吉诃德》的作者皮埃尔·梅纳尔'],
  'book3-title.html': ['Untitled', '杜撰集'],
  'book3-ch1.html': ['ch1', '博闻强识的富内斯'],
};
const longText = '这是一段足够长的正文内容，用来确保它不会被"太短"的规则过滤掉。' +
  '阅读是一种通过视觉引导提升阅读效率的排版方式。它应当被正常解析为一个章节。';

let items = '', refs = '';
for (const [f] of Object.entries(pages)) {
  const id = f.replace(/[^a-z0-9]/gi, '');
  items += `<item id="${id}" href="${f}" media-type="application/xhtml+xml"/>\n`;
  const linear = (f === 'cover.html' || f === 'copyright.html') ? ' linear="no"' : '';
  refs += `<itemref idref="${id}"${linear}/>\n`;
  const [t, h] = pages[f];
  const body = h === '封面图片占位' ? '<div>封面</div>' : `<h1>${h}</h1><p>${longText}</p>`;
  zip.file(`OEBPS/${f}`, `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title></head>
<body>${body}</body></html>`);
}

// nav.xhtml：两级嵌套
zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head><body>
<nav epub:type="toc"><h1>目录</h1>
<ol>
  <li><a href="book1-title.html">恶棍列传</a>
    <ol>
      <li><a href="book1-ch1.html">心狠手辣的解放者莫雷尔</a></li>
      <li><a href="book1-ch2.html">难以置信的冒名者汤姆·卡斯特罗</a></li>
    </ol>
  </li>
  <li><a href="book2-title.html">小径分岔的花园</a>
    <ol>
      <li><a href="book2-ch1.html">特隆、乌克巴尔、奥比斯·特蒂乌斯</a></li>
      <li><a href="book2-ch2.html">《吉诃德》的作者皮埃尔·梅纳尔</a></li>
    </ol>
  </li>
  <li><a href="book3-title.html">杜撰集</a>
    <ol>
      <li><a href="book3-ch1.html">博闻强识的富内斯</a></li>
    </ol>
  </li>
</ol>
</nav></body></html>`);

items += `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n`;

zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>多级目录测试书</dc:title><dc:identifier id="id">test</dc:identifier>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
${items}  </manifest>
  <spine>
${refs}  </spine>
</package>`);

const buf = await zip.generateAsync({ type: 'nodebuffer' });
writeFileSync(new URL('./toc.epub', import.meta.url), buf);
console.log('已生成 tests/toc.epub，大小', buf.length, '字节');
