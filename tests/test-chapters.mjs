// 章节标题正则的边界测试：误报（正文被当标题）与漏报（真标题未识别）
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/<script>\s*\/\* =+\s*\n\s*Bionic Reader[\s\S]*?\n<\/script>/);
let code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
code = code.replace(/document\.readyState === 'loading'[\s\S]*$/, '');
code = code.replace(/\}\)\(\);\s*$/, '');
code = code.replace(/^\s*\(\(\)\s*=>\s*\{/, '');
code += `\nglobalThis.__T = { CHAPTER_RE, splitChapters };\n})();\n`;

const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://example.com' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
new Function(code)();
const { CHAPTER_RE, splitChapters } = globalThis.__T;

let pass = 0, fail = 0;
const matches = s => { CHAPTER_RE.lastIndex = 0; return CHAPTER_RE.test(s); };
function shouldMatch(s, note) {
  matches(s) ? (pass++, console.log(`  ok   识别   ${JSON.stringify(s)}${note ? '  ' + note : ''}`))
             : (fail++, console.log(`  FAIL 漏报   ${JSON.stringify(s)}${note ? '  ' + note : ''}`));
}
function shouldNot(s, note) {
  !matches(s) ? (pass++, console.log(`  ok   排除   ${JSON.stringify(s)}${note ? '  ' + note : ''}`))
              : (fail++, console.log(`  FAIL 误报   ${JSON.stringify(s)}${note ? '  ' + note : ''}`));
}

console.log('\n=== 应识别的真标题 ===');
shouldMatch('第一章 起始');
shouldMatch('第1章');
shouldMatch('第 12 章 风起');
shouldMatch('第一章：开端');
shouldMatch('第一章、开端');
shouldMatch('第3节 说明');
shouldMatch('第三回 宴桃园豪杰三结义');
shouldMatch('第二卷 少年游');
shouldMatch('序章');
shouldMatch('序言');
shouldMatch('楔子');
shouldMatch('引子');
shouldMatch('前言');
shouldMatch('尾声');
shouldMatch('后记');
shouldMatch('番外');
shouldMatch('番外3');
shouldMatch('Chapter 1');
shouldMatch('Chapter 12 The Beginning');
shouldMatch('CHAPTER IV');
shouldMatch('　第一章 起始', '（全角空格缩进）');
shouldMatch('    第一章 起始', '（半角空格缩进）');

console.log('\n=== 应排除的正文（关键：误报会毁掉整本书的目录） ===');
shouldNot('第一章正文内容，验证导入。', '<- 原始 bug');
shouldNot('第一章讲述了一个关于勇气的故事，主角在困境中成长。');
shouldNot('第二章的内容主要围绕技术细节展开，包含了大量实现说明。');
shouldNot('这一段普通正文没有任何章节标记，应该被排除在外。');
shouldNot('他在第三章里提到了这个观点，但并没有展开论述。', '<- 句中出现，非行首');
shouldNot('关于第一章的讨论到此结束，我们下回继续。');
shouldNot('第三个问题是什么？');
shouldNot('第1章的内容');
shouldNot('卷起袖子加油干');
shouldNot('序章里的伏笔在后文得到了呼应。');
shouldNot('Chapter 1 explains the whole idea in great detail.');
shouldNot('番外篇的内容非常精彩，值得一读。');

console.log('\n=== splitChapters 端到端边界 ===');
{
  const txt = '简介。'.repeat(200) + '\n第一章 起始\n第一章正文内容，验证导入。\n第二章 发展\n第二章正文内容。\n第三章 终结\n第三章正文内容。\n';
  const ch = splitChapters(txt);
  const titles = ch ? ch.map(c => c.title) : [];
  console.log('     章节标题列表：', JSON.stringify(titles));
  const bad = titles.filter(t => t.includes('正文内容'));
  if (bad.length === 0) { pass++; console.log('  ok   正文行未被误判为章节标题'); }
  else { fail++; console.log(`  FAIL 仍有 ${bad.length} 行正文被当作标题: ${JSON.stringify(bad)}`); }
  const okBody = ch && ch.some(c => c.body.includes('第一章正文内容'));
  okBody ? (pass++, console.log('  ok   正文归入章节正文中')) : (fail++, console.log('  FAIL 正文丢失'));
}
{
  const ch = splitChapters('第一章\n内容一\n第二章\n内容二\n第三章\n内容三\n');
  (ch && ch.length === 3) ? (pass++, console.log('  ok   无标题的纯章节标记（3 章）'))
                          : (fail++, console.log(`  FAIL 纯章节标记切分错误: ${ch ? ch.length : 'null'}`));
}
{
  const ch = splitChapters('第一卷 风起\n第一章 相遇\n内容\n第二章 分离\n内容\n');
  (ch && ch.length === 3) ? (pass++, console.log('  ok   卷/章混排（3 章）'))
                          : (fail++, console.log(`  FAIL 卷章混排: ${ch ? ch.length : 'null'}`));
}
{
  const ch = splitChapters('只有一个标题\n第一章 孤独\n正文内容若干。\n');
  (ch === null) ? (pass++, console.log('  ok   章节数不足时回退整篇（null）'))
                : (fail++, console.log(`  FAIL 应返回 null，实际 ${ch.length} 章`));
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
