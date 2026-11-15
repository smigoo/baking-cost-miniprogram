// WXML 循环作用域静态校验：防止 wx:for-item 缺失导致整块变量解析不到（卡片退化为空壳）
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || require('path').join(__dirname, '..');

function walk(dir, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory() && d.name !== 'node_modules') walk(p, out);
    else if (d.name.endsWith('.wxml')) out.push(p);
  });
  return out;
}
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }

// 数据源：页面 js 的 setData 键 + store 导出的 state 键（宽松收集，宁可漏报不误报）
function collectDataKeys(jsFiles) {
  const keys = new Set();
  jsFiles.forEach(f => {
    const src = readText(f);
    (src.match(/data:\s*\{([\s\S]*?)\}/) || [, ''])[1].split(',').forEach(line => {
      const m = line.match(/^\s*([a-zA-Z_$][\w$]*)\s*:/);
      if (m) keys.add(m[1]);
    });
    [...src.matchAll(/([a-zA-Z_$][\w$]*)\s*[:,]\s*(?=[^=])/g)].forEach(m => { });
    [...src.matchAll(/setData\(\s*\{([\s\S]*?)\}\s*\)/g)].forEach(m => {
      (m[1].match(/([a-zA-Z_$][\w$]*)\s*:/g) || []).forEach(k => keys.add(k.replace(/\s*:$/, '').trim()));
    });
    [...src.matchAll(/^\s*([a-zA-Z_$][\w$]*)\s*:/gm)].forEach(m => keys.add(m[1]));
    [...src.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=/g)].forEach(m => keys.add(m[1]));
  });
  return keys;
}

let FAIL = 0, PASS = 0;
const fail = (msg) => { FAIL++; console.log(msg); };
const ok = () => { PASS++; };

const files = walk(ROOT);
const allJs = [];
(function walkJs(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory() && d.name !== 'node_modules') walkJs(p);
    else if (d.name.endsWith('.js')) allJs.push(p);
  });
})(ROOT);
const globalDataKeys = collectDataKeys(allJs);

files.forEach(f => {
  const src = readText(f);
  const rel = path.relative(ROOT, f);

  // 1. 标签平衡
  ['view', 'text', 'picker'].forEach(tag => {
    const open = (src.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
    const close = (src.match(new RegExp('</' + tag + '>', 'g')) || []).length;
    if (open !== close) fail('❌ ' + rel + ' <' + tag + '> 未闭合 open=' + open + ' close=' + close);
    else ok();
  });

  const forTags = src.match(/<[^>]*wx:for="[^"]*"[^>]*>/g) || [];

  // 循环声明过的别名
  const declared = new Set(['item', 'index']);
  forTags.forEach(t => { const m = t.match(/wx:for-item="([^"]+)"/); if (m) declared.add(m[1]); });

  // wx:for 的源数组名（如 goods / g.recipe / dayList），不算别名
  const forSources = new Set();
  forTags.forEach(t => {
    const m = t.match(/wx:for="\{\{\s*([^}]*?)\s*\}\}"/);
    if (m) { const root = m[1].split('.')[0].trim(); forSources.add(root); }
  });

  // 2. 别名必须在 wx:for-item 里声明过，否则整块取值落空
  const used = new Set();
  [...src.matchAll(/\{\{\s*([a-zA-Z_$][\w$]*)\s*\./g)].forEach(m => used.add(m[1]));
  used.forEach(alias => {
    if (alias === 'item' || alias === 'index') return ok();
    if (declared.has(alias)) return ok();
    if (forSources.has(alias)) return ok();          // 是循环源，不是别名
    if (globalDataKeys.has(alias)) return ok();      // 是页面 data 字段
    fail('❌ ' + rel + ' 使用了 {{' + alias + '.xxx}} 但既不是 wx:for-item 也不是页面 data 字段');
  });

  // 3. wx:key 必须指向数据里真实存在的字段（全量 js 里搜，含 utils/store.js 注入）
  forTags.forEach(t => {
    const k = t.match(/wx:key="([^"]+)"/);
    if (!k || k[1] === '*this') return;
    const key = k[1];
    const hit = allJs.some(js => new RegExp('\\b' + key + '\\s*[=:]').test(readText(js)));
    if (!hit) fail('⚠️  ' + rel + ' wx:key="' + key + '" 在全部 js 中找不到该字段的构造');
    else ok();
  });
});

// 4. 硬断言：商品卡必须声明 wx:for-item="g"（本次事故的回归锚点）
const goodsWxml = readText(path.join(ROOT, 'pages/goods/goods.wxml'));
if (/wx:for="\{\{goods\}\}"[^>]*wx:for-item="g"/.test(goodsWxml)) { ok(); console.log('✅ 回归锚点：goods.wxml 已声明 wx:for-item="g"'); }
else fail('❌ 回归锚点缺失：goods.wxml 的 goods 循环没有 wx:for-item="g"');

// 5. 硬断言：配方行 wx:key 为 ri，且 store 注入 ri
const storeJs = readText(path.join(ROOT, 'utils/store.js'));
if (/wx:key="ri"/.test(goodsWxml) && /ri:\s*i/.test(storeJs)) { ok(); console.log('✅ 回归锚点：配方行 wx:key="ri" + store 注入 ri'); }
else fail('❌ 回归锚点缺失：配方行 wx:key / store ri 注入不匹配');

console.log('\n===== WXML 校验: PASS ' + PASS + ' / FAIL ' + FAIL + ' =====');
process.exit(FAIL ? 1 : 0);
