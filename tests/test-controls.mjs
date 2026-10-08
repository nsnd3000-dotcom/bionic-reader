// 验证「颜色自定义」与持久化，以及 file:// 下的存储退化
// （历史上还验证过「锚点字号」滑块 —— 该功能因破坏中文断行已移除）
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}  期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`));

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
const root = doc.documentElement;
window.addEventListener('error', e => errors.push(e.message));

await new Promise(r => setTimeout(r, 150));
$('#btnDemo').click();
await new Promise(r => setTimeout(r, 400));

console.log('\n=== A. 初始状态：新控件都存在 ===');
ok(!!$('#tintPicker'), '锚点自定义颜色选择器存在');
ok(!!$('#tailSwatches'), '词尾色块容器存在');
ok(!!$('#tailPicker'), '词尾自定义颜色选择器存在');
ok($$('#tailSwatches .swatch').length >= 2, `词尾色块 ${$$('#tailSwatches .swatch').length} 个`);
ok(errors.length === 0, `无 JS 报错${errors.length ? '：' + errors.join('|') : ''}`);

console.log('\n=== B. 锚点缩放已移除（缩放会破坏中文断行）===');
{
  // 历史上这里验证「锚点字号」滑块（80%~260%）驱动 transform:scale()。
  // 但 transform 对纯内联无效 → 必须变 inline-block → 原子盒在两侧
  // 无条件加断行机会（CSSWG#4576）→ 中文整段排乱。
  // 用户实测确证后决定放弃缩放：仿生阅读靠"加粗 + 变色"就够了。
  ok(!$('#rHeadSize'), '「锚点字号」滑块已移除');
  ok(!$('#vHeadSize'), '「锚点字号」读数已移除');

  const styleText = [...doc.querySelectorAll('style')].map(s => s.textContent).join('\n');
  const live = styleText.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/--head-size/.test(live), '源码中已无 --head-size 变量');
  ok(!/--head-zoom/.test(live), '源码中已无 --head-zoom 变量');
  ok(/\.br-head\{[^}]*font-size:1em/.test(live), '锚点字号锁定 1em');
  ok(!/transform:\s*scale\(var\(--head-zoom/.test(live), '不再用 transform 缩放锚点');
  ok(!/data-headzoom/.test(live), '不再有 data-headzoom 缩放开关');

  // 改其他设置（字号/强度/行高）都不该让锚点获得缩放
  for (const sel of ['#rSize', '#rStrength', '#rLh']) {
    const el = $(sel);
    if (!el) continue;
    el.value = '200';
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  ok(root.dataset.headzoom === undefined, '改设置后仍无缩放状态');
  ok(root.style.getPropertyValue('--head-zoom') === '', '改设置后仍无缩放变量');
}

console.log('\n=== C. 正文字号上限提高 ===');
{
  eq($('#rSize').max, '48', '正文字号上限提升到 48px');
  $('#rSize').value = '48';
  $('#rSize').dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(root.style.getPropertyValue('--reader-size'), '48px', '正文字号 48px 生效');
  $('#rSize').value = '19';
  $('#rSize').dispatchEvent(new window.Event('input', { bubbles: true }));
}

console.log('\n=== D. 锚点颜色可自定义（用户核心诉求 2）===');
{
  // 预设色
  const tintBtn = $$('#swatches .swatch').find(b => b.dataset.color === '#1f5fb4');
  tintBtn.click();
  eq(root.style.getPropertyValue('--bionic-tint'), '#1f5fb4', '预设锚点色生效');
  eq(root.dataset.bionic, 'mix', '选颜色时自动切到「加粗+变色」（否则看不到颜色）');
  eq(root.style.getPropertyValue('--head-color'), '#1f5fb4', '锚点色写入 --head-color');

  // 自定义拾色器
  $('#tintPicker').value = '#ff0066';
  $('#tintPicker').dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(root.style.getPropertyValue('--bionic-tint'), '#ff0066', '自定义拾色器生效');
  ok(root.style.getPropertyValue('--head-color') === '#ff0066', '--head-color 同步');
}

console.log('\n=== E. 词尾颜色可自定义 ===');
{
  // 默认 follow
  eq(root.dataset.tail, 'follow', '默认词尾为「淡化」模式');

  const blueTail = $$('#tailSwatches .swatch').find(b => b.dataset.color === '#1f5fb4');
  ok(!!blueTail, '词尾色块存在');
  blueTail.click();
  eq(root.dataset.tail, 'custom', '切换到自定义词尾色');
  eq(root.style.getPropertyValue('--tail-color'), '#1f5fb4', '词尾色变量生效');

  $('#tailPicker').value = '#00aa88';
  $('#tailPicker').dispatchEvent(new window.Event('input', { bubbles: true }));
  eq(root.style.getPropertyValue('--tail-color'), '#00aa88', '自定义词尾色生效');
  eq(root.dataset.tail, 'custom', '拾色器自动切到 custom');

  // 切回淡化
  const followBtn = $$('#tailSwatches .swatch').find(b => b.dataset.tail === 'follow');
  followBtn.click();
  eq(root.dataset.tail, 'follow', '可切回「淡化」模式');
}

console.log('\n=== F. 三种高亮模式 ===');
{
  for (const [mode, weight] of [['bold','700'], ['color','400'], ['mix','700']]) {
    $$('#segMode button').find(b => b.dataset.mode === mode).click();
    eq(root.dataset.bionic, mode, `模式 ${mode} 生效`);
    eq(root.style.getPropertyValue('--head-weight'), weight, `模式 ${mode} 字重 ${weight}`);
  }
  // 纯加粗模式不应改色
  $$('#segMode button').find(b => b.dataset.mode === 'bold').click();
  const hc = root.style.getPropertyValue('--head-color');
  ok(hc !== '#00aa88', `纯加粗模式下锚点色为正文色（${hc}）`);
}

console.log('\n=== G. 设置持久化与恢复默认 ===');
{
  $('#rStrength').value = '5';
  $('#rStrength').dispatchEvent(new window.Event('input', { bubbles: true }));
  const saved = JSON.parse(window.localStorage.getItem('bionic.prefs.v1'));
  eq(saved.strength, 5, 'strength 被保存');
  ok('tailColor' in saved && 'tailMode' in saved, '词尾颜色字段被保存');

  $('#btnReset').click();
  await new Promise(r => setTimeout(r, 300));
  eq($('#rStrength').value, '3', '恢复默认后强度回到 3');
  ok(root.dataset.headzoom === undefined, '恢复默认后依然没有缩放状态');
}

console.log('\n=== H. 导出包含新参数 ===');
{
  let captured = null;
  const OrigBlob = window.Blob;
  window.Blob = function (p, o) { captured = { parts: p, opts: o }; return new OrigBlob(p, o); };
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function(){};

  $$('#segMode button').find(b => b.dataset.mode === 'color').click();
  $('#tintPicker').value = '#cc0044';
  $('#tintPicker').dispatchEvent(new window.Event('input', { bubbles: true }));

  $('#btnExport').click();
  await new Promise(r => setTimeout(r, 120));

  ok(!!captured, '导出成功');
  if (captured) {
    const text = captured.parts.join('');
    // 缩放已移除：导出里也不该再有它。
    // 注意只看 .br-head 规则 —— 导出页仍会带界面样式（如 .swatch:hover 的微缩放）。
    const headRule = text.match(/\.br-head\{[^}]*\}/)?.[0] || '';
    ok(!/transform:scale/.test(headRule), '导出锚点规则不再含 transform:scale');
    ok(!/data-headzoom/.test(text), '导出 CSS 不含 data-headzoom');
    ok(!/display:inline-block/.test(headRule),
       '导出锚点不是 inline-block（不破坏中文断行）');
    ok(!/--head-size/.test(text), '导出 CSS 不用 font-size 放大锚点');
    ok(text.includes('#cc0044'), '导出 CSS 含自定义锚点色');
    ok(!text.includes('undefined'), '导出无 undefined');
  }
  window.Blob = OrigBlob;
}

console.log('\n=== I. file:// 下 localStorage 不可用时的退化 ===');
{
  // 新开一个实例，强制 localStorage 抛错，模拟 file://
  const errs2 = [];
  const dom2 = new JSDOM(html, {
    url: 'file:///D:/x/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.JSZip = JSZip;
      win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      Object.defineProperty(win, 'innerWidth', { value: 1400, writable: true });
      win.Element.prototype.scrollIntoView = function(){};
      win.HTMLElement.prototype.scrollIntoView = function(){};
      // 模拟沙箱化的 localStorage：访问即抛 SecurityError
      Object.defineProperty(win, 'localStorage', {
        configurable: true,
        get() { throw new win.DOMException('localStorage is not available for opaque origins', 'SecurityError'); },
      });
      win.addEventListener('error', e => errs2.push(e.message || String(e.error)));
    },
  });
  const w2 = dom2.window, d2 = w2.document;
  await new Promise(r => setTimeout(r, 250));

  ok(errs2.length === 0, `file:// 下无未捕获错误${errs2.length ? '：' + errs2.join('|') : ''}`);

  // 关键：即使 localStorage 不可用，改设置也不能崩
  const r = d2.querySelector('#rSize');
  let threw = null;
  try {
    r.value = '22';
    r.dispatchEvent(new w2.Event('input', { bubbles: true }));
  } catch (e) { threw = e; }
  ok(!threw, `localStorage 抛错时改设置不崩${threw ? '：' + threw.message : ''}`);
  eq(d2.documentElement.style.getPropertyValue('--reader-size'), '22px',
     '设置仍然生效（内存退化）');

  // 且应给出提示，而不是静默失败
  const toastEl = d2.querySelector('#toast');
  await new Promise(r2 => setTimeout(r2, 1200));
  ok(toastEl.textContent.includes('无法长期保存') || toastEl.classList.contains('on'),
     `给出存储不可用提示：「${toastEl.textContent.slice(0, 40)}」`);
  dom2.window.close();
}

console.log('\n=== J. 未导入书时顶栏按钮可用 ===');
{
  const dom3 = new JSDOM(html, {
    url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.JSZip = JSZip;
      win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      Object.defineProperty(win, 'innerWidth', { value: 1400, writable: true });
      win.Element.prototype.scrollIntoView = function(){};
      win.HTMLElement.prototype.scrollIntoView = function(){};
    },
  });
  const w3 = dom3.window, d3 = w3.document;
  await new Promise(r => setTimeout(r, 200));
  ok(d3.querySelector('#btnBionic').disabled === false, '仿生按钮未禁用（可点击）');
  ok(d3.querySelector('#btnTheme').disabled === false, '主题按钮未禁用');
  ok(d3.querySelector('#btnPanel').disabled === false, '设置按钮未禁用');

  // 点了要有反馈
  d3.querySelector('#btnBionic').click();
  await new Promise(r => setTimeout(r, 100));
  const t = d3.querySelector('#toast');
  ok(t.classList.contains('on') && t.textContent.length > 0,
     `未导入书时点仿生有提示：「${t.textContent.slice(0, 30)}」`);

  // 设置面板能打开
  d3.querySelector('#btnPanel').click();
  ok(!d3.querySelector('#panel').classList.contains('hidden'), '未导入书时也能打开设置面板');
  dom3.window.close();
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
