// 阅读界面：正文毛玻璃文本框 + 纯色/背景图开关。
//
// 用户两条需求：
//   1. 阅读界面给文本弄个类似毛玻璃的文本框，里面 80% 不透明度，
//      背景依然和首页一样微微不透明
//   2. 增加一个切换纯色/有背景图的选项
import { readFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}  期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`));

const style = html.slice(html.indexOf('<style'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const ruleOf = sel => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = style.match(new RegExp('(?:^|\\n)' + esc + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : '';
};

console.log('\n=== 1. 正文的毛玻璃文本框 ===');
{
  const panel = ruleOf('#reader::before');
  ok(panel.length > 0, '存在 #reader::before（正文玻璃板）');
  ok(/position\s*:\s*absolute/.test(panel), '绝对定位（脱离正文流，不影响排版）');
  ok(/backdrop-filter\s*:\s*blur\(/.test(panel),
     `有 backdrop-filter（${(panel.match(/blur\((\d+)/) || [])[1]}px）`);

  // ★ 用户明确要求的 80%
  const op = +(panel.match(/var\(--bg-elev\)\s+(\d+)%/) || [])[1];
  eq(op, 80, '不透明度正好是 80%（用户指定）');

  ok(/pointer-events\s*:\s*none/.test(panel), 'pointer-events:none（不挡选字）');
  ok(/border-radius/.test(panel), '有圆角（像一张纸）');

  // ★ 不能用负 z-index：有层叠上下文时伪元素会沉到 body 背景之后而消失
  ok(!/z-index\s*:\s*-/.test(panel),
     '没有用负 z-index（负值会在层叠上下文里沉到背景后，静默消失）');
  ok(/z-index\s*:\s*0/.test(panel), 'z-index:0（留在默认层）');
  ok(/#reader\s*>\s*\*\s*\{[^}]*z-index\s*:\s*1/.test(style),
     '正文子元素抬到 z-index:1（玻璃在正文之下、背景之上）');
}

console.log('\n=== 2. 深色主题的玻璃板要换底色 ===');
{
  const dark = style.match(/html\[data-theme="dark"\]\s+#reader::before\s*\{([^}]*)\}/)?.[1] || '';
  ok(dark.length > 0, '深色主题单独定义了 #reader::before');
  ok(/#1e2024\s+80%/.test(dark) || /var\(--bg-elev\)\s+80%/.test(dark),
     '深色下仍保持 80%，但底色是暗色');
}

console.log('\n=== 3. 背景开关：默认纯色，可切背景图 ===');
{
  // 默认（纯色）：body 不该带图
  const bodyRule = style.match(/(?:^|\n)body\s*\{([^}]*)\}/)?.[1] || '';
  ok(/background-color\s*:\s*var\(--bg\)/.test(bodyRule), 'body 有纯色底');
  ok(!/url\(/.test(bodyRule),
     '默认 body 不引图 → "纯色"是零成本（不下载、不渲染图片）');

  // 开图：由 html[data-bg="image"] 打开
  const img = style.match(/html\[data-bg="image"\]\s+body\s*\{([^}]*)\}/)?.[1] || '';
  ok(img.length > 0, 'html[data-bg="image"] body 规则存在');
  ok(/url\(["']?bg-arches\.jpg/.test(img), '开图时引用 bg-arches.jpg');
  ok(/linear-gradient\(/.test(img), '开图时照片上盖一层渐变（磨砂）');
  const mixes = [...img.matchAll(/var\(--bg\)\s+(\d+)%/g)].map(m => +m[1]);
  ok(mixes.length >= 3 && mixes.every(v => v >= 70 && v <= 96),
     `照片上的玻璃层透明度合理（${mixes.join('/')}）—— 保证"微微不透明"`);

  // 深色 + 图
  const darkImg = style.match(/html\[data-bg="image"\]\[data-theme="dark"\]\s+body\s*\{([^}]*)\}/)?.[1] || '';
  ok(darkImg.length > 0, '深色+图 有单独覆盖（照片高光太亮，需更强遮罩）');
  ok(/url\(["']?bg-arches\.jpg/.test(darkImg), '深色+图 也引用该图');

  // 不能再有旧的、无条件生效的深色 body 背景规则（会与开关打架）
  const oldDark = style.match(/html\[data-theme="dark"\]\s+body\s*\{([^}]*)\}/)?.[1] || '';
  ok(!/url\(/.test(oldDark),
     '旧的「深色主题无条件铺图」规则已移除（否则会绕过开关）');
}

console.log('\n=== 4. 面板控件与状态 ===');
{
  ok(html.includes('id="segBg"'), '面板里有 #segBg 分段控件');
  const btns = [...html.matchAll(/data-bg="(\w+)"/g)].map(m => m[1]);
  ok(btns.includes('plain') && btns.includes('image'),
     `有「纯色 / 背景图」两个按钮（${[...new Set(btns)].join(', ')}）`);
  ok(/bg:\s*'plain'/.test(html), `DEFAULTS 里 bg 默认 'plain'（纯色）`);
  ok(/root\.dataset\.bg\s*=/.test(html), 'applyPrefs 会写 html[data-bg]');
  ok(/\$\('#segBg'\)\.onclick/.test(html), '#segBg 绑定了点击处理');
  ok(/\$\$\('#segBg button'\)\.forEach/.test(html), 'syncControls 会同步按钮高亮态');
}

console.log('\n=== 5. 运行时：切换真的改变 html[data-bg] ===');
{
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
  await new Promise(r => setTimeout(r, 300));
  const w = dom.window, d = w.document;
  const root = d.documentElement;

  eq(root.dataset.bg, 'plain', '启动时默认 plain（纯色）');
  ok(d.querySelector('#segBg button[data-bg="plain"]').classList.contains('on'),
     '「纯色」按钮初始高亮');

  d.querySelector('#segBg button[data-bg="image"]').click();
  await new Promise(r => setTimeout(r, 150));
  eq(root.dataset.bg, 'image', '点「背景图」→ data-bg=image');
  ok(d.querySelector('#segBg button[data-bg="image"]').classList.contains('on'),
     '「背景图」按钮高亮');
  ok(!d.querySelector('#segBg button[data-bg="plain"]').classList.contains('on'),
     '「纯色」按钮取消高亮');

  d.querySelector('#segBg button[data-bg="plain"]').click();
  await new Promise(r => setTimeout(r, 150));
  eq(root.dataset.bg, 'plain', '点回「纯色」→ data-bg=plain');

  // 设置必须被持久化
  const saved = JSON.parse(w.localStorage.getItem('bionic.prefs.v1') || '{}');
  eq(saved.bg, 'plain', '选择被写入 prefs');
}

console.log('\n=== 6. 背景图文件存在且不臃肿 ===');
{
  ok(existsSync(new URL('../bg-arches.jpg', import.meta.url)), 'bg-arches.jpg 存在');
  ok(existsSync(new URL('../bg-library.jpg', import.meta.url)), 'bg-library.jpg（首页）存在');
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
