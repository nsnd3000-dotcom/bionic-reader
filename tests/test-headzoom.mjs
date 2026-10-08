// 锚点缩放已整体移除：锚点必须恒为普通内联。
//
// 背景（2026-10，用户在真实浏览器里逐项排除后确证）：
//   锚点一旦在「锚点字号」≠100% 时变成 display:inline-block，
//   它就成了**原子盒**，而原子盒会在两侧**无条件引入断行机会**
//   （CSSWG 2020-01-24 决议 csswg-drafts#4576），
//   于是中文段落被塞进大量 UAX#14 本来禁止的断点，整段重排、右边缘参差。
//   用户实测：去掉 line-height / word-break 都无变化，
//   只有把 display 改回 inline 才恢复正常 → 真凶是原子盒。
//
//   而 transform 按规范只作用于 block-level / atomic inline-level 元素
//   （css-transforms-1 的 transformable element 排除 non-replaced inline box），
//   所以"既缩放又保持纯内联"在纯 CSS 里无解。缩放整条路被放弃。
//
// 本文件的作用：锁死"不许再把锚点变成非内联/不许再缩放"这条约束。
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
  },
});
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const $$ = s => [...doc.querySelectorAll(s)];
const root = doc.documentElement;
const styleText = [...doc.querySelectorAll('style')].map(s => s.textContent).join('\n');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

await new Promise(r => setTimeout(r, 150));
$('#btnDemo').click();
await new Promise(r => setTimeout(r, 400));

console.log('\n=== 1. 锚点恒为普通内联：绝不切成原子盒 ===');
{
  const headRule = stripComments(styleText.match(/\.br-head\{([^}]*)\}/)?.[1] || '');
  console.log(`     .br-head 规则：${headRule.replace(/\s+/g, ' ').trim()}`);

  // 基础规则里不得出现任何会造出原子盒的 display
  ok(!/display\s*:\s*inline-block/.test(headRule),
     '基础 .br-head 不是 inline-block（原子盒会破坏中文断行）');
  ok(/font-size\s*:\s*1em/.test(headRule),
     '锚点字号锁定 1em，与正文同号');

  // 整个样式表里都不该再有针对锚点的 inline-block / 缩放开关
  // 注意：只查"生效的声明"，注释里提到历史是可以的（那些说明正是给人看的）
  const live = stripComments(styleText);
  ok(!/data-headzoom/.test(live),
     '样式表中已无 data-headzoom 缩放开关');
  ok(!/html\[data-headzoom/.test(live), '已无 data-headzoom 相关规则');
}

console.log('\n=== 2. 绝不用 transform 缩放锚点 ===');
{
  // transform 对纯内联无效 → 想用 transform 就必须变原子盒 → 必然破坏断行。
  // 所以要同时禁止"锚点的 transform"，从结构上堵死这条路。
  const headRules = [...styleText.matchAll(/([^{}]*\.br-head[^{}]*)\{([^}]*)\}/g)];
  ok(headRules.length > 0, `找到 ${headRules.length} 条含 .br-head 的规则`);
  for (const [, sel, bodyRaw] of headRules) {
    const body = stripComments(bodyRaw);
    ok(!/transform\s*:\s*scale/.test(body),
       `规则 "${sel.trim().slice(0, 46)}" 里没有 transform:scale`);
  }
  // 也不许用 font-size 缩放（会改 advance 宽度 → 推开邻字）
  const base = stripComments(styleText.match(/\.br-head\{([^}]*)\}/)?.[1] || '');
  ok(!/font-size\s*:\s*(?!1em)[\d.]+em/.test(base) && !/font-size\s*:\s*calc/.test(base),
     '基础规则里没有用 font-size 缩放锚点');
}

console.log('\n=== 3. 缩放相关的 UI 与状态已彻底移除 ===');
{
  ok(!$('#rHeadSize'), '「锚点字号」滑块已从面板移除');
  ok(!$('#vHeadSize'), '「锚点字号」读数已移除');
  ok(root.dataset.headzoom === undefined,
     '不再设置 data-headzoom（无悬空状态）');
  ok(!/--head-zoom/.test(stripComments(styleText)),
     '样式表中已无 --head-zoom 变量');
  ok(!/--head-delta/.test(styleText), '已无 --head-delta 补偿变量');
  ok(!/锚点字号/.test(html.replace(/<!--[\s\S]*?-->/g, '')) ||
     !/id="rHeadSize"/.test(html),
     '界面文案不再引导用户调节锚点字号');
}

console.log('\n=== 4. 保留：加粗补偿必须来自实测值，且顺序正确 ===');
{
  // margin-inline 是同时设置 start/end 的简写；若排在 longhand 之后会把它清成 0。
  const order = (css, label) => {
    const iShort = css.search(/margin-inline\s*:/);
    const iEnd = css.search(/margin-inline-end\s*:\s*var\(--head-ls/);
    ok(iEnd !== -1, `${label}：存在基于实测值的 margin-inline-end 补偿`);
    ok(iShort === -1 || iShort < iEnd,
       `${label}：margin-inline 简写排在补偿之前（简写=${iShort}，补偿=${iEnd}）`);
  };
  const zoomLike = stripComments(styleText.match(/\.br-head\{([^}]*)\}/)?.[1] || '');
  order(zoomLike, '屏幕 CSS');

  // 不得有负 margin 收"侧边空白"
  ok(!/margin-inline-start\s*:\s*-/.test(zoomLike),
     '没有负的 margin-inline-start');
  ok(!/margin\s*:\s*[^;]*-\.0?5em/.test(zoomLike),
     '没有写死的 -0.05em 之类魔数');
}

console.log('\n=== 5. 导出 CSS 与屏幕一致（同样不含缩放）===');
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
    const headRule = stripComments(t.match(/\.br-head\{([^}]*)\}/)?.[1] || '');
    ok(headRule.length > 0, '导出 CSS 中含 .br-head 规则');
    ok(!/display\s*:\s*inline-block/.test(headRule),
       '导出锚点不是 inline-block（不会破坏断行）');
    ok(!/transform\s*:\s*scale/.test(headRule), '导出不含 transform:scale');
    ok(/font-size\s*:\s*1em/.test(headRule), '导出锚点字号锁定 1em');
    ok(!/data-headzoom/.test(t), '导出不含 data-headzoom');
    ok(!t.includes('undefined'), '导出无 undefined');
    // 补偿顺序也要查（导出路径历史上踩过这个坑）
    const iShort = headRule.search(/margin-inline\s*:/);
    const iEnd = headRule.search(/margin-inline-end\s*:\s*var\(--head-ls/);
    ok(iEnd !== -1, '导出：存在 margin-inline-end 补偿');
    ok(iShort === -1 || iShort < iEnd,
       `导出：margin-inline 简写排在补偿之前（简写=${iShort}，补偿=${iEnd}）`);
  }
}

console.log('\n=== 6. 老用户的 headSize 设置不会造成异常 ===');
{
  // 老 prefs 里可能存着 headSize:120；代码应忽略它而不是崩掉或重新启用缩放
  const dom2 = new JSDOM(html, {
    url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.JSZip = JSZip;
      win.localStorage.setItem('bionic-prefs', JSON.stringify({ headSize: 160, strength: 4 }));
      win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      Object.defineProperty(win, 'innerWidth', { value: 1400, writable: true });
      win.Element.prototype.scrollIntoView = function(){};
      win.HTMLElement.prototype.scrollIntoView = function(){};
    },
  });
  await new Promise(r => setTimeout(r, 400));
  const r2 = dom2.window.document.documentElement;
  ok(r2.dataset.headzoom === undefined,
     '带 headSize:160 的老设置启动时也不会开启缩放');
  const style2 = stripComments(
    [...dom2.window.document.querySelectorAll('style')].map(s => s.textContent).join(''));
  ok(!/data-headzoom/.test(style2), '老设置下样式表里也没有缩放规则');
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
