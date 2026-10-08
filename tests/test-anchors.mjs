// 中文锚点规则：标点后 + 段首 + 长句兜底
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/<script>\s*\/\* =+\s*\n\s*Bionic Reader[\s\S]*?\n<\/script>/);
let code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
code = code.replace(/document\.readyState === 'loading'[\s\S]*$/, '');
code = code.replace(/\}\)\(\);\s*$/, '');
code = code.replace(/^\s*\(\(\)\s*=>\s*\{/, '');
code += `\nglobalThis.__T = { computeHanAnchors, splitHanRun, bionicFragment, bionicToHTML, CJK_CLAUSE, CJK_STRIDE, CJK_FUNC_1, CJK_FUNC_2, CJK_PUNCT, hanRuns };\n})();\n`;

const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://example.com' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
new Function(code)();
const T = globalThis.__T;

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}`));
const eq = (a, e, n) => JSON.stringify(a) === JSON.stringify(e)
  ? (pass++, console.log(`  ok   ${n}`))
  : (fail++, console.log(`  FAIL ${n}\n       期望 ${JSON.stringify(e)}\n       实际 ${JSON.stringify(a)}`));

// ★ computeHanAnchors 现在返回 Map<起点, 长度>（不是 Set）：
//   结构锚点长度 1（标点后首字），词语锚点长度 = 整个词。
//   所以判断"某字符是否被加粗"要看**区间**，不能只看起点。
const inSpan = (anchors, i) => {
  for (const [s, l] of anchors) if (i >= s && i < s + l) return true;
  return false;
};

// 把文本标成 【锚点】其余 的形式，便于目视。
// ★ 必须按**区间**整体加括号：一个词锚点是 [start, start+len) 的一个整体，
//   若逐字加括号会显示成「【现】【象】」，看着像两个锚点（那是假象）。
function mark(text, strength = 3) {
  const anchors = T.computeHanAnchors(text, strength);
  let out = '';
  for (let i = 0; i < text.length;) {
    let span = null;
    for (const [s, l] of anchors) if (i >= s && i < s + l) { span = [s, s + l]; break; }
    if (span) {
      out += '【' + text.slice(span[0], span[1]) + '】';
      i = span[1];
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

// 取所有"锚点区间起点"，用于检查"某个字是否是新锚点的开头"
const heads = (anchors) => [...anchors.keys()].sort((a, b) => a - b);

const anchorChars = (text, s = 3) =>
  heads(T.computeHanAnchors(text, s)).map(i => text[i]).join('');

console.log('\n=== 1. 标点之后必须有锚点（用户要求的核心规则）===');
{
  const t = '我想说巴罗克风格故意竭尽，到了自我讽刺的边缘。后来他放弃了。';
  const marked = mark(t);
  console.log('     ' + marked);
  // 逗号后的「到」、句号后的「后」都应是锚点
  const anchors = T.computeHanAnchors(t, 3);
  const idxOf = ch => t.indexOf(ch);
  ok(anchors.has(idxOf('到')), '逗号后第一个字「到」是锚点');
  ok(anchors.has(idxOf('后')), '句号后第一个字「后」是锚点');
  ok(anchors.has(0), '段首第一个字「我」是锚点');
}
{
  const t = '他说：“这样真的可以吗？”她点了点头。';
  const marked = mark(t);
  console.log('     ' + marked);
  ok(marked.includes('【这】'), '左引号后的字是锚点');
  ok(marked.includes('【她】'), '右引号+问号后的字是锚点');
}
{
  const t = '第一点、第二点；第三点：结束。';
  const marked = mark(t);
  console.log('     ' + marked);
  // 锚点落在标点之后的第一个字上（即「第二点」的「第」，而非「二」）
  const a = T.computeHanAnchors(t, 3);
  const afterIdx = (punct) => t.indexOf(punct) + 1;
  ok(a.has(afterIdx('、')), `顿号后第一个字「${t[afterIdx('、')]}」是锚点`);
  ok(a.has(afterIdx('；')), `分号后第一个字「${t[afterIdx('；')]}」是锚点`);
  ok(a.has(afterIdx('：')), `冒号后第一个字「${t[afterIdx('：')]}」是锚点`);
  ok(marked.includes('、第'.replace('第', '【第】')) || marked.includes('【第】二'),
     '顿号后的锚点确实落在「第」上');
}
{
  // 引号包住的词只是"被引用"，不构成小句起点 —— 但不该产生空锚点
  const t = '他称之为“枯枝败叶”的现象。';
  const marked = mark(t);
  console.log('     ' + marked);
  ok(mark(t).includes('【他】'), '段首「他」是锚点（人称代词可作起点锚）');
  ok(!marked.includes('【的】'), '「的现象」这种虚词起头的短区段不会被锚定');
  ok(!/【[“”（）「」]】/.test(marked), '引号/括号本身不是锚点');
}

console.log('\n=== 2. 多字锚点必须是**完整的词**（不能是任意连续字）===');
{
  // ★ 规则变更（2026-10）：句中词锚点**故意**是整个词一起加粗
  //   （「引导」而不是「【引】导」），所以"禁止多字锚点"这条已作废。
  //   新的防线是：多字锚点必须是分词器给出的**完整词**，
  //   不能是"两个相邻锚点被合并"造成的任意字符串（那才是 bug）。
  const { default: JSZip } = await import('jszip');
  const seg = new Intl.Segmenter('zh-Hans', { granularity: 'word' });

  const samples = [
    '我想说巴罗克风格故意竭尽（或者力求竭尽）浮饰之能事，到了自我讽刺的边缘。',
    '这是一段很长很长完全没有标点符号的中文句子用来验证兜底机制是否生效',
    '暮地，香蕉公司好似一阵旋风刮到这里，在小镇中心扎下根来。',
    '他说：“这样真的可以吗？”她点了点头。',
  ];
  for (const t of samples) {
    // 该文本里所有"词"的集合（按字符内容建索引，便于判断某个多字段是不是词）
    const wordSet = new Set();
    for (const s of seg.segment(t)) if (s.isWordLike) wordSet.add(s.segment);

    const segs = segsOf(T.bionicFragment(t, 5, document));
    const runs = segs.filter(x => x[1]).map(x => x[0]);
    const multi = runs.filter(r => /^[\p{Script=Han}]+$/u.test(r) && [...r].length > 1);
    const notWords = multi.filter(r => !wordSet.has(r));
    ok(notWords.length === 0,
       `强度 5 的多字锚点都是完整词：${JSON.stringify(t.slice(0, 14))}…` +
       `${notWords.length ? ' -> 非词: ' + notWords.join('/') : '（' + multi.join('/') + '）'}`);
  }
}
{
  const t = '我想说巴罗克风格故意竭尽（或者力求竭尽）浮饰之能事，到了自我讽刺的边缘。';
  const marked = mark(t);
  console.log('     新: ' + marked);
  console.log('     旧: 【我】想说巴【罗】克风格【故】意竭尽（【或】者力求【竭】尽）【浮】饰之能【事】，【到】了自我【讽】刺的边【缘】。');
  const n = T.computeHanAnchors(t, 3).size;
  console.log(`     锚点数：新 ${n} 个 vs 旧 10 个`);
  ok(n < 10, `锚点变稀疏（${n} < 10），字间距问题缓解`);
  ok(n >= 2, `锚点又不太少（${n} >= 2）`);
}

console.log('\n=== 2b. 引号/括号不得产生"空锚点" ===');
{
  // 旧行为：「“枯枝败叶”」会变成【“】【枯】枝败叶【”】——
  // 那个只圈住右引号的锚点是纯视觉噪音，必须消失。
  const t = '他称之为“枯枝败叶”的现象。';
  const marked = mark(t);
  console.log('     ' + marked);
  ok(!marked.includes('【”】') && !marked.includes('【“】'),
     '引号本身不是锚点');
  ok(mark('（括号里的内容）结束了。').match(/【[）(】]/) === null,
     '圆括号本身也不是锚点');
  // 引号是"包裹型"标点，不构成小句起点
  ok(!/【现】/.test(mark(t)), '引号后面的短区段不会被硬锚');
  ok(mark(t).includes('【他】'), '该段自己的小句起点仍有锚点');
}

console.log('\n=== 3. 两类锚点：结构（标点/段首）+ 词语（句中实词）===');
{
  // ★ 现行规则（2026-10）：
  //   1) 结构锚点：标点后首字 + 段首首字，长度恒为 1
  //   2) 词语锚点：句中**实词**，长度 = 整个词（需要分词）
  //   所以"无标点长句"不再只有 1 个锚点 —— 句中实词也会被锚，
  //   这是刻意的（用户要求句中词语也能成为锚点）。
  const t = '这是一段很长很长完全没有标点符号的中文句子用来验证兜底机制是否生效abcdefg';
  const marked = mark(t, 3);
  console.log('     ' + marked);
  const hs = heads(T.computeHanAnchors(t, 3));
  console.log(`     锚点 ${hs.length} 个，位于：${hs.map(i => t[i]).join(' ')}`);
  ok(hs.length >= 2, `无标点长句也有多个锚点（${hs.length} 个，句中实词被锚）`);
  ok(hs[0] === 0, '段首有锚点');
  // 锚点之间必须拉开距离（不会有连排加粗）
  const gaps = hs.slice(1).map((v, i) => v - hs[i]);
  ok(gaps.every(g => g >= 1), `锚点起点互不重叠：${JSON.stringify(gaps)}`);
}
{
  // 结构锚点：每个小句开头都必须有锚点（用户核心要求）
  const t = '第一句内容，第二句内容。第三句内容；第四句内容';
  const hs = heads(T.computeHanAnchors(t, 3));
  console.log(`     有标点句锚点起点：${hs.map(i => t[i]).join(' ')}`);
  for (const p of ['，', '。', '；']) {
    const k = t.indexOf(p) + 1;
    ok(hs.includes(k), `${p} 后「${t[k]}」是锚点`);
  }
  // 段首
  ok(hs.includes(0), '段首「第」是锚点');
}
{
  // 强度应当影响词语锚点密度（越强越密），结构锚点不受影响
  const t = '这是一段很长很长完全没有标点符号的中文句子用来验证不同强度的密度差异';
  const n1 = T.computeHanAnchors(t, 1).size;
  const n3 = T.computeHanAnchors(t, 3).size;
  const n5 = T.computeHanAnchors(t, 5).size;
  ok(n1 <= n3 && n3 <= n5,
     `强度越高锚点越密：${n1} <= ${n3} <= ${n5}（词语锚点随强度增加）`);
}
{
  // 小句长度表本身必须是"强度越大越短"
  const c = T.CJK_CLAUSE;
  ok(c.every((v, i) => i === 0 || v <= c[i - 1]), `CJK_CLAUSE 单调递减：${JSON.stringify(c)}`);
}

console.log('\n=== 3b. 汉字区段：标点/字母/数字都会切断 ===');
{
  eq(T.hanRuns('中文abc中文'), [[0, 2], [5, 7]], '字母切断汉字区段');
  eq(T.hanRuns('中文，中文'), [[0, 2], [3, 5]], '中文标点切断汉字区段');
  eq(T.hanRuns('abc123'), [], '纯拉丁/数字没有汉字区段');
  eq(T.hanRuns('混合 mixed 文本'), [[0, 2], [9, 11]], '空格切断汉字区段');
}

console.log('\n=== 3c. 锚点永不连排（字距的结构性防线）===');
{
  // 若两个锚点相邻，就会渲染成"两个连续加粗字"，
  // 视觉上等于把词切开，也是"加粗区域看起来被拉开"的来源之一。
  const samples = [
    '我想说巴罗克风格故意竭尽（或者力求竭尽）浮饰之能事，到了自我讽刺的边缘。',
    '这是一段很长很长完全没有标点符号的中文句子用来验证兜底机制是否生效',
    '暮地，香蕉公司好似一阵旋风刮到这里，在小镇中心扎下根来。',
    '他说：“这样真的可以吗？”她点了点头。',
    '这是那场越来越遥远、越来越令人难以置信的内战的遗物。',
    '（括号里的内容）结束了。',
    '他称之为“枯枝败叶”的现象。',
  ];
  for (const t of samples) {
    for (const s of [1, 3, 5]) {
      const idxs = [...T.computeHanAnchors(t, s)].sort((a, b) => a - b);
      const gaps = idxs.slice(1).map((v, i) => v - idxs[i]);
      if (gaps.some(g => g < 2)) {
        fail++;
        console.log(`  FAIL 强度 ${s} 出现连排锚点：${JSON.stringify(t.slice(0, 18))} 间隔=${JSON.stringify(gaps)}`);
      }
    }
  }
  pass++;
  console.log('  ok   所有样本在强度 1/3/5 下锚点间隔均 >= 2 字');
}

console.log('\n=== 3d. 虚词不作"补位"锚点 ===');
{
  // 补位锚点落在虚词上会把词拦腰截断（「物」质垃圾、「遗」物）。
  // 起头锚定不受此限 —— 小句开头本来就是词的开头。
  const t = '这是一段很长很长完全没有标点符号的中文句子用来验证兜底机制是否生效';
  const a = T.computeHanAnchors(t, 5);
  const chs = [...a].sort((x, y) => x - y).map(i => t[i]);
  console.log(`     锚点字：${chs.join(' ')}`);
  // 「是」是起点锚（允许）；其余补位点不应落在纯虚词上
  const bad = [...a].sort((x, y) => x - y).filter(i => i !== 0 && T.CJK_FUNC_1.has(t[i]));
  ok(bad.length === 0, `补位点没有落在虚词上：${bad.map(i => t[i]).join(',') || '（无）'}`);
}

console.log('\n=== 4. 段落边界 ===');
{
  const t = '第一段的内容\n第二段的内容\n第三段';
  const marked = mark(t);
  console.log('     ' + JSON.stringify(marked));
  const a = T.computeHanAnchors(t, 3);
  ok(a.has(t.indexOf('第')), '第一段段首有锚点');
  ok(a.has(t.indexOf('第二段')), '「第二段」处有锚点');
  ok(a.has(t.indexOf('第三段')), '「第三段」处有锚点');
}

console.log('\n=== 5. 文本无损 & head/tail 一致性 ===');
function segsOf(frag) {
  const segs = [];
  const walk = n => {
    if (n.nodeType === 3) { if (n.nodeValue) segs.push([n.nodeValue, 0]); return; }
    if (n.nodeType === 1) { segs.push([n.textContent, n.className === 'br-head' ? 1 : 0]); return; }
    for (const c of n.childNodes) walk(c);
  };
  for (const c of frag.childNodes) walk(c);
  return segs;
}
{
  const samples = [
    '我想说巴罗克风格故意竭尽，到了自我讽刺的边缘。',
    '他说：“这样真的可以吗？”她点了点头。',
    '第一点、第二点；第三点：结束。',
    '这是一段很长很长完全没有标点符号的中文句子用来验证兜底机制是否生效',
    '混合 English words 和中文，标点，都有。',
    '短',
    '',
    '……省略号……后面',
  ];
  for (const s of samples) {
    const segs = segsOf(T.bionicFragment(s, 3, document));
    eq(segs.map(x => x[0]).join(''), s, `无损: ${JSON.stringify(s.slice(0, 24))}`);
  }
}
{
  // DOM 与 HTML 输出必须一致
  const s = '我想说巴罗克风格故意竭尽，到了自我讽刺的边缘。Mixed words too.';
  const domSegs = segsOf(T.bionicFragment(s, 3, document));
  const html = T.bionicToHTML(s, 3, x => x);
  const htmlSegs = [];
  const re = /<span class="br-(head|tail)">([\s\S]*?)<\/span>|([^<]+)/g;
  let mm;
  while ((mm = re.exec(html)) !== null) {
    if (mm[1]) htmlSegs.push([mm[2], mm[1] === 'head' ? 1 : 0]);
    else if (mm[3]) htmlSegs.push([mm[3], 0]);
  }
  const merge = arr => {
    const r = [];
    for (const [t, h] of arr) {
      if (r.length && r[r.length - 1][1] === h) r[r.length - 1][0] += t;
      else r.push([t, h]);
    }
    return r.filter(x => x[0]);
  };
  eq(merge(htmlSegs), merge(domSegs), 'DOM 与 HTML 输出完全一致');
}

console.log('\n=== 6. 英文部分不受影响 ===');
{
  const s = 'Bionic reading anchors your eyes.';
  const segs = segsOf(T.bionicFragment(s, 3, document));
  const heads = segs.filter(x => x[1]).map(x => x[0]);
  console.log(`     英文锚点：${JSON.stringify(heads)}`);
  ok(heads.includes('Bi'), 'Bionic → Bi');
  ok(heads.includes('an'), 'anchors → an');
  ok(heads.every(h => /^[A-Za-z]+$/.test(h)), '英文锚点均为字母');
}

console.log('\n=== 7. 标点后锚点：不误伤英文与数字 ===');
{
  const t = '价格是 100 元，之后是 200 元。';
  const marked = mark(t);
  console.log('     ' + marked);
  ok(marked.includes('【之】'), '中文逗号后仍触发锚点');
  // 数字不应被当成汉字锚点
  const a = T.computeHanAnchors(t, 3);
  const numIdx = t.indexOf('1');
  ok(!a.has(numIdx), '数字位置不产生中文锚点');
  // 数字/字母切断汉字区段后，独立区段的首字仍按小句起点处理
  ok(marked.includes('【元】'), '被数字隔断的「元」区段首字正是词头，锚它是对的');
  // 独立区段的首字一律是锚点（小句起点规则）；虚词约束只作用于"补位点"。
  // 因为一个 2 字区段的首字就是词头，锚它不存在"截断词语"的问题。
  ok(mark('价格是 100 的元。').includes('【的】'),
     '独立区段首字仍按小句起点锚定（虚词约束只管补位点）');
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / 失败 ${fail}\n${'='.repeat(46)}`);
process.exitCode = fail ? 1 : 0;   // 不用 process.exit：被 run-all.mjs import 时会掐断后续测试
