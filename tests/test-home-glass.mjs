// 主页：穹顶图书馆背景 + 毛玻璃 UI。
//
// 用户要求："主页背景换成这个，前面 ui 换成毛玻璃形式"
//
// 这里锁的是**结构性事实**（背景图存在且被引用、玻璃属性在位、
// 有可读性兜底），而不是像素效果 —— 视觉效果需要人眼确认。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const htmlPath = new URL('../index.html', import.meta.url);
const html = readFileSync(htmlPath, 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}  期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`));

// 取出 <style> 内容，并去掉注释（注释里提到 backdrop-filter 不算数）
const rawStyle = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
const style = rawStyle.replace(/\/\*[\s\S]*?\*\//g, '');
/* 取某个选择器的规则体。
   ★ 必须**行首锚定**（m 标志 + ^\s*）：不加锚定的话，
     `#pager` 会先命中样式表里更早出现的
     `body.pdf-mode #pager{display:none}`（复合选择器里的子串），
     取回一个 `display:none` 的规则体，导致
     "底部条有毛玻璃" 这类断言无故失败。
     踩过一次：给 PDF 模式加显隐规则时，把 #pager 的检查带偏了。 */
const ruleOf = sel => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = style.match(new RegExp('^\\s*' + esc + '\\s*\\{([^}]*)\\}', 'm'));
  return m ? m[1] : '';
};

console.log('\n=== 1. 背景图文件确实存在且被引用 ===');
{
  const img = new URL('../bg-library.jpg', import.meta.url);
  ok(existsSync(img), 'bg-library.jpg 存在');
  const kb = statSync(img).size / 1024;
  console.log(`     大小：${kb.toFixed(1)} KB`);
  // 背景图不该太肥：几百 KB 是合理的，超过 1MB 会拖慢首屏
  ok(kb < 800, `体积 ${kb.toFixed(1)}KB < 800KB（背景图不该太重）`);

  const emptyRule = ruleOf('#empty');
  ok(/background-image\s*:\s*url\(["']?bg-library\.jpg/.test(emptyRule),
     '#empty 引用了 bg-library.jpg');
  ok(/background-size\s*:\s*cover/.test(emptyRule), '背景 cover 铺满');
  ok(/background-position\s*:\s*center/.test(emptyRule), '背景居中定位');
}

console.log('\n=== 2. 卡片是毛玻璃（不是不透明实底）===');
{
  const card = ruleOf('.drop-card');
  ok(/backdrop-filter\s*:\s*blur\(/.test(card), '卡片有 backdrop-filter:blur');
  ok(/blur\((\d+)/.test(card) && +card.match(/blur\((\d+)/)[1] >= 12,
     `模糊半径足够（${card.match(/blur\((\d+)/)?.[1]}px ≥ 12px）`);
  ok(/saturate\(/.test(card), '加了 saturate 提升玻璃质感');

  // 背景必须是半透明：色值里要有 transparent / rgba / color-mix
  const bg = card.match(/background\s*:\s*([^;]+)/)?.[1] || '';
  ok(/transparent|rgba\(|color-mix/.test(bg),
     `卡片底色半透明（${bg.trim().slice(0, 40)}…）`);

  // 玻璃"厚度感"：应有 inset 高光
  ok(/inset\s+0\s+1px\s+0/.test(card), '有 inset 顶部高光（玻璃厚度感）');
}

console.log('\n=== 3. 次按钮也是玻璃材质 ===');
{
  const ghost = ruleOf('.btn.ghost');
  ok(/backdrop-filter\s*:\s*blur\(/.test(ghost), '.btn.ghost 有 backdrop-filter');
  ok(/transparent|color-mix|rgba\(/.test(ghost.match(/background\s*:\s*([^;]+)/)?.[1] || ''),
     '.btn.ghost 底色半透明');
  // 主按钮仍应醒目（实心 accent），不被玻璃化
  const btn = ruleOf('.btn');
  ok(/background\s*:\s*var\(--accent\)/.test(btn), '主按钮仍是实心 accent 色（保持醒目）');
}

console.log('\n=== 4. 可读性兜底（两条都不能少）===');
{
  // (a) 深色主题必须专门处理 —— 照片偏亮，白字会糊
  const darkCard = style.match(/html\[data-theme="dark"\]\s+\.drop-card\s*\{([^}]*)\}/)?.[1] || '';
  ok(darkCard.length > 0, '深色主题对 .drop-card 有专门覆盖');
  ok(/rgba\(28\s*,\s*30\s*,\s*35/.test(darkCard) || /rgba\([^)]*,\s*\.5/.test(darkCard),
     '深色主题把玻璃压暗（保证白字对比度）');
  const darkEmpty = style.match(/html\[data-theme="dark"\]\s+#empty::before\s*\{([^}]*)\}/)?.[1] || '';
  ok(/rgba\(\s*10\s*,\s*11\s*,\s*13/.test(darkEmpty),
     '深色主题在照片上加暗色遮罩');

  // (b) 不支持 backdrop-filter 时退回不透明，避免文字读不清。
  // ★ 页面上有**两个** @supports not 块（全局玻璃令牌 + 主页卡片），
  //   所以要把它们全部收集起来再判断，只取第一个会误判。
  //   另外 @supports 条件里有嵌套括号，不能用 [^)]* 匹配 ——
  //   那样会在第一个 ')' 停住。用括号配平来提取函数体。
  const collectAtSupports = () => {
    const out = [];
    const re = /@supports\s+not\s*\(/g;
    let mm;
    while ((mm = re.exec(style)) !== null) {
      const braceAt = style.indexOf('{', mm.index);
      if (braceAt < 0) continue;
      let depth = 0, end = -1;
      for (let i = braceAt; i < style.length; i++) {
        if (style[i] === '{') depth++;
        else if (style[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end > braceAt) out.push(style.slice(braceAt + 1, end));
    }
    return out;
  };
  const fallbacks = collectAtSupports();
  const allFallback = fallbacks.join('\n');
  ok(fallbacks.length > 0, `有 @supports not (backdrop-filter) 降级分支（${fallbacks.length} 个）`);
  ok(/--glass-bg\s*:\s*var\(--bg-elev\)/.test(allFallback),
     '降级时把 --glass-bg 退回不透明（全局 UI 一起生效）');
  ok(/\.drop-card/.test(allFallback), '降级分支覆盖 .drop-card（退回近乎不透明）');
}

console.log('\n=== 5. 背景只在主页，不干扰阅读区 ===');
{
  // 背景图挂在 #empty 上：#empty 在打开书后会被加上 .hidden
  const emptyRule = ruleOf('#empty');
  ok(/background-image/.test(emptyRule), '背景图挂在 #empty 上');
  ok(/^#empty\.hidden\{display:none\}$/m.test(style.replace(/\s+/g, '')) ||
     /#empty\.hidden\s*\{\s*display\s*:\s*none/.test(style),
     '#empty.hidden 隐藏 → 打开书后背景不显示');
  // 阅读区 #reader 不该被加背景
  const reader = ruleOf('#reader');
  ok(!/background-image/.test(reader), '阅读区 #reader 没有背景图（保持纯净）');
}

console.log('\n=== 6. 运行时：打开书后主页隐藏、背景不可见 ===');
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

  ok(!d.querySelector('#empty').classList.contains('hidden'), '初始：主页可见');

  d.querySelector('#btnDemo').click();
  await new Promise(r => setTimeout(r, 600));
  ok(d.querySelector('#empty').classList.contains('hidden'),
     '加载书后主页隐藏（背景随之不可见）');

  d.querySelector('#btnHome').click();
  await new Promise(r => setTimeout(r, 500));
  ok(!d.querySelector('#empty').classList.contains('hidden'), '回首页后主页恢复可见');
}

console.log('\n=== 7. 深浅主题都定义了玻璃，不会一边失效 ===');
{
  // 浅色（默认）与深色都应有 backdrop-filter 覆盖
  const lightCard = ruleOf('.drop-card');
  ok(/backdrop-filter/.test(lightCard), '浅色主题卡片有玻璃');
  const darkCard = style.match(/html\[data-theme="dark"\]\s+\.drop-card\s*\{([^}]*)\}/)?.[1] || '';
  ok(/backdrop-filter/.test(lightCard) && /rgba/.test(darkCard),
     '深色主题单独覆盖了底色（不需要重复 backdrop-filter）');
}

console.log('\n=== 7b. 全局 UI 毛玻璃（顶栏/侧栏/面板/底部条/提示）===');
{
  // 用户澄清：毛玻璃指的是"中间那些浮在内容上的 UI"，不只是主页卡片。
  const surfaces = ['#topbar', '#sidebar', '#panel', '#pager', '#toast'];
  for (const sel of surfaces) {
    const body = ruleOf(sel);
    ok(/backdrop-filter\s*:/.test(body), `${sel} 有 backdrop-filter`);
    const bg = body.match(/background\s*:\s*([^;]+)/)?.[1] || '';
    ok(/--glass-|transparent|color-mix|rgba\(/.test(bg),
       `${sel} 底色半透明（${bg.trim().slice(0, 34)}…）`);
  }

  // 玻璃令牌必须定义，且深色主题有覆盖。
  // ★ 注意：深色主题有**多个** html[data-theme="dark"] 块
  //   （一个是颜色令牌，另一个是玻璃令牌），不能只读第一个。
  for (const t of ['--glass-bg', '--glass-border', '--glass-blur']) {
    ok(new RegExp(t.replace(/-/g, '\\-') + '\\s*:').test(style), `定义了 ${t}`);
  }
  const darkBlocks = [];
  const dre = /html\[data-theme="dark"\]\s*\{/g;
  let dm;
  while ((dm = dre.exec(style)) !== null) {
    const braceAt = dm.index + dm[0].length - 1;
    let depth = 0, end = -1;
    for (let i = braceAt; i < style.length; i++) {
      if (style[i] === '{') depth++;
      else if (style[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > braceAt) darkBlocks.push(style.slice(braceAt + 1, end));
  }
  ok(darkBlocks.some(b => /--glass-bg\s*:/.test(b)),
     `深色主题覆盖了玻璃令牌（共 ${darkBlocks.length} 个 dark 块）`);
}

console.log('\n=== 8. 阅读区必须透明，否则玻璃没东西可模糊 ===');
{
  // 这是毛玻璃最容易失效的地方：
  // backdrop-filter 只能采样"背后真实绘制的内容"。
  // 如果阅读区是不透明的，所有浮在它上面的面板背后都只有一块纯色，
  // 模糊纯色 = 纯色 → 玻璃效果根本不出现。
  const stage = ruleOf('#stage');
  ok(!/background\s*:\s*var\(--bg\)/.test(stage),
     '#stage 没有不透明背景（否则面板背后是纯色）');
  const scroller = ruleOf('#scroller');
  ok(!/^\s*background\s*:/m.test(scroller),
     '#scroller 没有不透明背景（正文才透得出来）');
  // 而 body 要提供底色，保证正文可读。
  // ★ 背景图现在是**可选项**（见 test-reader-panel.mjs）：
  //   默认纯色，只有 html[data-bg="image"] 时才铺那张照片。
  //   所以这里只断言"body 有底色"，不再要求它一定带图 ——
  //   断言意图而非某个时刻的实现。
  const bodyRule = style.match(/(?:^|\n)body\s*\{([^}]*)\}/)?.[1] || '';
  ok(/background-color\s*:\s*var\(--bg\)/.test(bodyRule),
     'body 有页面底色（正文有可读的底色）');
  // 默认不该带图：纯色必须是零成本
  ok(!/url\(/.test(bodyRule),
     'body 默认不引图（纯色零成本；背景图由开关打开）');
}

console.log('\n=== 9. 全局降级：一次改令牌，所有 UI 一起生效 ===');
{
  // 降级不该逐个面板去改，而应改 --glass-* 令牌本身 ——
  // 这样顶栏/侧栏/面板/底部条/提示会同时退回不透明，不会漏掉某个。
  const re = /@supports\s+not\s*\(/g;
  const blocks = [];
  let mm;
  while ((mm = re.exec(style)) !== null) {
    const braceAt = style.indexOf('{', mm.index);
    let depth = 0, end = -1;
    for (let i = braceAt; i < style.length; i++) {
      if (style[i] === '{') depth++;
      else if (style[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > braceAt) blocks.push(style.slice(braceAt + 1, end));
  }
  const all = blocks.join('\n');
  ok(/--glass-bg\s*:\s*var\(--bg-elev\)/.test(all), '降级时 --glass-bg 退回不透明');
  ok(/--glass-bg-strong\s*:\s*var\(--bg-elev\)/.test(all), '降级时 --glass-bg-strong 也退回');
  // 三个带玻璃的面板都不需要单独写降级（说明令牌方案生效）
  for (const sel of ['#topbar', '#sidebar', '#panel']) {
    const body = ruleOf(sel);
    ok(/var\(--glass-bg/.test(body),
       `${sel} 用令牌而非硬编码色 → 降级自动生效`);
  }
}

console.log('\n=== 10. 卡片竖向节奏（用户反馈"每行与按钮的间隔差太大"）===');
{
  // 演进史：
  //   1.0：图标→标题 18 / 标题→说明 9 / 说明→按钮 20 / 按钮→提示 **-8** / 提示→列表 16
  //        → 上面挤、下面空，提示被负 margin 硬拽到按钮下。
  //   1.1：改成 4/10/22/10/20+18 —— 仍然忽宽忽窄（按钮上方 22、下方 10）。
  //   1.2（现在）：所有块间距统一走 --row-gap（18px），任何一处都不再单独写死。
  // ★ 断言方式也随之改变：不再逐个比像素，而是确认**每个间距都引用同一个变量**，
  //   这样以后调总间距只改一个数，且不可能再出现"某一段特别宽"。
  const cardRule = ruleOf('.drop-card');
  const gapVar = (cardRule.match(/--row-gap\s*:\s*([\d.]+)px/) || [])[1];
  const gap = gapVar ? +gapVar : 0;
  const usesGap = (sel, prop) =>
    new RegExp(prop + '\\s*:[^;}]*var\\(--row-gap(?:\\s*,\\s*[^)]*)?\\)').test(ruleOf(sel));

  const gaps = {
    '图标→标题': usesGap('.drop-card .big', 'margin-bottom'),
    '标题→说明': usesGap('.drop-card h1', 'margin'),
    '说明→按钮': usesGap('.drop-card p', 'margin'),
    '按钮→提示': usesGap('.drop-card .fmt-tip', 'margin'),
    '提示→列表': usesGap('.fmt-list', 'margin-top'),
    '列表内上留白': usesGap('.fmt-list', 'padding-top'),
  };
  const uneven = Object.entries(gaps).filter(([, v]) => !v).map(([k]) => k);
  console.log(`     --row-gap = ${gap}px，未统一的间距：${uneven.length ? uneven.join('、') : '无'}`);

  ok(gap >= 14 && gap <= 24, `统一间距值合理（${gap}px，14~24 区间）`);
  ok(!uneven.length, '六处行间距全部引用同一个 --row-gap，不再忽宽忽窄');

  // 关键回归：提示不再用负 margin
  ok(!/margin\s*:\s*-/.test(ruleOf('.drop-card .fmt-tip')),
     '提示不再用负 margin 硬拽到按钮下（旧值 -8px）');

  // 关键回归：提示是 <p>，`.drop-card p` 的 margin 会压掉单类 `.fmt-tip` 的 margin-top，
  // 结果按钮与提示的间距变成 0（用户："两个按钮不要和下面字接那么近"）。
  // 只有写成 `.drop-card .fmt-tip`（两个类）才压得住。
  ok(/(^|\})\s*\.drop-card\s+\.fmt-tip\s*\{/m.test(style),
     '提示规则用双类选择器，不会被 .drop-card p 的 margin 覆盖成 0');

  // 长文本限宽，避免折行参差
  ok(/max-width/.test(ruleOf('.drop-card p')), '说明文字限宽（折行更整齐）');
  ok(/max-width/.test(ruleOf('.drop-card .fmt-tip')), '提示文字限宽');

  // 首页文字用思源宋体（Noto Serif SC）
  ok(/font-family\s*:[^;}]*Noto Serif SC/.test(cardRule),
     '首页卡片文字使用思源宋体（Noto Serif SC）');

  // 毛玻璃更通透：卡片底色不透明度已从 62% 降到 40%
  const cardAlpha = +(cardRule.match(/--bg-elev\)\s*(\d+)%/) || [])[1];
  ok(cardAlpha > 0 && cardAlpha <= 45,
     `卡片玻璃更透（底色 ${cardAlpha}% ≤ 45%，旧值 62%）`);
  ok(/rgba\(28,\s*30,\s*35,\s*\.40\)/.test(style), '深色主题卡片同步降到 40% 不透明度');

  // 窄窗口兜底
  ok(/overflow-y\s*:\s*auto/.test(ruleOf('#empty')),
     '#empty 允许纵向滚动（矮窗口下卡片不会被裁）');

  // 首页整体上移：居中靠"下内边距多加 2 倍上移量"实现（不用 transform，
  // 否则会和拖放时的 .drop-card.over 缩放抢同一个属性）
  const emptyRule = ruleOf('#empty');
  const lift = (emptyRule.match(/--home-lift\s*:\s*([\d.]+)vh/) || [])[1];
  ok(lift && +lift > 0, `首页设了上移量（${lift || 0}vh）`);
  ok(/padding\s*:[^;}]*var\(--home-lift\)/.test(emptyRule),
     '上移量通过下内边距生效（2 倍补偿 flex 居中）');
  ok(!/transform\s*:[^;}]*translateY/.test(ruleOf('.drop-card')),
     '上移没有用 transform（避免与拖放缩放冲突）');

  // 用户："加粗所有文字，最上面那行字字号放大"
  {
    const baseW = +(cardRule.match(/font-weight\s*:\s*(\d+)/) || [])[1] || 0;
    ok(baseW >= 600, `卡片整体字重 ${baseW}（≥600，所有文字继承加粗）`);

    const h1Rule = ruleOf('.drop-card h1');
    const h1Size = +(h1Rule.match(/font-size\s*:\s*([\d.]+)px/) || [])[1] || 0;
    const h1W = +(h1Rule.match(/font-weight\s*:\s*(\d+)/) || [])[1] || 0;
    ok(h1Size >= 24, `标题字号放大到 ${h1Size}px（旧值 21px）`);
    ok(h1W >= 700, `标题字重 ${h1W}（加粗）`);

    const btnW = +(ruleOf('.drop-card .btn').match(/font-weight\s*:\s*(\d+)/) || [])[1] || 0;
    ok(btnW >= 700, `按钮字重 ${btnW}（.btn 自身的 600 已被覆盖）`);

    const listW = +(ruleOf('.fmt-list b').match(/font-weight\s*:\s*(\d+)/) || [])[1] || 0;
    ok(listW >= 700, `列表小标题字重 ${listW}`);
  }
}

console.log('\n=== 11. 阅读区背景图（开关打开时生效）===');
{
  // 用户："阅读器的背景能否也换一下，不要这个纯白的要毛玻璃盖在图片上"
  // 后来加了开关，所以现在这条规则挂在 html[data-bg="image"] 下，
  // 而不是无条件铺在 body 上（否则开关就失效了）。
  const imgRule = style.match(/html\[data-bg="image"\]\s+body\s*\{([^}]*)\}/)?.[1] || '';

  ok(/url\(["']?bg-arches\.jpg/.test(imgRule), '开图时引用 bg-arches.jpg');
  ok(/background-attachment\s*:\s*fixed/.test(imgRule),
     '背景 fixed（滚动时文字滑过背景，玻璃感更强）');
  ok(/background-size\s*:\s*cover/.test(imgRule), '背景 cover 铺满');

  // 照片上必须盖一层半透明渐变：不盖就把文字压在花纹上，没法读
  const mixes = [...imgRule.matchAll(/var\(--bg\)\s+(\d+)%/g)].map(m => +m[1]);
  ok(mixes.length >= 3 && mixes.every(v => v >= 70 && v <= 96),
     `照片上的玻璃层透明度合理（${mixes.join('/')}，70~96%）`);

  // 深色主题必须单独加强，否则白字糊在照片亮部上
  const darkImg = style.match(/html\[data-bg="image"\]\[data-theme="dark"\]\s+body\s*\{([^}]*)\}/)?.[1] || '';
  ok(/url\(["']?bg-arches\.jpg/.test(darkImg), '深色+图 也定义了阅读背景');
  const darkMix = [...darkImg.matchAll(/rgba\([^)]*?,\s*\.(\d+)\)/g)].map(m => +('.' + m[1]));
  ok(darkMix.length > 0 && darkMix.every(v => v >= 0.9),
     `深色主题遮罩很实（${darkMix.join('/')}，≥0.9）—— 照片高光太亮`);

  // 图片文件本身
  const img = new URL('../bg-arches.jpg', import.meta.url);
  ok(existsSync(img), 'bg-arches.jpg 存在');
  const kb = statSync(img).size / 1024;
  console.log(`     大小：${kb.toFixed(1)} KB`);
  ok(kb < 500, `体积 ${kb.toFixed(1)}KB < 500KB`);
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
