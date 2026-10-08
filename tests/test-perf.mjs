// 性能压测：百万字级的书，测解析时长与单章渲染耗时
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const BIG = new URL('./big.epub', import.meta.url);
if (!existsSync(BIG)) {
  console.error('缺少 big.epub，请先运行：node make-big-epub.mjs');
  process.exit(1);
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
await new Promise(r => setTimeout(r, 150));

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));

const buf = readFileSync(BIG);
console.log(`\n测试文件：${(buf.length / 1024 / 1024).toFixed(2)} MB，120 章\n`);

console.log('=== 解析性能 ===');
const t0 = Date.now();
const file = new window.File([buf], '大部头.epub', { type: 'application/epub+zip' });
const input = $('#fileInput');
Object.defineProperty(input, 'files', { value: [file], configurable: true });

input.dispatchEvent(new window.Event('change', { bubbles: true }));
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 200));
  if (!$('#loading').classList.contains('on') && $('#reader').children.length > 0) break;
}
const parseMs = Date.now() - t0;

const items = [...doc.querySelectorAll('#tocList .toc-item')];
console.log(`  整书解析 + 首章渲染总耗时：${parseMs} ms`);
console.log(`  章节数：${items.length}`);
ok(items.length === 120, `解析出 120 章（实际 ${items.length}）`);
ok(parseMs < 30000, `解析耗时 ${parseMs}ms < 30s`);
ok($('#reader').children.length > 0, `首章渲染出 ${$('#reader').children.length} 个块`);

const heads = doc.querySelectorAll('#reader .br-head').length;
console.log(`  首章 br-head 节点数：${heads}`);
ok(heads > 100, '首章应用了仿生高亮');

console.log('\n=== 单章渲染性能（连续翻 10 章） ===');
const times = [];
for (let i = 1; i <= 10; i++) {
  const btn = [...doc.querySelectorAll('#tocList .toc-item')][i * 5];
  if (!btn) continue;
  const s = Date.now();
  btn.click();
  let waited = 0;
  while (waited < 8000) {
    await new Promise(r => setTimeout(r, 25));
    waited += 25;
    const act = doc.querySelectorAll('#tocList .toc-item.active');
    if (act.length && act[0] === btn && $('#reader').children.length > 5) break;
  }
  times.push(Date.now() - s);
}
console.log(`  各章耗时(ms)：${times.join(', ')}`);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const max = Math.max(...times);
console.log(`  平均 ${avg.toFixed(0)} ms，最慢 ${max} ms`);
ok(avg < 2500, `平均单章渲染 ${avg.toFixed(0)}ms < 2500ms`);
ok(max < 8000, `最慢单章 ${max}ms < 8000ms`);

console.log('\n=== 内存/DOM 规模控制 ===');
{
  const total = $('#reader').querySelectorAll('*').length;
  console.log(`  当前 DOM 元素数：${total}（仅当前章，全书已回收）`);
  ok(total < 60000, `单章 DOM 元素 ${total} < 60000（未全量渲染全书）`);
  console.log(`  若全量渲染全书估计约 ${(total * 120 / 10000).toFixed(0)} 万节点 -> 必然卡死，故分章是必需的`);
}

console.log('\n=== 切换强度时的重绘性能 ===');
{
  const s = Date.now();
  $('#rStrength').value = '5';
  $('#rStrength').dispatchEvent(new window.Event('input', { bubbles: true }));
  let waited = 0;
  while (waited < 10000) { await new Promise(r => setTimeout(r, 25)); waited += 25; if (waited > 400) break; }
  const ms = Date.now() - s;
  console.log(`  强度切换 + 重绘耗时：${ms} ms`);
  ok(ms < 5000, `强度重绘 ${ms}ms < 5000ms`);
}

console.log('\n=== 搜索目录 ===');
{
  const s = Date.now();
  $('#tocSearch').value = '第7章';
  $('#tocSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const found = doc.querySelectorAll('#tocList .toc-item').length;
  console.log(`  搜索"第7章"命中 ${found} 项，耗时 ${Date.now() - s} ms`);
  ok(found > 0 && found < 120, '搜索正确过滤');
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
