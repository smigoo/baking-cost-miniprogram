// 渲染契约校验：goods.wxml 里出现的每个 g.pricing.X / g.XXX，数据层必须真实产出。
// 背景：点「明细」报 Cannot read properties of undefined (reading '0')，
// 根因是模板引用了数据层没有的字段（以及嵌套 wx:for + wx:key）。
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (m) => { console.log('PASS ' + m); pass++; };
const bad = (m) => { console.log('FAIL ' + m); fail++; };

// ---- 起桩环境 ----
let storage = {};
global.wx = {
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  getStorageSync: (k) => storage[k] || null,
  removeStorageSync: () => {}
};
const store = require(path.join(ROOT, 'utils/store.js'));
store.init();
const st = store.getState();
const g0 = st.goods[0];

// ---- 抓模板里引用的 pricing 字段 ----
const wxml = fs.readFileSync(path.join(ROOT, 'pages/goods/goods.wxml'), 'utf8');
const fields = new Set();
for (const m of wxml.matchAll(/g\.pricing\.([A-Za-z_$][\w$]*)/g)) fields.add(m[1]);
console.log('模板引用 g.pricing.* 字段数 =', fields.size, '→', [...fields].join(', '));

let miss = 0;
fields.forEach(f => {
  if (g0.pricing[f] === undefined) { bad('pricing.' + f + ' 数据层未产出'); miss++; }
});
if (!miss) ok('g.pricing.* 全部字段均由 calcPricing 产出（' + fields.size + ' 个）');

// ---- 类型断言：字符串字段不能是 undefined（setData 里 undefined 会引发渲染异常） ----
['status', 'statusText', 'materialText', 'packText', 'laborText', 'fixedText', 'feeText',
 'otherText', 'breakEvenText', 'suggestText', 'earnText', 'multipleText'].forEach(k => {
  const v = g0.pricing[k];
  if (typeof v !== 'string') bad('pricing.' + k + ' 应为字符串，实际 ' + typeof v);
});
ok('12 个展示型字段均为字符串');

['lackPack', 'lackLabor', 'lackCapacity', 'lackHourly', 'lackHours'].forEach(k => {
  if (typeof g0.pricing[k] !== 'boolean') bad('pricing.' + k + ' 应为布尔，实际 ' + typeof g0.pricing[k]);
});
ok('5 个缺项标记均为布尔');

if (typeof g0.pricing.multiple !== 'number') bad('pricing.multiple 应为数字'); else ok('pricing.multiple 为数字');

// ---- 模板结构断言：不再有嵌套 wx:for ----
const panel = wxml.slice(wxml.indexOf('pricing-panel'), wxml.indexOf('pp-inputs'));
if (/wx:for/.test(panel)) bad('定价面板内仍有 wx:for（嵌套循环易触发渲染崩溃）');
else ok('定价面板为静态行，无嵌套 wx:for');
if (/wx:key="\*this"/.test(wxml)) bad('模板仍使用 wx:key="*this"'); else ok('无 wx:key="*this"');

// ---- 静态行完整性：5 项成本 + 3 个结论行 ----
['materialText', 'packText', 'laborText', 'fixedText', 'feeText'].forEach(k => {
  if (!wxml.includes('g.pricing.' + k)) bad('缺少成本行 ' + k);
});
ok('5 个成本行齐全（材料/包装/人工/固定分摊/渠道费）');
['otherText', 'breakEvenText', 'suggestText', 'earnText', 'multipleText'].forEach(k => {
  if (!wxml.includes('g.pricing.' + k)) bad('缺少结论行 ' + k);
});
ok('结论行齐全（全成本/保本价/建议价/净赚/倍率）');

// ---- 兜底：pricing 缺失时 decorate 不炸 ----
const goodsJs = fs.readFileSync(path.join(ROOT, 'pages/goods/goods.js'), 'utf8');
if (!/pricingSafe/.test(goodsJs)) bad('缺少 pricingSafe 兜底'); else ok('存在 pricingSafe 兜底');
if (!/pricing:\s*this\.pricingSafe\(/.test(goodsJs)) bad('decorate 未使用 pricingSafe'); else ok('decorate 已接入兜底');

console.log('\n===== 契约测试 PASS ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail ? 1 : 0);
