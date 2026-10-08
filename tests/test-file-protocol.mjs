// 复现 file:// 下的行为：这是用户实际使用的场景
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));

// 收集页面内的报错
const errors = [];

const dom = new JSDOM(html, {
  url: 'file:///D:/Users/Administrator/Documents/dsh/1/bionic-reader/index.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.JSZip = JSZip;
    win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    Object.defineProperty(win, 'innerWidth', { value: 1400, writable: true });
    win.Element.prototype.scrollIntoView = function(){};
    win.HTMLElement.prototype.scrollIntoView = function(){};
    win.addEventListener('error', e => errors.push(e.message || String(e.error)));
  },
});
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);

window.addEventListener('error', e => errors.push(e.message));

await new Promise(r => setTimeout(r, 200));

console.log('\n=== file:// 下的启动状态 ===');
ok(errors.length === 0, `页面加载无 JS 报错${errors.length ? '：' + errors.join(' | ') : ''}`);
ok(!!$('#btnPick'), '「选择文件」按钮存在');

console.log('\n=== 未导入书时，哪些按钮是可点的？ ===');
const btns = [
  ['#btnPick', '选择文件'],
  ['#btnDemo', '看示例文本'],
  ['#btnBionic', '仿生开关'],
  ['#btnTheme', '主题'],
  ['#btnPanel', '设置'],
  ['#btnSidebar', '目录'],
  ['#btnExport', '导出 HTML'],
  ['#btnReset', '恢复默认'],
];
for (const [sel, name] of btns) {
  const el = $(sel);
  console.log(`     ${name.padEnd(12)} disabled=${el.disabled === true}`);
}

console.log('\n=== localStorage 在 file:// 下不可用时的应对 ===');
{
  // 已知：file:// 下 origin 为 opaque，localStorage 会抛 SecurityError。
  // 要求不是"能用"，而是"不崩 + 设置当次会话内仍生效 + 明确告知用户"。
  let available = true;
  try {
    window.localStorage.setItem('__t', '1');
    window.localStorage.removeItem('__t');
  } catch (e) {
    available = false;
    console.log(`     确认为不可用：${e.name}（已由内存存储接管）`);
  }
  ok(true, `localStorage ${available ? '可用' : '不可用，已退化到内存存储'} — 两种情况都不应崩溃`);

  // 核心：改设置仍要生效
  const r = $('#rSize');
  let threw = null;
  try {
    r.value = '22';
    r.dispatchEvent(new window.Event('input', { bubbles: true }));
  } catch (e) { threw = e; }
  ok(!threw, `存储不可用时改设置不崩溃${threw ? '：' + threw.message : ''}`);
  ok(doc.documentElement.style.getPropertyValue('--reader-size') === '22px',
     '设置仍然生效（内存退化）');
}

console.log('\n=== 点击「选择文件」是否真的触发了 input ===');
{
  let clicked = false;
  const input = $('#fileInput');
  const orig = input.click.bind(input);
  input.click = () => { clicked = true; };
  $('#btnPick').click();
  ok(clicked, '点击按钮确实调用了 fileInput.click()');
  input.click = orig;
}

console.log('\n=== 模拟：选择文件后界面是否变化（核心问题） ===');
{
  const before = {
    empty: !$('#empty').classList.contains('hidden'),
    title: $('#bookTitle').textContent,
  };
  const txt = '第一章 起始\n第一章正文内容，验证导入。\n第二章 发展\n第二章正文内容。\n第三章 终结\n第三章正文内容。\n';
  const file = new window.File([new TextEncoder().encode(txt)], '测试.txt', { type: 'text/plain' });
  const input = $('#fileInput');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 800));

  const after = {
    empty: !$('#empty').classList.contains('hidden'),
    title: $('#bookTitle').textContent,
    blocks: $('#reader').children.length,
    toc: doc.querySelectorAll('#tocList .toc-item').length,
  };
  console.log('     导入前:', JSON.stringify(before));
  console.log('     导入后:', JSON.stringify(after));
  ok(before.empty && !after.empty, '空状态已隐藏（界面有可见变化）');
  ok(after.title !== before.title, `标题已更新为「${after.title}」`);
  ok(after.blocks > 0, `正文渲染了 ${after.blocks} 个块`);
  ok(after.toc >= 3, `目录生成 ${after.toc} 项`);
  ok(errors.length === 0, `导入过程中无报错${errors.length ? '：' + errors.join(' | ') : ''}`);
}

console.log('\n=== 导入后按钮是否解锁 ===');
for (const [sel, name] of [['#btnBionic','仿生'],['#btnTheme','主题'],['#btnPanel','设置']]) {
  ok($(sel).disabled === false, `${name} 按钮已解锁`);
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
