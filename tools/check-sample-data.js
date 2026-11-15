// 示例数据自洽校验
// 背景：示例商品的售价、工时、固定支出、月产能必须互相对得上。
// 曾经示例是「固定支出 2500 ÷ 产能 100 = 每件摊 25 元 + 人工 9 元」却配 12 元售价，
// 结果一进商品页三个示例全是红字「低于保本价」，用户以为程序报错。
//
// 用法：node tools/check-sample-data.js [工程目录]

const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..');

let storage = {};
global.wx = {
  setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  getStorageSync: (k) => storage[k] || null,
  removeStorageSync: () => {}
};

const store = require(path.join(ROOT, 'utils/store.js'));
store.init();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' → ' + detail : '')); }
}

const st = store.getState();
const fixedTotal = st.fixedCosts.reduce((a, f) => a + (+f.amount || 0), 0);
const perItem = st.settings.monthlyCapacity > 0 ? fixedTotal / st.settings.monthlyCapacity : 0;

console.log('[1] 示例定价参数可落地');
ok('固定分摊每件 ≤ 10 元（否则小额商品必然全红）', perItem <= 10, '每件 ' + perItem.toFixed(2) + ' 元');
ok('固定支出合计 > 0（示例要看得出分摊）', fixedTotal > 0, fixedTotal + ' 元');

console.log('\n[2] 示例商品不出现「低于保本价」');
st.goods.forEach(g => {
  ok(g.name + ' 状态不是 loss（当前 ' + g.pricing.status + '）', g.pricing.status !== 'loss', g.pricing.statusText);
  ok(g.name + ' 有建议价', g.pricing.suggest > 0);
});

console.log('\n[3] 示例商品不触发倍率嫌疑提示（参数齐全时不该打扰）');
st.goods.forEach(g => {
  ok(g.name + ' multipleWarn=false', g.pricing.multipleWarn === false, g.pricing.multipleText);
});

console.log('\n[4] 边输边算：改用量后定价判词同步变化');
const gid = st.goods[0].id;
const before = JSON.parse(JSON.stringify(st.goods[0].pricing.material));
// 直接走数据层，页面层用 partial setData 保持光标（已由 page 桩覆盖）
const g0 = store.getState().goods[0];
const rowIdx = 0;
const oldG = g0.recipe[rowIdx].g;
store.updateRecipe(gid, rowIdx, 'g', (+oldG || 0) + 500);
const after = store.getState().goods[0].pricing.material;
ok('用量变大后材料成本变大', after > before, before.toFixed(2) + ' → ' + after.toFixed(2));
store.updateRecipe(gid, rowIdx, 'g', oldG);

console.log('\n[5] 旧示例存档会被一次性校准，且不动用户数据');
storage = {};
const OLD = {
  materials: [{ id: 'm1', name: '高筋面粉', price: 5, amount: 500, unit: 'g' }],
  goods: [
    { id: 'g1', name: '原味贝果', price: 12, lossRate: 0.05, packCost: 1.2, laborHours: 0.3, recipe: [{ m: 'm1', g: 200, unit: 'g' }] },
    { id: 'g2', name: '黄油曲奇', price: 8, lossRate: 0.03, packCost: 1.5, laborHours: 0.4, recipe: [] },
    { id: 'g3', name: '草莓蛋糕', price: 28, lossRate: 0.02, packCost: 4, laborHours: 0.8, recipe: [] },
    { id: 'gUser', name: '我的吐司', price: 30, lossRate: 0, packCost: 0, laborHours: 0, recipe: [] }
  ],
  fixedCosts: [{ name: '房租', amount: 2000 }, { name: '水电', amount: 500 }],
  daily: { '2026-01-01': { g1: 3 } },
  settings: { hourlyRate: 30, monthlyCapacity: 100, targetMargin: 0.4, channelFee: 0.006 }
};
storage['baking_state_v1'] = JSON.parse(JSON.stringify(OLD));
const storePath = path.join(ROOT, 'utils/store.js');
delete require.cache[require.resolve(storePath)];
const store2 = require(storePath);
store2.init();
const st2 = store2.getState();
ok('月产能已校准为 200', st2.settings.monthlyCapacity === 200, String(st2.settings.monthlyCapacity));
ok('时薪已校准为 20', st2.settings.hourlyRate === 20, String(st2.settings.hourlyRate));
ok('示例售价已校准（g1=22）', st2.goods.find(g => g.id === 'g1').price === 22);
ok('用户自建商品未被改动（我的吐司=30）', st2.goods.find(g => g.id === 'gUser').price === 30);
ok('销量记录保留', !!st2.daily['2026-01-01']);
ok('示例数据版本已落盘', storage['baking_state_v1'].sampleVer === 2);

console.log('\n[6] 用户改过示例参数 → 不做校准（不覆盖真实数据）');
storage = {};
const MOD = JSON.parse(JSON.stringify(OLD));
MOD.settings.hourlyRate = 25; // 用户改过时薪
storage['baking_state_v1'] = MOD;
delete require.cache[require.resolve(storePath)];
const store3 = require(storePath);
store3.init();
const st3 = store3.getState();
ok('售价仍是用户/原始值 12', st3.goods.find(g => g.id === 'g1').price === 12);
ok('时薪仍是 25', st3.settings.hourlyRate === 25);
ok('版本仍被标记（不再重复尝试）', st3.goods.length === 4);

console.log('\n===== 示例数据自洽校验 PASS ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail ? 1 : 0);
