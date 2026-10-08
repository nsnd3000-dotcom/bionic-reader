// 测试 bionic 核心算法与文本解析逻辑（从 index.html 中抽取纯函数）
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 抽取 IIFE 内部，暴露内部函数用于测试
const m = html.match(/<script>\s*\/\* =+\s*\n\s*Bionic Reader[\s\S]*?\n<\/script>/);
if (!m) { console.error('FAIL: 找不到主脚本块'); process.exit(1); }

let code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
code = code.replace(/document\.readyState === 'loading'[\s\S]*$/, '');
code = code.replace(/\}\)\(\);\s*$/, '');
code = code.replace(/^\s*\(\(\)\s*=>\s*\{/, '');
code += `
globalThis.__T = { prefixLen, bionicFragment, bionicToHTML, toParagraphs, splitChapters, decodeBuffer,
  normalizeText, stripTags, unescapeXML, STRENGTH_TABLE, WORD_RE, HAN_RE, CJK_STRIDE, CJK_CLAUSE };
})();
`;

const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://example.com' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.TextDecoder = TextDecoder;

new Function(code)();
const T = globalThis.__T;

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`); }
}
function ok(cond, name) { cond ? (pass++, console.log(`  ok   ${name}`)) : (fail++, console.log(`  FAIL ${name}`)); }

// 遍历 frag，产出 [文本, 是否高亮] 序列
function segsOf(frag) {
  const segs = [];
  const walk = n => {
    if (n.nodeType === 3) { if (n.nodeValue) segs.push([n.nodeValue, 0]); return; }
    if (n.nodeType === 1) { segs.push([n.textContent, n.className === 'br-head' ? 1 : 0]); return; }
    for (const c of n.childNodes) walk(c);
  };
  for (const c of frag.childNodes) walk(c);
  return segs;
}
const textOf = segs => segs.map(s => s[0]).join('');

console.log('\n=== 1. prefixLen 边界与单调性 ===');
eq(T.prefixLen('a', 3), 1, '单字母');
eq(T.prefixLen('to', 3), 1, '2 字母');
eq(T.prefixLen('the', 3), 1, '3 字母');
eq(T.prefixLen('reading', 3), 2, '7 字母 -> 2');
eq(T.prefixLen('attention', 3), 3, '9 字母 -> 3');
eq(T.prefixLen('bionic', 3), 2, '6 字母 -> 2');
eq(T.prefixLen('a'.repeat(10), 3), 4, '10 字母 -> 4');
eq(T.prefixLen('a'.repeat(25), 3), 4, '超长词同档，不越界');
for (let s = 1; s <= 5; s++) {
  const bad = [];
  for (let len = 1; len <= 30; len++) {
    const n = T.prefixLen('x'.repeat(len), s);
    if (n < 1 || n > len || (len > 3 && n >= len)) bad.push(`${len}:${n}`);
  }
  ok(bad.length === 0, `强度 ${s} 所有长度合法（不吞词/不越界）${bad.length ? ' -> ' + bad : ''}`);
}
let mono = true, monoLen = true;
for (let len = 1; len <= 14; len++)
  for (let s = 2; s <= 5; s++)
    if (T.prefixLen('x'.repeat(len), s) < T.prefixLen('x'.repeat(len), s - 1)) mono = false;
for (let s = 1; s <= 5; s++)
  for (let len = 2; len <= 14; len++)
    if (T.prefixLen('x'.repeat(len), s) < T.prefixLen('x'.repeat(len - 1), s)) monoLen = false;
ok(mono, '强度单调递增');
ok(monoLen, '长度单调递增');

console.log('\n=== 2. 文本无损（关键不变式）===');
const samples = [
  'Hello world',
  '中文段落，包含标点。还有 English words 混合。',
  "it's a test — with dashes and 123 numbers",
  '没有空格的纯中文长句测试内容',
  'a b c d e',
  '',
  '   ',
  'em—dash and ellipsis…end',
  '全角，标点！？；：（）【】',
  'Ünïcödé wörds ànd ñ',
];
for (const s of samples) {
  eq(textOf(segsOf(T.bionicFragment(s, 3, document))), s,
     `无损还原: ${JSON.stringify(s.slice(0, 34))}`);
}

console.log('\n=== 3. 结构正确 ===');
// 词间空格是独立的纯文本节点（不高亮），故序列中含 ' '
eq(segsOf(T.bionicFragment('Hello world', 3, document)),
   [['He',1],['llo',0],[' ',0],['wo',1],['rld',0]], 'Hello world 切分正确');
{
  const raw = [];
  const walk = n => {
    if (n.nodeType === 3) { raw.push(`T:${n.nodeValue}`); return; }
    if (n.nodeType === 1) { raw.push(`E:${n.textContent}`); return; }
    for (const c of n.childNodes) walk(c);
  };
  walk(T.bionicFragment('“Quoted”, ok.', 3, document));
  ok(raw[0].startsWith('T:“'), '前引号是纯文本节点');
  ok(raw.join('').includes('T:”, '), '后引号与逗号是纯文本节点');
}

console.log('\n=== 4. toParagraphs ===');
{
  const r = T.toParagraphs('第一章 开端\n这是第一段内容，有句号。\n\n这是第二段内容，也有句号。');
  eq(r[0], { type: 'h3', text: '第一章 开端' }, '开头短行识别为标题');
  eq(r.length, 3, '段落数');
  eq(r[1].type, 'p', '正文识别为段落');
}
{
  const r = T.toParagraphs('这是一段很长的正文内容，应该被识别为段落而不是标题。\n第二段也是正文，同样应该有标点符号结尾。');
  ok(r.every(x => x.type === 'p'), '无标题时全部为段落');
}

console.log('\n=== 5. splitChapters ===');
{
  const txt = '简介文字'.repeat(60) + '\n第一章 起始\n内容一\n第二章 发展\n内容二\n第三章 结束\n内容三\n';
  const ch = T.splitChapters(txt);
  ok(ch && ch.length >= 3, `切出章节数 = ${ch ? ch.length : 'null'}`);
  ok(ch.some(c => c.title.includes('第一章')), '包含「第一章」');
  ok(ch.some(c => c.title.includes('第三章')), '包含「第三章」');
  ok(!ch.some(c => c.body.includes('第二章')), '章节标题未混入正文');
}
ok(T.splitChapters('第1章 a\nx\n第2章 b\ny\n第3章 c\nz\n')?.length === 3, '阿拉伯数字章节号');
ok(T.splitChapters('Chapter 1\nfoo\nChapter 2\nbar\nChapter 3\nbaz\n')?.length === 3, '英文 Chapter 格式');
ok(T.splitChapters('随便一段没有章节标记的文本，只有一点点内容。') === null, '无标记 -> null');

console.log('\n=== 6. decodeBuffer 编码嗅探 ===');
{
  const buf = Buffer.from('这是一段中文测试文本，用于验证编码识别是否正确。', 'utf8');
  ok(T.decodeBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      .includes('这是一段中文测试'), 'UTF-8 正确解码');
}
{
  const b = Buffer.concat([Buffer.from([0xEF,0xBB,0xBF]), Buffer.from('带BOM的文本', 'utf8')]);
  eq(T.decodeBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
     '带BOM的文本', 'UTF-8 BOM 被剥离且不伤正文');
}
{
  const b = Buffer.concat([Buffer.from([0xEF,0xBB,0xBF]), Buffer.from('Hello', 'utf8')]);
  eq(T.decodeBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
     'Hello', 'UTF-8 BOM + 英文不丢首字母');
}
{
  const b = Buffer.from('首字必须完整', 'utf8');
  eq(T.decodeBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
     '首字必须完整', '无 BOM 时首字完整');
}
{
  const bytes = Uint8Array.from([0xD5,0xE2,0xCA,0xC7,0xD6,0xD0,0xCE,0xC4]);
  const r = T.decodeBuffer(bytes.buffer);
  ok(typeof r === 'string' && r.length > 0, `GBK 字节解码未崩溃 -> ${JSON.stringify(r)}`);
}

console.log('\n=== 7. stripTags / unescapeXML ===');
eq(T.unescapeXML('&lt;p&gt; &amp; &quot;x&quot; &#39; &#x4E2D;'), '<p> & "x" \' 中', 'XML 实体');
eq(T.stripTags('<p>第一段</p><p>第二段</p>'), '第一段\n第二段', 'p 标签转换行');
eq(T.stripTags('<div>a<br>b</div>'), 'a\nb', 'br 转换行');
ok(!T.stripTags('<script>alert(1)</script>正文').includes('alert'), 'script 内容被剔除');
ok(!T.stripTags('<style>.x{color:red}</style>正文').includes('color'), 'style 内容被剔除');
eq(T.stripTags('<p>中文&nbsp;空格</p>'), '中文 空格', 'nbsp 归一化');
eq(T.stripTags('<html><head><title>第一章</title></head><body><p>正文</p></body></html>'),
   '正文', 'head/title 不进正文');
eq(T.stripTags('<head><title>目录</title></head><body><h1>目录</h1><p>第一章</p></body></html>'),
   '目录\n第一章', 'title 与 h1 不重复拼接');
eq(T.stripTags('<title>孤儿标题</title><p>正文</p>'), '正文', '无 head 包裹的 title 也被剔除');
ok(!T.stripTags('<noscript>n</noscript><p>x</p>').includes('n'), 'noscript 被剔除');
ok(!T.stripTags('<svg><text>s</text></svg><p>x</p>').includes('s'), 'svg 被剔除');

console.log('\n=== 8. normalizeText ===');
eq(T.normalizeText('a\r\nb'), 'a\nb', 'CRLF 归一');
eq(T.normalizeText('a\n\n\n\n\nb'), 'a\n\nb', '多余空行折叠');
eq(T.normalizeText('  前后空白  '), '前后空白', '首尾去空白');

console.log('\n=== 9. 中文（CJK）锚定节奏 ===');
{
  // ★ 规则（2026-10）：结构锚点（标点后首字 / 段首首字，长度 1）
  //   + 词语锚点（句中实词，长度 = 整个词）。
  //   所以无标点长句也会有若干锚点（句中实词被锚），不再只有段首一个。
  const cn = '这是一种通过视觉引导提升阅读效率的排版方式';
  const segs = segsOf(T.bionicFragment(cn, 3, document));
  eq(textOf(segs), cn, '中文文本无损');
  const headChars = segs.filter(s => s[1]).reduce((a, s) => a + s[0].length, 0);
  ok(headChars < cn.length, `高亮字数 ${headChars} < 总字数 ${cn.length}（未整句加粗）`);
  const marks = [];
  let idx = 0;
  for (const [t, h] of segs) { if (h) for (let i = 0; i < t.length; i++) marks.push(idx + i); idx += t.length; }
  ok(marks.length >= 1, `无标点句产生 ${marks.length} 个锚点（段首 + 句中实词）`);
  ok(marks[0] === 0, '段首有锚点');
}
{
  // 标点之后必须有锚点 —— 用户明确要求的规则
  const withPunct = '前面的话，后面的话。最后一句';
  const segs = segsOf(T.bionicFragment(withPunct, 3, document));
  const marks = [];
  let idx = 0;
  for (const [t, h] of segs) { if (h) for (let i = 0; i < t.length; i++) marks.push(idx + i); idx += t.length; }
  const after = p => withPunct.indexOf(p) + 1;
  ok(marks.includes(after('，')), `逗号后「${withPunct[after('，')]}」是锚点`);
  ok(marks.includes(after('。')), `句号后「${withPunct[after('。')]}」是锚点`);
}
{
  const mix = '使用 Bionic Reading 阅读中文与 English';
  eq(textOf(segsOf(T.bionicFragment(mix, 3, document))), mix, '中英混排无损');
  const html = T.bionicToHTML(mix, 3, s => s);
  ok(html.includes('>Bi</span>'), '英文按前缀切分（Bi|onic）');
  ok(html.includes('>Re</span>'), '第二个英文词也正确');
}
{
  for (const s of ['中文测试内容', 'Hello world 混排 test', '标点，测试！OK?']) {
    const domSegs = segsOf(T.bionicFragment(s, 3, document));
    const html = T.bionicToHTML(s, 3, x => x);
    const htmlSegs = [];
    const re = /<span class="br-(head|tail)">([\s\S]*?)<\/span>|([^<]+)/g;
    let mm;
    while ((mm = re.exec(html)) !== null) {
      if (mm[1]) htmlSegs.push([mm[2], mm[1] === 'head' ? 1 : 0]);
      else if (mm[3]) htmlSegs.push([mm[3], 0]);
    }
    const merge = arr => {
      const r = [];
      for (const [t, h] of arr) {
        if (r.length && r[r.length - 1][1] === h) r[r.length - 1][0] += t;
        else r.push([t, h]);
      }
      return r.filter(x => x[0]);
    };
    eq(merge(htmlSegs), merge(domSegs), `DOM 与 HTML 输出一致: ${JSON.stringify(s.slice(0, 18))}`);
  }
}
{
  const jp = 'これはテストです';
  eq(textOf(segsOf(T.bionicFragment(jp, 3, document))), jp, '日文假名无损');
  ok(!T.HAN_RE.test('テスト'), '假名不被识别为汉字');
  ok(T.HAN_RE.test('中文'), '汉字被正确识别');
}
{
  // ★ 强度**影响**中文锚点密度：句中词语锚点随强度变密
  //   （结构锚点由标点决定，不受强度影响；词语锚点密度由强度表控制。）
  const cn = '这是一个用来测试不同强度下锚点密度差异的中文句子内容';
  const density = s => segsOf(T.bionicFragment(cn, s, document))
    .filter(x => x[1]).reduce((a, x) => a + x[0].length, 0);
  const d1 = density(1), d3 = density(3), d5 = density(5);
  ok(d1 <= d3 && d3 <= d5,
     `强度越高中文锚点越密（${d1} <= ${d3} <= ${d5}）`);

  // 有标点的文本：每个小句开头都必须有锚点（与强度无关）
  const cn2 = '第一句内容，第二句内容。第三句内容';
  const hasHeadAt = (s, k) => {
    const segs = segsOf(T.bionicFragment(cn2, s, document));
    let idx = 0;
    for (const [t, h] of segs) {
      if (h && idx <= k && k < idx + t.length) return true;
      idx += t.length;
    }
    return false;
  };
  for (const s of [1, 5]) {
    ok(hasHeadAt(s, 0), `强度 ${s}：段首是锚点`);
    ok(hasHeadAt(s, cn2.indexOf('，') + 1), `强度 ${s}：逗号后是锚点`);
    ok(hasHeadAt(s, cn2.indexOf('。') + 1), `强度 ${s}：句号后是锚点`);
  }
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
