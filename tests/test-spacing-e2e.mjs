// 端到端验证：在真实 DOM 里跑起应用，检查渲染出的锚点结构是否符合修复目标
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

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
const $$ = s => [...doc.querySelectorAll(s)];

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));

await new Promise(r => setTimeout(r, 150));
$('#btnDemo').click();
await new Promise(r => setTimeout(r, 600));

console.log('\n=== 1. 渲染出的锚点结构 ===');
const heads = $$('#reader .br-head');
const hanHeads = heads.filter(h => /^[\p{Script=Han}]$/u.test(h.textContent));
const multiHan = heads.filter(h => [...h.textContent].length > 1 && /^[\p{Script=Han}]+$/u.test(h.textContent));
console.log(`  br-head 总数 ${heads.length}，其中单汉字锚点 ${hanHeads.length}`);
console.log(`  含汉字的 head：${heads.filter(h => /[\p{Script=Han}]/u.test(h.textContent)).length}`);
ok(heads.length > 50, `生成了足够的锚点（${heads.length}）`);
// ★ 规则变更（2026-10）：句中**词语**锚点故意是整个词一起加粗
//   （「引导」而不是「【引】导」），所以"禁止多字锚点"已作废。
//   新的防线在 test-anchors.mjs：多字锚点必须是分词器给出的完整词。
//   这里只确认多字锚点没有**过长**（超过 4 字的连续汉字加粗几乎一定是 bug）。
const tooLong = multiHan.filter(h => [...h.textContent].length > 4);
ok(tooLong.length === 0,
   `没有过长的汉字加粗区间（>4 字）：${tooLong.length} 个` +
   `${tooLong.length ? ' -> ' + tooLong.map(h => h.textContent).join('/') : ''}`);

console.log('\n=== 2. 文本无损 ===');
{
  const rendered = $('#reader').textContent;
  ok(rendered.includes('仿生阅读是一种通过视觉引导'), '正文完整');
  ok(rendered.includes('Bionic Reading'), '英文保留');
  ok(!rendered.includes('<span'), '无标签泄漏');
}

console.log('\n=== 3. 字距防线（真实计算样式）===');
{
  const h = $('#reader .br-head');
  const t = $('#reader .br-tail');
  const cs = window.getComputedStyle(h), ts = window.getComputedStyle(t);
  ok(cs.display !== 'inline-block', `锚点是普通内联：display=${cs.display}`);
  ok(cs.padding === '0px' || (cs.paddingLeft === '0px' && cs.paddingRight === '0px'), `锚点零 padding：${cs.padding}`);
  ok(cs.marginLeft === '0px' && cs.marginRight === '0px', `锚点零 margin：${cs.marginLeft}/${cs.marginRight}`);
  ok(cs.letterSpacing === ts.letterSpacing, `锚点与词尾字距一致：${cs.letterSpacing}`);
  ok(cs.wordSpacing === 'normal' || cs.wordSpacing === '0px', `word-spacing 复位：${cs.wordSpacing}`);
  // 全局合成设置必须在 #reader 上，保证加粗与常规同宽
  const rs = window.getComputedStyle($('#reader'));
  console.log(`  #reader font-synthesis-weight = ${rs.fontSynthesisWeight}`);
  ok(rs.fontSynthesisWeight === 'auto' || rs.fontSynthesisWeight === '', '显式锁定字体合成行为');
}

console.log('\n=== 4. 切换强度后锚点密度单调递增 ===');
{
  const density = {};
  for (const s of [1, 3, 5]) {
    $('#rStrength').value = String(s);
    $('#rStrength').dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
    density[s] = $$('#reader .br-head').length;
  }
  console.log(`  强度 1/3/5 的锚点数：${density[1]} / ${density[3]} / ${density[5]}`);
  ok(density[1] <= density[3] && density[3] <= density[5], '强度越大锚点越多');
}

console.log('\n=== 5. 两种对齐下都不引入额外字距 ===');
{
  for (const align of ['left', 'justify']) {
    $$('#segAlign button').find(b => b.dataset.align === align).click();
    await new Promise(r => setTimeout(r, 120));
    const cs = window.getComputedStyle($('#reader .br-head'));
    ok(cs.letterSpacing === window.getComputedStyle($('#reader .br-tail')).letterSpacing,
       `${align} 对齐下锚点与词尾字距仍一致`);
    ok(cs.paddingLeft === '0px', `${align} 对齐下锚点无 padding`);
  }
  $$('#segAlign button').find(b => b.dataset.align === 'left').click();
}

console.log('\n=== 6. 导出与屏幕渲染一致 ===');
{
  let captured = null;
  const OrigBlob = window.Blob;
  window.Blob = function (p, o) { captured = { parts: p }; return new OrigBlob(p, o); };
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function(){};
  $('#btnExport').click();
  await new Promise(r => setTimeout(r, 200));
  window.Blob = OrigBlob;
  ok(!!captured, '导出成功');
  if (captured) {
    const text = captured.parts.join('');
    ok(text.includes('word-spacing:normal'), '导出 CSS 含间距复位');
    ok(!/\.br-head\{[^}]*display:inline-block(?![^}]*margin:0 -)/.test(text),
       '导出锚点未无条件 inline-block');
    ok(text.includes('font-size:1em'), '导出锚点字号锁定 1em（不改格子宽度）');
    ok(!/--head-size/.test(text), '导出 CSS 中没有 --head-size');
    // 导出内容里的锚点必须与屏幕一致
    const exportedHeads = (text.match(/<span class="br-head">([^<]*)<\/span>/g) || [])
      .map(m => m.replace(/<[^>]+>/g, ''));
    const screenHeads = $$('#reader .br-head').map(e => e.textContent);
    ok(exportedHeads.length === screenHeads.length,
       `导出锚点数(${exportedHeads.length}) = 屏幕锚点数(${screenHeads.length})`);
    const same = exportedHeads.every((v, i) => v === screenHeads[i]);
    ok(same, '导出锚点序列与屏幕逐项相同');
  }
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
