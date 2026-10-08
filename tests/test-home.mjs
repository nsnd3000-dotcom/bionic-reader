// 验证"返回首页 / 换一本书"
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}  期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`));

const dom = new JSDOM(html, {
  url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(win) {
    win.JSZip = JSZip;
    win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    Object.defineProperty(win, 'innerWidth', { value: 1400, writable: true });
    win.Element.prototype.scrollIntoView = function(){};
    win.HTMLElement.prototype.scrollIntoView = function(){};
    win.confirm = () => true;   // 自动确认
  },
});
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const $$ = s => [...doc.querySelectorAll(s)];

await new Promise(r => setTimeout(r, 150));

console.log('\n=== A. 未打开书时，首页按钮应隐藏 ===');
ok(!!$('#btnHome'), '「换一本」按钮存在');
eq($('#btnHome').hidden, true, '未打开书时隐藏');
ok(!!$('#btnBrand'), '左上角 logo 可点');
ok(!!$('#btnHome2'), '设置面板里的「打开另一本书」存在');

console.log('\n=== B. 打开示例文本后按钮出现 ===');
$('#btnDemo').click();
await new Promise(r => setTimeout(r, 400));
eq($('#btnHome').hidden, false, '打开书后「换一本」显示');
eq($('#btnBrand').hidden, false, 'logo 仍可见');
ok($('#reader').children.length > 0, '正文已渲染');

console.log('\n=== C. 点「换一本」回到首页 ===');
{
  $('#btnHome').click();
  await new Promise(r => setTimeout(r, 200));
  eq($('#btnHome').hidden, true, '「换一本」重新隐藏');
  eq($('#empty').classList.contains('hidden'), false, '空状态重新显示');
  eq($('#reader').children.length, 0, '正文已清空');
  eq($('#tocList').children.length, 0, '目录已清空');
  eq($('#bookTitle').textContent, '未打开书籍', '标题重置');
  eq($('#progress').style.width, '0%', '进度条归零');
}

console.log('\n=== D. logo 也能回首页 ===');
{
  $('#btnDemo').click();
  await new Promise(r => setTimeout(r, 350));
  eq($('#btnHome').hidden, false, '（前置）已打开书');
  $('#btnBrand').click();
  await new Promise(r => setTimeout(r, 200));
  eq($('#empty').classList.contains('hidden'), false, '点 logo 回到首页');
}

console.log('\n=== E. 取消确认时不应离开 ===');
{
  window.confirm = () => false;
  $('#btnDemo').click();
  await new Promise(r => setTimeout(r, 350));
  $('#btnHome').click();
  await new Promise(r => setTimeout(r, 150));
  eq($('#empty').classList.contains('hidden'), true, '取消后仍停留在阅读界面');
  eq($('#reader').children.length > 0, true, '正文未被清空');
  window.confirm = () => true;
}

console.log('\n=== F. 回到首页后还能再打开书 ===');
{
  $('#btnDemo').click();
  await new Promise(r => setTimeout(r, 350));
  ok($('#reader').children.length > 0, '再次打开成功');
  ok($$('#tocList .toc-item').length > 0, '目录重新生成');
}

console.log('\n=== G. H 快捷键 ===');
{
  const ev = k => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  ev('h');
  await new Promise(r => setTimeout(r, 200));
  eq($('#empty').classList.contains('hidden'), false, 'H 键回到首页');

  // 未打开书时按 H 应打开文件选择，而不是报错
  let opened = false;
  const input = $('#fileInput');
  const orig = input.click.bind(input);
  input.click = () => { opened = true; };
  ev('h');
  await new Promise(r => setTimeout(r, 120));
  ok(opened, '首页按 H 触发「选择文件」');
  input.click = orig;
}

console.log('\n=== H. 设置面板里的入口 ===');
{
  $('#btnDemo').click();
  await new Promise(r => setTimeout(r, 350));
  $('#btnHome2').click();
  await new Promise(r => setTimeout(r, 200));
  eq($('#empty').classList.contains('hidden'), false, '面板按钮也能回首页');
  // 首页时点它应直接打开文件选择
  let opened = false;
  const input = $('#fileInput');
  const orig = input.click.bind(input);
  input.click = () => { opened = true; };
  $('#btnHome2').click();
  await new Promise(r => setTimeout(r, 120));
  ok(opened, '首页时点它触发「选择文件」');
  input.click = orig;
}

console.log('\n=== I. 回首页不清除用户设置 ===');
{
  $('#rSize').value = '26';
  $('#rSize').dispatchEvent(new window.Event('input', { bubbles: true }));
  $('#btnDemo').click();
  await new Promise(r => setTimeout(r, 350));
  $('#btnHome').click();
  await new Promise(r => setTimeout(r, 200));
  eq($('#rSize').value, '26', '字号设置保留');
  eq(doc.documentElement.style.getPropertyValue('--reader-size'), '26px', 'CSS 变量保留');
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
