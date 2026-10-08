// 验证：历史遗留的 justify 设置会被迁移回 left，且界面明确显示当前对齐状态
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}  期望 ${JSON.stringify(e)} 实际 ${JSON.stringify(a)}`));

function boot(storedPrefs) {
  return new JSDOM(html, {
    url: 'https://example.com/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.JSZip = JSZip;
      win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      Object.defineProperty(win, 'innerWidth', { value: 1400, writable: true });
      win.Element.prototype.scrollIntoView = function(){};
      win.HTMLElement.prototype.scrollIntoView = function(){};
      if (storedPrefs) {
        // 在页面脚本执行前把"上次保存的偏好"塞进 localStorage
        win.localStorage.setItem('bionic.prefs.v1', JSON.stringify(storedPrefs));
      }
    },
  });
}

console.log('\n=== 1. 全新用户：默认左对齐 ===');
{
  const dom = boot(null);
  const doc = dom.window.document;
  await new Promise(r => setTimeout(r, 150));
  eq(doc.documentElement.dataset.align, 'left', '默认 data-align = left');
  ok(doc.querySelector('#alignNow').textContent.includes('左对齐'),
     `界面提示当前为左对齐：「${doc.querySelector('#alignNow').textContent}」`);
  dom.window.close();
}

console.log('\n=== 2. 历史遗留：存着 justify 的老用户 ===');
{
  // 这正是"为什么我明明没开两端对齐，却一直是两端对齐"的场景
  const dom = boot({ align: 'justify', size: 21, strength: 4 });
  const doc = dom.window.document;
  await new Promise(r => setTimeout(r, 200));
  eq(doc.documentElement.dataset.align, 'left',
     '旧的 justify 设置被一次性迁移为 left');
  ok(doc.querySelector('#alignNow').textContent.includes('左对齐'),
     '界面提示已回到左对齐');
  // 其余设置必须原样保留，迁移不能顺手清掉用户偏好
  const saved = JSON.parse(dom.window.localStorage.getItem('bionic.prefs.v1'));
  eq(saved.size, 21, '其他设置未被迁移影响（size 仍是 21）');
  eq(saved.strength, 4, '其他设置未被迁移影响（strength 仍是 4）');
  eq(saved.alignMigrated, true, '迁移标记已写入，不会重复迁移');
  dom.window.close();
}

console.log('\n=== 3. 用户主动选两端对齐：必须尊重，不能被迁移覆盖 ===');
{
  const dom = boot(null);
  const { window } = dom;
  const doc = window.document;
  await new Promise(r => setTimeout(r, 150));
  const jb = [...doc.querySelectorAll('#segAlign button')].find(b => b.dataset.align === 'justify');
  jb.click();
  await new Promise(r => setTimeout(r, 100));
  eq(doc.documentElement.dataset.align, 'justify', '用户点选后立即生效');
  ok(doc.querySelector('#alignNow').textContent.includes('两端对齐'),
     '界面明确警告当前是两端对齐');
  const saved = JSON.parse(window.localStorage.getItem('bionic.prefs.v1'));
  eq(saved.align, 'justify', '用户的选择被保存');
  eq(saved.alignMigrated, true, '已带迁移标记，不会被下次启动迁走');

  // 模拟"重启应用"：同样的存储再开一次
  const dom2 = boot(saved);
  await new Promise(r => setTimeout(r, 200));
  eq(dom2.window.document.documentElement.dataset.align, 'justify',
     '重启后仍是用户主动选的 justify（迁移只对"未标记的老数据"生效）');
  dom.window.close();
  dom2.window.close();
}

console.log('\n=== 4. 两端对齐确实是"被撑开"的来源（结构性验证）===');
{
  const dom = boot(null);
  const { window } = dom;
  const doc = window.document;
  await new Promise(r => setTimeout(r, 150));
  const styleText = [...doc.querySelectorAll('style')].map(s => s.textContent).join('\n');
  // 默认规则绝不能含 justify
  const def = styleText.match(/#reader p\{([^}]*)\}/)[1];
  ok(def.includes('text-align:left'), '默认段落规则是 left');
  ok(!/justify/.test(def), '默认段落规则不含 justify');
  // justify 必须只在显式开关下出现
  ok(/html\[data-align="justify"\] #reader p\{[^}]*text-align:justify/.test(styleText),
     'justify 仅通过 [data-align="justify"] 开关生效');
  // 且必须带 text-align-last:left，避免最后一行被拉伸
  ok(/html\[data-align="justify"\] #reader p\{[^}]*text-align-last:left/.test(styleText),
     'justify 下指定 text-align-last:left（最后一行不拉伸）');
  dom.window.close();
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
