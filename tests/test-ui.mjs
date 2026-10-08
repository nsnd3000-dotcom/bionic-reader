// 端到端渲染测试：在真实 DOM 中跑整个应用，验证 UI 交互与不变量
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
  url: 'https://example.com/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.JSZip = JSZip;
    win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    Object.defineProperty(win, 'innerWidth', { value: 1400, writable: true });
    // jsdom 未实现 scrollIntoView（真实浏览器均有），补桩
    win.Element.prototype.scrollIntoView = function () {};
    win.HTMLElement.prototype.scrollIntoView = function () {};
  },
});
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const $$ = s => [...doc.querySelectorAll(s)];

await new Promise(r => setTimeout(r, 120));

console.log('\n=== 1. 应用启动 ===');
ok(!!$('#reader'), '阅读容器存在');
ok(!!$('#tocList'), '目录容器存在');
ok($('#empty') && !$('#empty').classList.contains('hidden'), '初始显示空状态');
// 改版后：顶栏按钮始终可点，点击会给出提示（不再静默无反应）
ok($('#btnBionic').disabled === false, '未打开书时仿生按钮仍可点击');
ok($('#btnPanel').disabled === false, '未打开书时设置按钮仍可点击');
ok($$('#swatches .swatch').length > 0, `色块已生成 (${$$('#swatches .swatch').length} 个)`);
eq($('#rStrength').value, '3', '强度默认值');
eq($('#vStrength').textContent, '中', '强度标签同步');

console.log('\n=== 2. 加载示例文本 ===');
$('#btnDemo').click();
await new Promise(r => setTimeout(r, 400));

ok($('#empty').classList.contains('hidden'), '空状态已隐藏');
ok($('#reader').children.length > 0, `渲染出 ${$('#reader').children.length} 个块级元素`);
ok(!$('#btnBionic').disabled, '仿生按钮已启用');
ok($('#btnBionic').classList.contains('on'), '仿生开关默认开启');

const heads = $$('#reader .br-head');
const tails = $$('#reader .br-tail');
ok(heads.length > 50, `生成 br-head 数量 = ${heads.length}`);
ok(tails.length > 0, `生成 br-tail 数量 = ${tails.length}`);
// 中文走步长模式，末尾可能是高亮字，故 head/tail 数量允许不等
ok(Math.abs(heads.length - tails.length) <= heads.length * 0.3,
   `head(${heads.length}) 与 tail(${tails.length}) 数量大体相当`);
ok($$('#reader h3').length > 0, '识别出小标题');

console.log('\n=== 3. 文本无损（渲染后仍能还原原文） ===');
{
  const rendered = $('#reader').textContent;
  ok(rendered.includes('仿生阅读是一种通过视觉引导'), '正文内容完整');
  ok(rendered.includes('Bionic Reading'), '英文内容保留');
  ok(!rendered.includes('<span'), '没有标签泄漏为文本');
  const emptySpan = [...heads, ...tails].filter(s => s.textContent === '').length;
  eq(emptySpan, 0, '不存在空的高亮 span');
}

console.log('\n=== 4. 仿生开关 ===');
{
  const before = $$('#reader .br-head').length;
  $('#btnBionic').click();
  await new Promise(r => setTimeout(r, 400));
  eq($$('#reader .br-head').length, 0, '关闭后无高亮 span');
  ok($('#reader').textContent.includes('仿生阅读是一种通过视觉引导'), '关闭后文本仍完整');
  $('#btnBionic').click();
  await new Promise(r => setTimeout(r, 400));
  eq($$('#reader .br-head').length, before, '重新开启后恢复同样的高亮数');
}

console.log('\n=== 5. 强度调节 ===');
{
  const counts = {};
  for (const s of [1, 3, 5]) {
    $('#rStrength').value = String(s);
    $('#rStrength').dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
    counts[s] = $$('#reader .br-head').reduce((a, el) => a + el.textContent.length, 0);
  }
  ok(counts[1] < counts[3], `强度 1 高亮字数(${counts[1]}) < 强度 3 (${counts[3]})`);
  ok(counts[3] < counts[5], `强度 3 高亮字数(${counts[3]}) < 强度 5 (${counts[5]})`);
  $('#rStrength').value = '3';
  $('#rStrength').dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
}

console.log('\n=== 6. 排版参数写入 CSS 变量 ===');
{
  const root = doc.documentElement;
  $('#rSize').value = '24';
  $('#rSize').dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(root.style.getPropertyValue('--reader-size'), '24px', '字号变量更新');

  $('#rLh').value = '22';
  $('#rLh').dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(root.style.getPropertyValue('--reader-lh'), '2.20', '行高变量更新');

  $('#rWidth').value = '40';
  $('#rWidth').dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(root.style.getPropertyValue('--reader-width'), '40em', '行宽变量更新');

  $('#rTail').value = '70';
  $('#rTail').dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(root.style.getPropertyValue('--tail-opacity'), '0.70', '词尾透明度更新');
}

console.log('\n=== 7. 模式与主题切换 ===');
{
  const root = doc.documentElement;
  const modeBtn = $$('#segMode button').find(b => b.dataset.mode === 'color');
  modeBtn.click();
  eq(root.dataset.bionic, 'color', 'data-bionic = color');
  eq(root.style.getPropertyValue('--head-weight'), '400', '变色模式不加粗');
  ok(modeBtn.classList.contains('on'), '变色按钮高亮');

  const mixBtn = $$('#segMode button').find(b => b.dataset.mode === 'mix');
  mixBtn.click();
  eq(root.dataset.bionic, 'mix', 'data-bionic = mix');
  eq(root.style.getPropertyValue('--head-weight'), '700', '混合模式加粗');

  $$('#segTheme button').find(b => b.dataset.theme === 'dark').click();
  eq(root.dataset.theme, 'dark', '切换到暗色主题');
  $$('#segTheme button').find(b => b.dataset.theme === 'light').click();
  eq(root.dataset.theme, 'light', '切回亮色主题');
  $$('#segMode button').find(b => b.dataset.mode === 'bold').click();
  eq(root.dataset.bionic, 'bold', '切回加粗模式');
}

console.log('\n=== 8. 设置持久化 ===');
{
  $('#rSize').value = '21';
  $('#rSize').dispatchEvent(new window.Event('input', { bubbles: true }));
  const raw = window.localStorage.getItem('bionic.prefs.v1');
  ok(!!raw, '设置已写入 localStorage');
  const saved = JSON.parse(raw);
  eq(saved.size, 21, '字号被保存');
  ok('strength' in saved && 'tint' in saved && 'theme' in saved, '关键字段齐全');
}

console.log('\n=== 9. 恢复默认 ===');
{
  $('#btnReset').click();
  await new Promise(r => setTimeout(r, 300));
  eq($('#rSize').value, '19', '字号回到 19');
  eq(doc.documentElement.style.getPropertyValue('--reader-size'), '19px', 'CSS 变量同步复位');
}

console.log('\n=== 10. 目录交互 ===');
{
  ok($$('#tocList .toc-item').length > 0, '目录已生成条目');
  eq($$('#tocList .toc-item.active').length, 1, '有且仅有一个激活项');
}

console.log('\n=== 11. 快捷键 ===');
{
  const ev = k => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
  ok($('#btnBionic').classList.contains('on'), '（前置）仿生开启');
  ev('b');
  await new Promise(r => setTimeout(r, 300));
  ok(!$('#btnBionic').classList.contains('on'), 'B 键关闭仿生');
  ev('B');
  await new Promise(r => setTimeout(r, 300));
  ok($('#btnBionic').classList.contains('on'), 'Shift+B 重新开启');

  const panelBefore = $('#panel').classList.contains('hidden');
  ev('p');
  ok($('#panel').classList.contains('hidden') !== panelBefore, 'P 键切换设置面板');
  ev('Escape');
  ok($('#panel').classList.contains('hidden'), 'Esc 关闭面板');
}

console.log('\n=== 12. 导出 HTML ===');
{
  let captured = null;
  const OrigBlob = window.Blob;
  window.Blob = function (parts, opts) { captured = { parts, opts }; return new OrigBlob(parts, opts); };
  window.URL.createObjectURL = () => 'blob:fake';
  window.URL.revokeObjectURL = () => {};
  const origClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () {};

  $('#btnDemo').click();
  await new Promise(r => setTimeout(r, 400));
  $('#btnExport').click();
  await new Promise(r => setTimeout(r, 100));

  ok(!!captured, '导出生成了 Blob');
  if (captured) {
    const text = captured.parts.join('');
    ok(text.startsWith('<!DOCTYPE html>'), '导出内容是完整 HTML');
    ok(text.includes('br-head'), '导出包含仿生高亮 span');
    const plain = text.replace(/<[^>]+>/g, '');
    ok(plain.includes('仿生阅读是一种通过视觉引导提升阅读效率'), '导出包含正文（剥离标签后比对）');
    ok(!text.includes('undefined'), '导出无 undefined 泄漏');
    ok(captured.opts.type.includes('text/html'), 'Blob MIME 正确');
    ok(['html','head','body','style'].every(t => text.includes(`<${t}`)), '包含 html/head/body/style');
    ok((text.match(/<p>/g) || []).length > 0, '有段落标签');
    ok(!/<span class="br-head"><\/span>/.test(text), '无空的高亮 span');
    ok(plain.length > 800, `导出正文字符数 = ${plain.length}`);
  }
  window.Blob = OrigBlob;
  window.HTMLAnchorElement.prototype.click = origClick;
}

console.log('\n=== 12b. 导出时 HTML 转义 ===');
{
  let captured = null;
  const OrigBlob = window.Blob;
  window.Blob = function (parts, opts) { captured = { parts, opts }; return new OrigBlob(parts, opts); };
  window.HTMLAnchorElement.prototype.click = function () {};

  const evil = '第一章 测试\n<script>alert("xss")</script> 与 <b>标签</b> 以及 & 符号。\n第二段正文。\n';
  const file = new window.File([new TextEncoder().encode(evil)], 'evil.txt', { type: 'text/plain' });
  const input = $('#fileInput');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 600));
  $('#btnExport').click();
  await new Promise(r => setTimeout(r, 100));

  if (captured) {
    const text = captured.parts.join('');
    ok(!text.includes('<script>alert'), '危险 script 已被转义为实体');
    ok(text.includes('&lt;'), '尖括号被转义');
    ok(text.includes('&amp;'), '& 被转义');
  } else {
    ok(false, '未捕获导出内容');
  }
  window.Blob = OrigBlob;
}

console.log('\n=== 13. TXT 文件导入 ===');
{
  const txt = '简介说明文字。'.repeat(40) + '\n第一章 起始\n第一章正文内容，验证导入。\n第二章 发展\n第二章正文内容。\n第三章 终结\n第三章正文内容。\n';
  const file = new window.File([new TextEncoder().encode(txt)], '测试书籍.txt', { type: 'text/plain' });
  const input = $('#fileInput');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));

  const items = $$('#tocList .toc-item');
  const titles = items.map(el => el.textContent);
  console.log('     目录：', JSON.stringify(titles));
  ok(items.length >= 3 && items.length <= 4, `TXT 切出 ${items.length} 个章节条目（预期 3-4）`);
  ok(!titles.some(t => t.includes('正文内容')), '正文行没有被误判为章节标题');
  ok($('#bookTitle').textContent.includes('测试书籍'), `标题显示：${$('#bookTitle').textContent}`);
  const ch1 = items.find(el => el.textContent.includes('第一章 起始'));
  ok(!!ch1, '目录包含第一章 起始');
  if (ch1) {
    ch1.click();
    await new Promise(r => setTimeout(r, 400));
    ok($('#reader').textContent.includes('第一章正文内容'), '第一章内容已渲染');
  }
}

console.log('\n=== 14. 章节切换 ===');
{
  const items = $$('#tocList .toc-item');
  const idx = items.findIndex(el => el.textContent.includes('第二章'));
  ok(idx >= 0, '目录中存在第二章');
  if (idx >= 0) {
    items[idx].click();
    await new Promise(r => setTimeout(r, 500));
    ok($('#reader').textContent.includes('第二章正文内容'), '点击目录切换到第二章');
    ok($$('#tocList .toc-item.active').length === 1, '激活项唯一');
    ok($$('#tocList .toc-item')[idx].classList.contains('active'), '激活项正确');
  }
}

let epubFile = null;
console.log('\n=== 15. EPUB 文件导入 ===');
{
  const buf = readFileSync(new URL('./fixture.epub', import.meta.url));
  const file = new window.File([buf], '真实测试.epub', { type: 'application/epub+zip' });
  epubFile = file;
  const input = $('#fileInput');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));

  ok($('#bookTitle').textContent.includes('测试书籍 & 副标题'),
     `EPUB 书名正确：${$('#bookTitle').textContent}`);
  eq($$('#tocList .toc-item').length, 3, 'EPUB 目录 3 章');
  ok($('#reader').textContent.includes('第一章的正文内容'), 'EPUB 正文已渲染');
  ok($$('#reader .br-head').length > 0, 'EPUB 内容也应用了仿生高亮');
}

console.log('\n=== 16. 进度记忆 ===');
{
  const raw = window.localStorage.getItem('bionic.progress.v1');
  ok(!!raw, '进度已写入 localStorage');
  if (raw) {
    const p = JSON.parse(raw);
    ok(typeof p.chapter === 'number', '记录了章节号');
    ok(typeof p.ratio === 'number', '记录了滚动比例');
    eq(p.id, `真实测试.epub|${readFileSync(new URL('./fixture.epub', import.meta.url)).length}|${epubFile.lastModified}`,
       '进度 id 与文件对应');
  }
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
