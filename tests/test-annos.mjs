// 验证「荧光笔高亮 + 笔记批注 + 位置查询」：
//   划词出工具条 → 点色块生成 <mark class="anno"> 并存入 localStorage
//   → 重渲染（开关仿生）后高亮仍在 → 侧栏笔记列表可搜索可跳转
//   → 批注弹层可写笔记/改色/删除 → 重叠选区被拒绝
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));

const errors = [];
const dom = new JSDOM(html, {
  url: 'https://example.com/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
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
const $$ = s => [...doc.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
window.addEventListener('error', e => errors.push(e.message));

await sleep(150);
$('#btnDemo').click();
await sleep(500);

/* 在 el 里选一段文字（从第 skip 个字符起，取 len 个字符） */
function selectText(el, skip, len) {
  const tw = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
  let n, pos = 0, sNode = null, sOff = 0, eNode = null, eOff = 0;
  while ((n = tw.nextNode())) {
    const t0 = pos, t1 = pos + n.data.length;
    if (!sNode && t1 > skip) { sNode = n; sOff = skip - t0; }
    if (sNode && t1 >= skip + len) { eNode = n; eOff = skip + len - t0; break; }
    pos = t1;
  }
  if (!sNode || !eNode) return false;
  const r = doc.createRange();
  r.setStart(sNode, sOff);
  r.setEnd(eNode, eOff);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}
const stored = () => {
  try { return JSON.parse(window.localStorage.getItem('bionic.annos.v1') || '{}'); }
  catch (_) { return {}; }
};

console.log('\n=== A. 新 UI 元素齐备 ===');
ok(!!$('#selBar'), '荧光笔浮动工具条存在');
ok($$('#selSwatches .sel-dot').length === 6, `工具条色块 ${$$('#selSwatches .sel-dot').length} 个`);
ok(!!$('#selNote'), '「✎ 笔记」按钮存在');
ok(!!$('#annoPop') && !!$('#apNote') && !!$('#apSave') && !!$('#apDelete'), '批注弹层齐备');
ok($$('#apColors .ap-dot').length === 6, '批注层改色色块 6 个');
ok(!!$('#tabToc') && !!$('#tabAnno') && !!$('#annoList') && !!$('#annoSearch'), '侧栏 目录/笔记 双页签齐备');
ok(!!$('#btnAnnos'), '顶栏笔记按钮存在');

console.log('\n=== B. 划词 → 工具条 → 高亮 ===');
const para = $('p[data-pidx="1"]');
ok(!!para, '示例文本段落已渲染（带 data-pidx）');
ok(selectText(para, 2, 12), '能在段落里建立选区');
para.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
await sleep(60);
ok(!$('#selBar').hidden, '划词后荧光笔工具条出现');

$('#selSwatches .sel-dot').click();          // 选第一个色（黄）
await sleep(400);
const marks1 = $$('mark.anno');
ok(marks1.length >= 1, `高亮 <mark> 已贴上（${marks1.length} 段）`);
ok(marks1[0].style.getPropertyValue('--ac') !== '', '高亮带着自己的颜色变量');
ok((stored().demo || []).length === 1, '已按书 id 存入 localStorage');
ok((stored().demo || [])[0].text.length > 0, '存储里带了高亮摘录文本');

console.log('\n=== C. 重渲染后高亮仍在（坐标不依赖仿生切分）===');
$('#btnBionic').click();                     // 关掉仿生 → 整章重绘
await sleep(400);
ok($$('mark.anno').length >= 1, '关仿生重绘后高亮仍在');
$('#btnBionic').click();                     // 再开回来
await sleep(400);
ok($$('mark.anno').length >= 1, '开仿生重绘后高亮仍在');

console.log('\n=== D. 笔记页签：列表 / 搜索 / 计数 ===');
$('#tabAnno').click();
await sleep(50);
ok(!$('#annoPane').hidden && $('#tocPane').hidden, '切到笔记页签');
ok(!$('#annoCount').hidden && $('#annoCount').textContent === '1', '页签计数徽标 = 1');
ok($$('#annoList .anno-item').length === 1, '笔记列表列出 1 条');
ok($('#annoList .ai-ch').textContent.includes('说明'), '列表项带章节名');
$('#annoSearch').value = '不存在的词xyz';
$('#annoSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
await sleep(250);
ok($$('#annoList .anno-item').length === 0, '搜索能过滤掉不匹配项');
ok(!!$('#annoList .anno-empty'), '无匹配时显示空态提示');
$('#annoSearch').value = '';
$('#annoSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
await sleep(250);
ok($$('#annoList .anno-item').length === 1, '清空搜索后列表恢复');
$('#annoList .anno-item').click();           // 点击跳转（scrollIntoView 已桩掉）
await sleep(200);
ok(errors.length === 0, '点击跳转无报错');

console.log('\n=== E. 批注弹层：写笔记 / 改色 / 删除 ===');
$$('mark.anno')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(50);
ok(!$('#annoPop').hidden, '点击高亮弹出批注层');
ok($('#apExcerpt').textContent.length > 0, '批注层显示摘录');
$('#apNote').value = '这段讲锚定的作用，重点。';
$('#apSave').click();
await sleep(400);
ok((stored().demo || [])[0].note.includes('锚定'), '笔记已持久化');
ok($$('#annoList .ai-note').length === 1, '列表项显示笔记摘要');
ok($$('mark.anno.has-note').length >= 1, '带笔记的高亮有视觉记号');

$$('mark.anno')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(50);
$$('#apColors .ap-dot')[2].click();          // 改成红色
await sleep(50);
ok((stored().demo || [])[0].color === $$('#apColors .ap-dot')[2].dataset.c, '改色已持久化');
$('#apClose').click();
ok($('#annoPop').hidden, '批注层可关闭');

console.log('\n=== F. 重叠选区被拒绝 ===');
{
  const before = (stored().demo || []).length;
  const p2 = $('p[data-pidx="1"]');
  // 已高亮的是 [2,14)，这里选 [8,20) 必然重叠
  ok(selectText(p2, 8, 12), '建立重叠选区');
  p2.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  await sleep(60);
  $('#selSwatches .sel-dot').click();
  await sleep(300);
  ok((stored().demo || []).length === before, '重叠高亮没有落库');
}

console.log('\n=== G. 删除高亮 ===');
window.getSelection().removeAllRanges();   // F 里被拒的选区还在，真实点击会先坍缩它
$$('mark.anno')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await sleep(50);
$('#apDelete').click();
await sleep(400);
ok($$('mark.anno').length === 0, '删除后正文无高亮');
ok(!(stored().demo || []).length, '存储已清空');
ok($('#annoCount').hidden, '计数徽标随清空隐藏');

console.log(`\n${errors.length ? '页面报错：' + errors.join(' | ') : '无页面报错'}`);
ok(errors.length === 0, '全程无 JS 报错');

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
