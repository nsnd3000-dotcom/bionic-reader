// 验证"不拉大空白"：字距相关的 CSS 必须干净
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

await new Promise(r => setTimeout(r, 150));
$('#btnDemo').click();
await new Promise(r => setTimeout(r, 400));

console.log('\n=== A. text-align 默认必须是左对齐（空白的主因）===');
eq(root.dataset.align, 'left', 'data-align = left（默认）');
{
  // 真正决定性的检查：内联样式表里 #reader p 的默认规则
  const styleText = [...doc.querySelectorAll('style')].map(s => s.textContent).join('\n');
  const m = styleText.match(/#reader p\{([^}]*)\}/);
  ok(!!m, '找到 #reader p 规则');
  if (m) {
    ok(m[1].includes('text-align:left'), `默认段落为左对齐：${m[1].match(/text-align:[^;]*/)?.[0]}`);
    ok(!/text-align:justify/.test(m[1]), '默认规则里没有 justify');
  }
  // justify 只能在 data-align="justify" 时出现
  ok(/html\[data-align="justify"\] #reader p\{[^}]*text-align:justify/.test(styleText),
     'justify 仅作为可选开关存在');
}

console.log('\n=== B. 不得有会拉开字距的属性 ===');
{
  const styleText = [...doc.querySelectorAll('style')].map(s => s.textContent).join('\n');
  // word-spacing 会直接拉开间距。唯一允许出现的位置是锚点/词尾规则里
  // 显式写回 normal 的复位声明（"用 normal 关掉继承来的间距"）。
  const wsHits = [...styleText.matchAll(/word-spacing\s*:\s*([^;}]*)/g)]
    .map(m => m[1].trim());
  ok(wsHits.every(v => v === 'normal'),
     `word-spacing 只允许出现 normal 复位：${JSON.stringify(wsHits)}`);
  // br-head / br-tail 不得带 padding / 正 margin
  const headRule = styleText.match(/\.br-head\{([^}]*)\}/)?.[1] || '';
  const tailRule = styleText.match(/\.br-tail\{([^}]*)\}/)?.[1] || '';
  // 允许显式 padding:0 —— 那是"防线"，不是间距
  const spacing = rule => (rule.match(/padding\s*:\s*([^;}]*)/g) || [])
    .concat(rule.match(/margin\s*:\s*([^;}]*)/g) || [])
    .map(s => s.split(':')[1].trim())
    .filter(v => !/^0(\s+0)*$/.test(v) && !/^0\s+-/.test(v));
  eq(spacing(headRule), [], '锚点没有任何非零 padding/margin');
  eq(spacing(tailRule), [], '词尾没有任何非零 padding/margin');
  // 关键回归：锚点必须是普通内联，绝不能出现 inline-block
  ok(!/^[^}]*display\s*:\s*inline-block/m.test(headRule.replace(/^/, '')),
     '基础 .br-head 规则里不得有 display:inline-block（旧版空白元凶）');
  // ★ 锚点缩放已整体移除：样式表里不该再有缩放规则或原子盒
  const live = styleText.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/data-headzoom/.test(live), '已无 data-headzoom 缩放规则');
  ok(!/html\[data-headzoom/.test(live), '已无按缩放开关切换的规则');
}

console.log('\n=== C. 运行时：任何情况下都不启用 inline-block ===');
{
  // 「锚点字号」滑块已移除（缩放会破坏中文断行）。
  // 这里改为验证：即使老 prefs 里存着 headSize，也不会启用任何缩放。
  eq(root.dataset.headzoom, undefined,
     '运行时不再设置 data-headzoom（不存在缩放分支）');
  const live = styleText.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/inline-block/.test(live.match(/\.br-head[^{]*\{[^}]*\}/g)?.join('') || ''),
     '所有 .br-head 规则都不是 inline-block');
}

console.log('\n=== D. 计算样式：锚点与正文间距一致 ===');
{
  // jsdom 不做真实排版，但能读计算样式。检查关键属性没有被意外设置。
  const head = $('#reader .br-head');
  const tail = $('#reader .br-tail');
  ok(!!head && !!tail, '存在锚点与词尾元素');
  if (head && tail) {
    const cs = window.getComputedStyle(head);
    const ts = window.getComputedStyle(tail);
    // 未放大时不应有 inline-block
    cs.display !== 'inline-block'
      ? (pass++, console.log(`  ok   未放大时 display=${cs.display}（正常内联）`))
      : (fail++, console.log('  FAIL 未放大时仍是 inline-block'));
    ok(cs.paddingLeft === '0px' && cs.paddingRight === '0px', `锚点 padding 为 0：${cs.paddingLeft}/${cs.paddingRight}`);
    ok(ts.paddingLeft === '0px' && ts.paddingRight === '0px', '词尾 padding 为 0');
    ok((cs.marginLeft === '0px') && (cs.marginRight === '0px'), `锚点 margin 为 0：${cs.marginLeft}/${cs.marginRight}`);
    // letter-spacing 应继承正文，不应额外增大
    console.log(`     letter-spacing: head=${cs.letterSpacing} tail=${ts.letterSpacing}`);
    ok(cs.letterSpacing === ts.letterSpacing, '锚点与词尾 letter-spacing 相同');
    // word-spacing 必须是 normal（复位值），不能继承成 fixed 值
    ok(cs.wordSpacing === 'normal' || cs.wordSpacing === '0px',
       `锚点 word-spacing 为 normal：${cs.wordSpacing}`);
    // 锚点字号必须恒等于正文 —— 这是格子宽度不变的前提。
    // jsdom 不解析 var()，正文的 font-size 会以字面量返回，故分两路判断。
    const readerSize = window.getComputedStyle($('#reader')).fontSize;
    ok(cs.fontSize === ts.fontSize,
       `锚点字号 = 词尾字号（${cs.fontSize} / ${ts.fontSize}）`);
    ok(!cs.fontSize.includes('var('),
       `锚点字号是固定值，不随变量变化（${cs.fontSize}）`);
  }
}

console.log('\n=== D2. 锚点不得通过 font-size 改变格子宽度 ===');
{
  // 这是"放大后字与字之间被撑开"的根因：只要锚点换了 font-size，
  // 它的格子（advance width）就变了，会把右边所有字推开。
  // ★ 锚点缩放已整体移除（缩放必然要原子盒 → 破坏中文断行），
  //   所以锚点字号恒等于正文，且不存在任何缩放变量。
  const headRule = styleText.match(/\.br-head\{([^}]*)\}/)?.[1] || '';
  ok(/font-size:\s*1em/.test(headRule), '锚点字号锁定 1em（格子恒等于正文）');
  ok(!/--head-size/.test(styleText), '源码中已无 --head-size（会改字号的变量）');
  ok(!/--head-zoom/.test(styleText.replace(/\/\*[\s\S]*?\*\//g, '')),
     '源码中已无 --head-zoom（缩放变量已随功能移除）');

  // 反复改各种设置后，锚点仍不得获得任何缩放
  for (const v of [80, 120, 160]) {
    for (const sel of ['#rSize', '#rStrength', '#rLh']) {
      const el = $(sel);
      if (!el) continue;
      el.value = String(v);
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    ok(root.style.getPropertyValue('--head-zoom') === '',
       `改设置后仍不产生 --head-zoom（试到 ${v}）`);
    ok(root.dataset.headzoom === undefined,
       `改设置后仍无 data-headzoom（试到 ${v}）`);
  }
}

console.log('\n=== E. 对齐开关可切换 ===');
{
  const jb = $$('#segAlign button').find(b => b.dataset.align === 'justify');
  ok(!!jb, '两端对齐按钮存在');
  jb.click();
  eq(root.dataset.align, 'justify', '切到两端对齐');
  ok(jb.classList.contains('on'), '按钮高亮');

  const lb = $$('#segAlign button').find(b => b.dataset.align === 'left');
  lb.click();
  eq(root.dataset.align, 'left', '切回左对齐');
  ok(lb.classList.contains('on'), '左对齐按钮高亮');
}

console.log('\n=== F. 持久化与导出 ===');
{
  $$('#segAlign button').find(b => b.dataset.align === 'justify').click();
  const saved = JSON.parse(window.localStorage.getItem('bionic.prefs.v1'));
  eq(saved.align, 'justify', 'align 被保存');

  let captured = null;
  const OrigBlob = window.Blob;
  window.Blob = function (p, o) { captured = { parts: p }; return new OrigBlob(p, o); };
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function(){};
  $('#btnExport').click();
  await new Promise(r => setTimeout(r, 120));
  ok(!!captured, '导出成功');
  if (captured) {
    const t = captured.parts.join('');
    ok(t.includes('text-align:justify'), '导出遵循 justify 设置');
  }
  window.Blob = OrigBlob;

  // 切回左对齐再导出
  $$('#segAlign button').find(b => b.dataset.align === 'left').click();
  let cap2 = null;
  window.Blob = function (p, o) { cap2 = { parts: p }; return new OrigBlob(p, o); };
  $('#btnExport').click();
  await new Promise(r => setTimeout(r, 120));
  if (cap2) {
    const t2 = cap2.parts.join('');
    ok(t2.includes('text-align:left'), '左对齐时导出为 left');
    ok(!/text-align:justify/.test(t2), '左对齐导出不含 justify');
  } else ok(false, '第二次导出失败');
  window.Blob = OrigBlob;

  $('#btnReset').click();
  await new Promise(r => setTimeout(r, 250));
  eq(root.dataset.align, 'left', '恢复默认后仍是左对齐');
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
