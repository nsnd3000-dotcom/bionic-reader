// 合成加粗补偿：锚点不得因为加粗而额外占用宽度
//
// 背景（真实浏览器实测数据，见 README 已知问题 5）：
//   宋体没有真正的 Bold 字重，浏览器用"合成加粗"描粗字形，
//   同时把 advance width 放大了 1.96%。每个锚点因此把右边的字推开一点，
//   一行里几个锚点误差累加 —— 这就是"字与字之间被撑开"的真正原因。
//   只加粗时每字只多 0.37px（19px 下）肉眼不可见；一旦放大锚点，
//   整体尺度变大，这个固定比例就变得非常显眼。
//
// 本测试锁住结构性防线：补偿变量存在、按字体实测、写进导出 CSS。
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}  期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`));

const styleText = (() => {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : '';
})();

console.log('\n=== 1. CSS 结构：锚点用 margin 收回加粗多出的宽度 ===');
{
  const headRule = styleText.match(/\.br-head\{([^}]*)\}/)?.[1] || '';
  console.log(`     .br-head：${headRule.replace(/\s+/g, ' ').trim()}`);
  ok(/margin-inline-end:\s*var\(--head-ls/.test(headRule),
     '锚点用 margin-inline-end:var(--head-ls) 收回宽度');
  ok(/font-size:\s*1em/.test(headRule), '锚点字号仍锁定 1em');
  ok(/--head-ls/.test(styleText), '存在 --head-ls 变量');
  // 用 margin 而不是 letter-spacing：
  // letter-spacing 会同时作用在锚点自己身上（单字也占一份），
  // 而这里要补的正是"锚点右侧多出来的那一段"。
  ok(!/\.br-head[^}]*letter-spacing:\s*-/.test(styleText),
     '补偿不使用负 letter-spacing（会连锚点自己一起缩）');
}

console.log('\n=== 2. 补偿值必须按字体实测，不能写死 ===');
{
  // 关键：宋体需要补偿，微软雅黑/楷体/黑体有真粗体、不需要。
  // 写死 -0.0196em 会把后三种字体的字挤在一起。
  ok(/function measureBoldInflation/.test(html), '存在实测函数 measureBoldInflation');
  ok(/measureCache/.test(html), '实测结果有缓存（避免拖动滑块时反复重排）');
  const fn = html.match(/function measureBoldInflation[\s\S]*?\n\}/)?.[0] || '';
  ok(/font-weight:?\s*\$\{weight\}|font-weight:\$\{weight\}/.test(fn) || /probe/.test(fn),
     '实测函数同时量常规与加粗字重');
  ok(/ratio\s*>\s*0\.0005/.test(fn) && /ratio\s*<\s*0\.2/.test(fn),
     '对实测值做了合法性过滤（噪声与异常字体不参与补偿）');
  ok(/measureCache\.key\s*!==\s*key|measureCache\.key/.test(html),
     '缓存按「字体|字号」为键，换字体/字号会重算');
}

console.log('\n=== 3. 运行时：模式与开关会影响补偿 ===');
{
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
  const root = doc.documentElement;

  await new Promise(r => setTimeout(r, 150));
  $('#btnDemo').click();
  await new Promise(r => setTimeout(r, 400));

  // jsdom 不做真实排版，getBoundingClientRect 恒为 0 → 实测值应为 0，
  // 补偿量为 "0px"。这里验证的是"逻辑存在且不崩"，真实数值由浏览器验证。
  const v = root.style.getPropertyValue('--head-ls');
  ok(v === '0px' || /^-?[\d.]+px$/.test(v), `--head-ls 有合法取值：${JSON.stringify(v)}`);

  // 纯变色模式（不加粗）不应产生补偿
  $$('#segMode button').find(b => b.dataset.mode === 'color').click();
  eq(root.style.getPropertyValue('--head-ls'), '0px', '变色模式（不加粗）补偿为 0');
  eq(root.style.getPropertyValue('--head-weight'), '400', '变色模式字重为 400');

  // 切回加粗
  $$('#segMode button').find(b => b.dataset.mode === 'bold').click();
  eq(root.style.getPropertyValue('--head-weight'), '700', '加粗模式字重为 700');

  // 关闭仿生阅读也不该补偿
  $('#btnBionic').click();
  await new Promise(r => setTimeout(r, 300));
  eq(root.style.getPropertyValue('--head-ls'), '0px', '关闭仿生阅读后补偿为 0');
  $('#btnBionic').click();
  await new Promise(r => setTimeout(r, 300));

  // 切换正文字体会触发重测（不崩即可）
  for (const f of ['kai', 'sans', 'serif']) {
    $$('#segFont button').find(b => b.dataset.font === f).click();
    await new Promise(r => setTimeout(r, 60));
  }
  ok(true, '遍历三种正文字体均未抛错');

  console.log('\n=== 4. 导出 CSS 也必须带补偿 ===');
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
      const t = captured.parts.join('');
      ok(t.includes('margin-inline-end'), '导出 CSS 含 margin-inline-end 补偿');
      ok(/\.br-head[^}]*font-size:1em/.test(t), '导出锚点字号仍锁定 1em');
      ok(!t.includes('undefined'), '导出无 undefined');
    }
  }
  dom.window.close();
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
