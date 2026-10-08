// 生成一个"大部头" EPUB，用于验证真实规模下的解析与渲染性能
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';

const CHAPTERS = 120;
const PARAS_PER_CHAPTER = 60;
const SENTENCES = [
  '夜色像一块浸透的布，沉甸甸地压在城市上空，远处的高楼只剩下模糊的轮廓。',
  '他想起很多年前的那个下午，阳光穿过图书馆的玻璃窗，在木地板上投下整齐的格子。',
  '没有人告诉他这件事究竟意味着什么，他只能凭着直觉一步一步往前摸索。',
  '风从山口灌进来，带着雪和松脂的气味，让所有说话的声音都变得遥远。',
  'The algorithm was simple in principle but surprisingly difficult to tune in practice.',
  '她把手放在桌面上，指尖能感觉到木头细微的纹路，那是时间留下的痕迹。',
  '这不是他第一次做出这样的选择，但每一次的重量都略有不同。',
  '雨停之后，屋檐还在滴水，一滴一滴，像是某种不肯结束的计量。',
];

const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip');
zip.file('META-INF/container.xml',
`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

const manifest = ['<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'];
const spine = [];
let totalChars = 0;

for (let c = 1; c <= CHAPTERS; c++) {
  const id = `c${c}`;
  manifest.push(`<item id="${id}" href="ch${c}.xhtml" media-type="application/xhtml+xml"/>`);
  spine.push(`<itemref idref="${id}"/>`);
  let body = '';
  for (let p = 0; p < PARAS_PER_CHAPTER; p++) {
    const s = Array.from({ length: 4 }, (_, k) => SENTENCES[(c + p + k) % SENTENCES.length]).join('');
    body += `<p>${s}</p>\n`;
    totalChars += s.length;
  }
  const title = `第${c}章 卷${Math.ceil(c / 20)}的第${((c - 1) % 20) + 1}节`;
  zip.file(`OEBPS/ch${c}.xhtml`,
`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1>
${body}</body></html>`);
}

zip.file('OEBPS/content.opf',
`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>大部头压力测试</dc:title><dc:creator>生成器</dc:creator>
  </metadata>
  <manifest>${manifest.join('')}</manifest>
  <spine toc="ncx">${spine.join('')}</spine>
</package>`);

const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(new URL('./big.epub', import.meta.url), buf);
console.log(`生成完成：${CHAPTERS} 章 / ${(totalChars / 10000).toFixed(1)} 万字 / 文件 ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
