// 输入回写校验：确保「输入型控件」的 bindinput 回调不会把整个列表（或输入源字段）
// 重新 setData 下去 —— 那会让渲染层用旧值回填 input，用户表现为「框能点进去但打不了字」。
//
// 判定方式：桩一个 Page，跑真实回调，检查每次 setData 的 key：
//   禁止出现 'goods'（整体替换）
//   禁止出现以 recipe / name / price / packCost / laborHours / lossRateText 结尾的路径
//
// 用法：node tools/check-input-binding.js [工程目录]
const path = require('path');
const fs = require('fs');
const ROOT = process.argv[2] || path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

const goodsJs = path.join(ROOT, 'pages/goods/goods.js');
if (!fs.existsSync(goodsJs)) { console.log('FAIL 未找到 ' + goodsJs); process.exit(1); }

// ---- 小程序环境桩 ----
let storage = {};
global.wx = {
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  getStorageSync: k => storage[k] || null,
  removeStorageSync: () => {},
  showToast: () => {}, showModal: () => {}, switchTab: () => {}, pageScrollTo: () => {},
};
let pageDef = null;
global.Page = d => { pageDef = d; };
global.getApp = () => ({ globalData: {} });

require(goodsJs);
const store = require(path.join(ROOT, 'utils/store.js'));
store.init();

const patches = [];
const page = Object.assign({}, pageDef, { data: JSON.parse(JSON.stringify(pageDef.data || {})) });
page.setData = function (o) { patches.push(Object.keys(o)); Object.assign(this.data, o); };
page.refresh();

const list = page.data.goods;
ok('商品列表非空', list.length > 0, '实际 ' + list.length);

const gid = list[0].id;
const gi = list.findIndex(x => x.id === gid);
const row = list[gi].recipe[0];
ok('首个商品有配方行', !!row);

// input 源字段名单：这些字段出现在 setData key 里就意味着「边打字边回写」
const SOURCE = /\b(recipe|name|price|packCost|laborHours|lossRateText|unitIdx)\b/;

const check = (label, fn) => {
  const before = patches.length;
  fn();
  const keys = patches.length > before ? patches[patches.length - 1] : [];
  ok(label + ' → 载荷非空', keys.length > 0, JSON.stringify(keys));
  ok(label + ' → 不整体下发 goods', !keys.includes('goods'), JSON.stringify(keys));
  ok(label + ' → 不触碰输入源字段', !keys.some(k => SOURCE.test(k) || /\.recipe\b/.test(k)), JSON.stringify(keys));
  return keys;
};

if (row) {
  check('配方用量输入', () => page.onRecipeInput({ currentTarget: { dataset: { gid, gi, i: 0 } }, detail: { value: '120' } }));
  ok('用量已落存储', store.getState().goods.find(x => String(x.id) === String(gid)).recipe[0].g === 120);
  check('用量清空', () => page.onRecipeInput({ currentTarget: { dataset: { gid, gi, i: 0 } }, detail: { value: '' } }));
  ok('清空后按 0 存（不是 NaN）', store.getState().goods.find(x => String(x.id) === String(gid)).recipe[0].g === 0);
}

check('商品名称输入', () => page.onHeadInput({ currentTarget: { dataset: { gid, gi, k: 'name' } }, detail: { value: '改名测试' } }));
ok('名称已落存储', store.getState().goods.find(x => String(x.id) === String(gid)).name === '改名测试');
check('售价输入', () => page.onHeadInput({ currentTarget: { dataset: { gid, gi, k: 'price' } }, detail: { value: '33.5' } }));
ok('售价已落存储', store.getState().goods.find(x => String(x.id) === String(gid)).price === 33.5);
check('损耗率输入', () => page.onHeadInput({ currentTarget: { dataset: { gid, gi, k: 'loss' } }, detail: { value: '8' } }));
ok('损耗率按百分数落存储', Math.abs(store.getState().goods.find(x => String(x.id) === String(gid)).lossRate - 0.08) < 1e-9);
check('包装耗材输入', () => page.onPricingInput({ currentTarget: { dataset: { gid, gi, k: 'packCost' } }, detail: { value: '2.5' } }));
ok('包装费已落存储', store.getState().goods.find(x => String(x.id) === String(gid)).packCost === 2.5);
check('工时输入', () => page.onPricingInput({ currentTarget: { dataset: { gid, gi, k: 'laborHours' } }, detail: { value: '0.6' } }));
ok('工时已落存储', store.getState().goods.find(x => String(x.id) === String(gid)).laborHours === 0.6);

// 负值必须收敛，否则会算出负成本
check('包装费负数', () => page.onPricingInput({ currentTarget: { dataset: { gid, gi, k: 'packCost' } }, detail: { value: '-9' } }));
ok('负数收敛为 0', store.getState().goods.find(x => String(x.id) === String(gid)).packCost === 0);

// 派生值必须真的被刷新（否则修了回写却丢了「实时算」的价值）
const p = page.data.goods[gi].pricing;
ok('定价结果已同步到页面 data', !!p && typeof p.status === 'string' && p.statusText.length > 0, JSON.stringify(p && p.status));
ok('成本文案已同步', typeof page.data.goods[gi].costText === 'string' && page.data.goods[gi].costText.length > 0);

// 静态护栏：回调源码里不得再出现整体 setData({ goods })
const src = fs.readFileSync(goodsJs, 'utf8');
const inputFns = ['onRecipeInput', 'onHeadInput', 'onPricingInput'];
inputFns.forEach(fn => {
  const re = new RegExp('\\n  ' + fn + '\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}');
  const m = src.match(re);
  ok(fn + ' 源码存在', !!m);
  if (m) {
    ok(fn + ' 不含 setData({ goods })', !/setData\(\s*\{\s*goods\s*\}\s*\)/.test(m[1]), m[1].slice(0, 80));
    ok(fn + ' 不含 syncGood 调用', !/this\.syncGood\(/.test(m[1]));
  }
});

// ---- 原料页：进价/重量带小数，同样不能整体下发（否则「12.」被回写成「12」）----
const matPatches = [];
const matPage = (() => {
  let def = null;
  global.Page = d => { def = d; };
  delete require.cache[require.resolve(path.join(ROOT, 'pages/material/material.js'))];
  require(path.join(ROOT, 'pages/material/material.js'));
  const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data || {})) });
  p.setData = function (o) { matPatches.push(Object.keys(o)); Object.assign(this.data, o); };
  p.refresh();
  return p;
})();
ok('原料页列表非空', matPage.data.materials.length > 0, '实际 ' + matPage.data.materials.length);
{
  const mid = matPage.data.materials[0].id;
  const before = matPatches.length;
  matPage.onInput({ currentTarget: { dataset: { id: mid, k: 'price' } }, detail: { value: '12.5' } });
  const keys = matPatches.length > before ? matPatches[matPatches.length - 1] : [];
  ok('原料进价 → 不整体下发 materials', !keys.includes('materials'), JSON.stringify(keys));
  ok('原料进价 → 不触碰输入源', !keys.some(k => /\.(name|price|amount)$/.test(k)), JSON.stringify(keys));
  const m = store.getState().materials.find(x => String(x.id) === String(mid));
  ok('进价 12.5 已落存储', Math.abs(m.price - 12.5) < 1e-9, m.price);
  ok('每克单价随之更新', keys.some(k => /unitPriceText$/.test(k)), JSON.stringify(keys));
}

// ---- 报表页：固定支出金额允许小数，编辑行保留用户原样输入 ----
const fixPatches = [];
const fixPage = (() => {
  let def = null;
  global.Page = d => { def = d; };
  delete require.cache[require.resolve(path.join(ROOT, 'pages/monthly/monthly.js'))];
  require(path.join(ROOT, 'pages/monthly/monthly.js'));
  const p = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data || {})) });
  p.setData = function (o) {
    fixPatches.push(Object.keys(o));
    Object.keys(o).forEach(k => {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let cur = this.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined || cur[parts[i]] === null) cur[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = o[k];
    });
  };
  p.refresh();
  return p;
})();
{
  ok('固定支出列表非空', fixPage.data.fixedList.length > 0);
  fixPage.onFixedInput({ currentTarget: { dataset: { i: 0, k: 'amount' } }, detail: { value: '1500.' } });
  const row = fixPage.data.fixedList[0];
  ok('编辑中保留用户原样输入（1500. 不被规范化）', String(row.amount) === '1500.', String(row.amount));
  ok('存储侧按数字落盘', store.getState().fixedCosts[0].amount === 1500, store.getState().fixedCosts[0].amount);
  fixPage.onFixedBlur();
  fixPage.refresh();
  ok('失焦后回到存储值', String(fixPage.data.fixedList[0].amount) === '1500', String(fixPage.data.fixedList[0].amount));
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
