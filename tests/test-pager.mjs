// 底部章节条：只有"上一章 / 下一章"。
//
// 历史（用户两轮反馈）：
//   ① "没有下一页翻页啊？还得手动从旁边点击吗" → 加了底部条 + 翻屏
//   ② "其实不需要下一屏，只需要下一章" → 去掉翻屏，只留上下章
//
// 所以本文件锁定的行为是：
//   · 底部条只有两个按钮：上一章 / 下一章
//   · **不存在**翻屏按钮（pgPrev / pgNext）
//   · 键盘（方向键 / 空格 / PgUp PgDn）与按钮同义，都是翻章
//   · Home / End 只做章内定位，不换章
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}  期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`));

/* JSDOM 不做布局：scrollHeight/clientHeight 恒为 0。
   这里只需要它们不是 0（章内百分比才算得出来），
   翻章本身不依赖高度，所以打桩只为让进度条有意义。
   ★ 必须在渲染完成之后打桩 —— renderChapter 会重置 scrollTop。 */
function stubLayout(win) {
  const sc = win.document.querySelector('#scroller');
  let top = 0;
  Object.defineProperty(sc, 'clientHeight', { get: () => 600, configurable: true });
  Object.defineProperty(sc, 'scrollHeight', { get: () => 3000, configurable: true });
  Object.defineProperty(sc, 'scrollTop', {
    get: () => top,
    set: v => { top = Math.max(0, Math.min(v, 2400)); },
    configurable: true,
  });
  return sc;
}

/* 导入一本 5 章的 TXT（demo 只切出 1 章，跨章行为测不到） */
async function boot() {
  const dom = new JSDOM(html, {
    url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.JSZip = JSZip;
      win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      Object.defineProperty(win, 'innerWidth', { value: 1400, writable: true });
      win.Element.prototype.scrollIntoView = function(){};
      win.HTMLElement.prototype.scrollIntoView = function(){};
      win.confirm = () => true;
    },
  });
  await new Promise(r => setTimeout(r, 250));
  const w = dom.window, d = w.document;

  const txt = Array.from({ length: 5 }, (_, i) =>
    `第${['一','二','三','四','五'][i]}章 测试章节\n\n${
      `这是第${i + 1}章的正文内容，用来撑出足够高度。`.repeat(40)
    }`
  ).join('\n\n');

  const input = d.querySelector('#fileInput');
  const file = new w.File([new w.TextEncoder().encode(txt)], 'multi.txt', { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));

  return { w, d, sc: stubLayout(w) };
}

const chapNo = d => parseInt(d.querySelector('#pgCount').textContent, 10);
const key = (w, k, opts = {}) =>
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));

console.log('\n=== 1. 底部条只有"上一章 / 下一章" ===');
let ctx = await boot();
{
  const { d } = ctx;
  ok(!!d.querySelector('#pager'), '底部条存在');
  ok(!d.querySelector('#pager').classList.contains('hidden'), '有书时可见');
  ok(!!d.querySelector('#pgPrevCh'), '「上一章」按钮存在');
  ok(!!d.querySelector('#pgNextCh'), '「下一章」按钮存在');
  ok(!!d.querySelector('#pgChapter'), '章名存在');
  ok(!!d.querySelector('#pgCount'), '章序号存在');
  ok(!!d.querySelector('#pgFill'), '章内进度存在');
  eq(chapNo(d), 1, `起始在第 1 章（${d.querySelector('#pgCount').textContent}）`);
}

console.log('\n=== 2. 翻屏按钮已彻底移除 ===');
{
  const { w, d } = ctx;
  ok(!d.querySelector('#pgPrev'), '不存在「上一屏」按钮 #pgPrev');
  ok(!d.querySelector('#pgNext'), '不存在「下一屏」按钮 #pgNext');
  // 源码层面也不该再有翻屏相关标识
  const live = html.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const s of ['pageDown', 'pageUp', 'pageStep', 'PAGE_OVERLAP']) {
    ok(!live.includes(s), `源码中已无 ${s}`);
  }
  ok(!/下一屏|上一屏/.test(live), '界面文案里没有"下一屏/上一屏"');
}

console.log('\n=== 3. 点「下一章」/「上一章」 ===');
ctx = await boot();
{
  const { d } = ctx;
  d.querySelector('#pgNextCh').click();
  await new Promise(r => setTimeout(r, 300));
  eq(chapNo(d), 2, '点「下一章」→ 第 2 章');

  d.querySelector('#pgNextCh').click();
  await new Promise(r => setTimeout(r, 300));
  eq(chapNo(d), 3, '再点一次 → 第 3 章');

  d.querySelector('#pgPrevCh').click();
  await new Promise(r => setTimeout(r, 300));
  eq(chapNo(d), 2, '点「上一章」→ 回第 2 章');

  eq(ctx.sc.scrollTop, 0, '换章后回到章首');
}

console.log('\n=== 4. 边界时的按钮状态与提示 ===');
ctx = await boot();
{
  const { d } = ctx;
  ok(d.querySelector('#pgPrevCh').disabled, '第 1 章时「上一章」禁用');
  ok(!d.querySelector('#pgNextCh').disabled, '第 1 章时「下一章」可用');

  // 跳到最后一章
  for (let i = 0; i < 4; i++) { d.querySelector('#pgNextCh').click(); await new Promise(r => setTimeout(r, 200)); }
  eq(chapNo(d), 5, '连点 4 次 → 第 5 章（最后一章）');
  ok(d.querySelector('#pgNextCh').disabled, '最后一章时「下一章」禁用');
  ok(!d.querySelector('#pgPrevCh').disabled, '最后一章时「上一章」可用');
}

console.log('\n=== 5. 键盘与按钮同义（都是翻章）===');
ctx = await boot();
{
  const { w, d } = ctx;
  for (const k of ['ArrowRight', 'ArrowDown', 'PageDown', ' ']) {
    const before = chapNo(d);
    key(w, k);
    await new Promise(r => setTimeout(r, 250));
    eq(chapNo(d), before + 1, `${JSON.stringify(k)} → 下一章`);
  }
  for (const k of ['ArrowLeft', 'ArrowUp', 'PageUp']) {
    const before = chapNo(d);
    key(w, k);
    await new Promise(r => setTimeout(r, 250));
    eq(chapNo(d), before - 1, `${JSON.stringify(k)} → 上一章`);
  }
}

console.log('\n=== 6. Home / End 只做章内定位，不换章 ===');
ctx = await boot();
{
  const { w, d, sc } = ctx;
  d.querySelector('#pgNextCh').click();
  await new Promise(r => setTimeout(r, 300));
  const at = chapNo(d);

  sc.scrollTop = 1500;
  key(w, 'End');
  eq(chapNo(d), at, 'End 不换章');
  ok(sc.scrollTop > 1500, `End 滚到章末（${sc.scrollTop}）`);

  key(w, 'Home');
  eq(chapNo(d), at, 'Home 不换章');
  eq(sc.scrollTop, 0, 'Home 回到章首');
}

console.log('\n=== 7. 章内进度随滚动更新（百分比按数值比较）===');
ctx = await boot();
{
  const { w, d, sc } = ctx;
  const pct = () => parseFloat(d.querySelector('#pgFill').style.width) || 0;
  sc.scrollTop = 0;
  d.querySelector('#scroller').dispatchEvent(new w.Event('scroll'));
  eq(pct(), 0, '章首 0%');
  sc.scrollTop = 1200;
  d.querySelector('#scroller').dispatchEvent(new w.Event('scroll'));
  eq(pct(), 50, '滚到一半 50%');
  sc.scrollTop = 2400;
  d.querySelector('#scroller').dispatchEvent(new w.Event('scroll'));
  eq(pct(), 100, '到底 100%');
}

console.log('\n=== 8. 回到首页后底部条收起 ===');
ctx = await boot();
{
  const { d } = ctx;
  d.querySelector('#btnHome').click();
  await new Promise(r => setTimeout(r, 400));
  ok(d.querySelector('#pager').classList.contains('hidden'), '没有书时底部条隐藏');
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
