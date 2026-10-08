// 跑全部测试并汇总。用法：node tests/run-all.mjs
//
// ★ 为什么用 import 而不是 spawn 子进程：
//   本机沙箱禁止程序打开命名管道，而 Node 的 child_process 用管道抓输出，
//   于是 spawnSync 直接 EPERM（见 接续说明.md 第六节记录过的同类限制）。
//   改成**在同一个进程里按顺序 import** 各测试文件 —— 反而更好：
//     · 无子进程开销，跑得更快
//     · 不受任何平台的管道/权限限制
//     · 每个文件仍是独立模块，互不干扰（各自有独立的 JSDOM 实例）
//
// 为了让汇总准确，各测试文件末尾的 process.exit 已改为"只设退出码"，
// 由本入口统一决定最终退出码。

import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(here)
  .filter(f => f.endsWith('.mjs') && (f === 'test.mjs' || f.startsWith('test-')))
  .filter(f => f !== 'test-perf.mjs')     // 性能测试耗时长，单独跑
  .sort();

if (!files.length) {
  console.error('没有找到任何测试文件');
  process.exit(1);
}

console.log(`\n跑 ${files.length} 个测试文件（同进程顺序执行）\n${'─'.repeat(58)}`);

const results = [];

for (const f of files) {
  const before = process.exitCode;
  process.exitCode = 0;                    // 每个文件独立判定
  let crashed = null;
  let out = '';

  // 截获该文件的标准输出，好在汇总里提取"通过/失败"
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => { out += a.join(' ') + '\n'; };
  console.error = (...a) => { out += a.join(' ') + '\n'; };

  try {
    await import(pathToFileURL(join(here, f)).href);
  } catch (e) {
    crashed = e;
  } finally {
    console.log = origLog;
    console.error = origErr;
  }

  process.exitCode = before;

  const m = out.match(/通过\s*(\d+)\s*\/\s*失败\s*(\d+)/);
  if (crashed || !m) {
    results.push({ f, crash: true, msg: crashed ? crashed.message : '没有输出汇总行' });
    origLog(`  ${f.padEnd(26)}💥 ${crashed ? crashed.message : '没有汇总行'}`);
    if (out.trim()) {
      for (const l of out.trim().split('\n').slice(-4)) origLog(`      ${l}`);
    }
    continue;
  }

  const pass = +m[1], fail = +m[2];
  results.push({ f, pass, fail });
  origLog(`  ${f.padEnd(26)}${fail === 0 ? `✓ ${pass} 项` : `✗ ${pass} 通过 / ${fail} 失败`}`);
  if (fail > 0) {
    for (const l of out.split('\n').filter(x => x.includes('FAIL')).slice(0, 5)) {
      origLog(`      ${l.trim()}`);
    }
  }
}

const ok = results.filter(r => !r.crash);
const crashed = results.filter(r => r.crash);
const totalPass = ok.reduce((a, r) => a + r.pass, 0);
const totalFail = ok.reduce((a, r) => a + r.fail, 0);

console.log('─'.repeat(58));
console.log(`合计：通过 ${totalPass} / 失败 ${totalFail}` +
  (crashed.length ? `，崩溃 ${crashed.length} 个（${crashed.map(c => c.f).join(', ')}）` : ''));
console.log('');

process.exitCode = (totalFail || crashed.length) ? 1 : 0;
