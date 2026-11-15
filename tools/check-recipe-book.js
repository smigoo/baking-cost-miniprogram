// 配方手册校验：计算口径 + 页面装配 + 模板取值契约
//
// 为什么要有这个脚本：
// 配方手册的核心价值是「金额算对、排序对、异常行不崩」。这三件事一旦回归，
// 用户看到的是「这个原料一分钱不花」或「成本大头排在末尾」，比没有这个页面更糟。
//
// 用法：node tools/check-recipe-book.js [工程目录]
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..');

// ---- wx mock：store 依赖 storage 接口 ----
const mem = {};
let switched = '';
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = v; },
  showToast: () => {},
  switchTab: o => { switched = o.url; if (o.success) o.success(); },
  navigateTo: o => { switched = o.url; }
};

let pageCfg = null;
global.Page = cfg => { pageCfg = cfg; };

const store = require(path.join(ROOT, 'utils/store.js'));
const book = require(path.join(ROOT, 'utils/recipe-book.js'));
store.init();
require(path.join(ROOT, 'pages/recipe/recipe.js'));

let pass = 0, fail = 0;
const ok = (msg, cond) => { if (cond) { pass++; } else { fail++; console.log('❌ ' + msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.005 : tol);

// ===== 1. 金额精度 =====
ok('money2 四舍五入到分', book.money2(12.345) === '12.35');
ok('money2 极小非零不显示 0.00', book.money2(0.003) === '0.01');
ok('money2 负数保留符号', book.money2(-3) === '-3.00');
ok('money2 undefined 兜底', book.money2(undefined) === '0.00');

// ===== 2. 单位换算 + 单行小计 + 损耗 + 毛利 =====
// 黄油 12 元/500g → 0.024 元/g；面粉 8 元/1kg → 0.008；牛奶 6 元/1kg → 0.006
const st = {
  materials: [
    { id: 'm1', name: '黄油', unitPrice: 12 / 500, unit: 'g' },
    { id: 'm2', name: '面粉', unitPrice: 8 / 1000, unit: 'g' },
    { id: 'm3', name: '牛奶', unitPrice: 6 / 1000, unit: 'g' }
  ],
  goods: [{
    id: 'g1', name: '曲奇', price: 30, lossRate: 0.05,
    recipe: [
      { m: 'm1', g: 200, unit: 'g' },  // 4.80
      { m: 'm2', g: 500, unit: 'g' },  // 4.00
      { m: 'm3', g: 100, unit: 'g' }   // 0.60
    ]
  }]
};
const g1 = book.byGood(st)[0];
ok('单行小计 = 用量 × 每克单价', near(g1.rows[0].sub, 4.8));
ok('材料合计 = 各行相加', near(g1.matBase, 9.4));
ok('损耗 = 材料 × 损耗率', near(g1.lossAdd, 0.47));
ok('成本 = 材料 + 损耗', near(g1.cost, 9.87));
ok('毛利 = 售价 - 成本', near(g1.profitText, 20.13));
ok('毛利率口径正确', g1.marginText === '67.1');

// ===== 3. 排序：金额降序 =====
ok('成本大头排第一', g1.rows[0].matName === '黄油');
ok('次大排第二', g1.rows[1].matName === '面粉');
ok('最小排末尾', g1.rows[2].matName === '牛奶');
ok('小计单调不递增', g1.rows[0].sub >= g1.rows[1].sub && g1.rows[1].sub >= g1.rows[2].sub);

// ===== 4. 占比与条宽 =====
ok('占比之和为 1', near(g1.rows.reduce((a, r) => a + r.pct, 0), 1, 1e-9));
ok('占比百分比正确', g1.rows[0].pctText === 51);
ok('条宽与占比一致', g1.rows[0].barW === 51);
ok('条宽不越界', g1.rows.every(r => r.barW >= 0 && r.barW <= 100));

// ===== 5. 异常行：已删原料 / 未选原料 / 用量 0 =====
const bad = book.byGood({
  materials: [{ id: 'm1', name: '黄油', unitPrice: 0.024, unit: 'g' }],
  goods: [{
    id: 'g9', name: '异常商品', price: 10, lossRate: 0,
    recipe: [
      { m: 'gone', g: 100, unit: 'g' },
      { m: '', g: 50, unit: 'g' },
      { m: 'm1', g: 0, unit: 'g' }
    ]
  }]
})[0];
ok('已删原料显式标注', bad.rows.some(r => r.matName === '原料已删除' && r.missing));
ok('未选原料显式标注', bad.rows.some(r => r.matName === '未选原料' && !r.picked));
ok('异常行小计为 0', bad.rows.every(r => near(r.sub, 0)));
ok('无成本时不画假进度条', bad.rows.every(r => r.barW === 0));
ok('零成本时毛利率不是 NaN', !isNaN(+bad.marginText));

// ===== 6. 边界：售价 0 / 无配方 / 无名称 =====
ok('售价 0 时毛利率 0.0', book.byGood({ materials: [], goods: [{ id: 'x', price: 0, recipe: [{ m: 'a', g: 1, unit: 'g' }] }] })[0].marginText === '0.0');
ok('无配方行 hasRecipe 为假', book.byGood({ materials: [], goods: [{ id: 'y', price: 0, recipe: [] }] })[0].hasRecipe === false);
ok('缺名称有兜底', book.byGood({ materials: [], goods: [{ id: 'z', recipe: [] }] })[0].name === '未命名商品');

// ===== 7. 按原料反查 =====
const st2 = {
  materials: [
    { id: 'm1', name: '黄油', unitPrice: 0.024, unit: 'g' },
    { id: 'm2', name: '面粉', unitPrice: 0.008, unit: 'g' },
    { id: 'm9', name: '闲置原料', unitPrice: 0.05, unit: 'g' }
  ],
  goods: [
    { id: 'g1', name: '曲奇', price: 30, recipe: [{ m: 'm1', g: 200, unit: 'g' }, { m: 'm2', g: 500, unit: 'g' }] },
    { id: 'g2', name: '蛋糕', price: 45, recipe: [{ m: 'm1', g: 80, unit: 'g' }] }
  ]
};
const byMat = book.byMaterial(st2);
ok('使用次数最多的排第一', byMat[0].name === '黄油');
ok('反查使用次数正确', byMat[0].useCount === 2);
ok('跨商品金额合计正确', near(byMat[0].subTotal, 6.72));
ok('跨商品用量合计正确', byMat[0].gramText === '280');
ok('反查明细按金额降序', byMat[0].uses[0].goodName === '曲奇' && byMat[0].uses[0].sub > byMat[0].uses[1].sub);
ok('单价折算元/kg', byMat[0].pricePerKgText === '24.00');
ok('闲置原料保留不隐藏', byMat.length === 3);
ok('闲置原料文案明确', byMat.find(x => x.name === '闲置原料').metaText === '暂无商品使用');
ok('闲置原料 uses 是空数组', byMat.find(x => x.name === '闲置原料').uses.length === 0);

// ===== 8. 空数据不崩 =====
ok('byGood({}) 返回空数组', book.byGood({}).length === 0);
ok('byMaterial({}) 返回空数组', book.byMaterial({}).length === 0);
ok('byGood(null) 不抛异常', Array.isArray(book.byGood(null)));
ok('byMaterial(null) 不抛异常', Array.isArray(book.byMaterial(null)));

// ===== 9. 同一原料多单位混用 =====
const u = book.byGood({
  materials: [{ id: 'm1', name: '黄油', unitPrice: 0.024, unit: 'g' }],
  goods: [{
    id: 'g1', name: '混合单位', price: 50, lossRate: 0,
    recipe: [
      { m: 'm1', g: 1, unit: 'kg' },
      { m: 'm1', g: 2, unit: 'jin' },
      { m: 'm1', g: 1, unit: 'cup' }
    ]
  }]
})[0];
ok('kg 换算正确', near(u.rows[0].sub, 24));
ok('混合单位合计正确', near(u.matBase, 53.76));
ok('保留原始单位展示', u.rows[0].unitLabel === '千克(kg)');

// ===== 10. 与数据层口径交叉核对 =====
const realSt = store.getState();
const realGood = book.byGood(realSt);
ok('商品数一致', realGood.length === realSt.goods.length);
ok('原料数一致', book.byMaterial(realSt).length === realSt.materials.length);
realSt.goods.forEach(g => {
  const c = realGood.find(x => String(x.id) === String(g.id));
  ok('「' + g.name + '」成本与 calcGood 一致', near(c.cost, +g.cost, 0.011));
  if (g.pricing && g.pricing.material !== undefined) {
    ok('「' + g.name + '」含损耗材料与 calcPricing.material 一致',
      near(c.matBase * (1 + (+g.lossRate || 0)), g.pricing.material, 0.011));
  }
});

// ===== 11. 页面装配与跳转 =====
function makePage() {
  const inst = Object.assign({}, pageCfg);
  inst.data = JSON.parse(JSON.stringify(pageCfg.data));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach(k => {
      if (k.indexOf('.') >= 0 || k.indexOf('[') >= 0) throw new Error('配方手册出现路径式 setData：' + k);
      inst.data[k] = patch[k];
    });
    if (cb) cb();
  };
  return inst;
}
const p = makePage();
p.onShow();
ok('按商品视图有数据', p.data.byGood.length > 0);
ok('按原料视图有数据', p.data.byMat.length > 0);
ok('hasGoods/hasMats 为真', p.data.hasGoods && p.data.hasMats);
ok('摘要非空', typeof p.data.summary === 'string' && p.data.summary.length > 0);
ok('默认视图为按商品', p.data.view === 'good');
p.onSwitch({ currentTarget: { dataset: { v: 'mat' } } });
ok('可切到按原料', p.data.view === 'mat');
p.onSwitch({ currentTarget: { dataset: {} } });
ok('dataset 缺失回落默认视图', p.data.view === 'good');
p.onSwitch(null);
ok('事件为 null 不抛异常', p.data.view === 'good');

const gid = p.data.byGood[0].id;
switched = '';
p.onEditGood({ currentTarget: { dataset: { gid } } });
ok('跳回商品页', switched === '/pages/goods/goods');
ok('带上待聚焦商品 id', store.getPendingFocus() === String(gid));
ok('pendingFocus 一次性消费', store.getPendingFocus() === null);
switched = '';
p.onEditGood({ currentTarget: { dataset: {} } });
ok('缺 gid 不误跳', switched === '');
switched = '';
p.onGoMaterial();
ok('去原料页跳转正确', switched === '/pages/material/material');

// ===== 12. 模板取值契约 =====
const wxml = fs.readFileSync(path.join(ROOT, 'pages/recipe/recipe.wxml'), 'utf8');
const p3 = makePage();
p3.onShow();
const aliasSample = {
  g: p3.data.byGood[0],
  m: p3.data.byMat[0],
  r: (p3.data.byGood.find(x => x.rows.length) || { rows: [] }).rows[0],
  u: (p3.data.byMat.find(x => x.uses.length) || { uses: [] }).uses[0]
};
const missing = new Set();
(wxml.match(/\{\{[^}]+\}\}/g) || []).forEach(e => {
  (e.match(/\b([grmu])\.[a-zA-Z_$][\w$]*/g) || []).forEach(tok => {
    const al = tok.split('.')[0], f = tok.split('.')[1];
    const s = aliasSample[al];
    if (s && !(f in s)) missing.add(tok);
  });
});
ok('模板引用的字段数据层都产出（缺：' + [...missing].join(',') + '）', missing.size === 0);

// 注意：match 带 g 标志时返回的是完整匹配字符串数组（不含捕获组），不能取 m[1]
const handlers = [...new Set((wxml.match(/bindtap="[^"]+"/g) || [])
  .map(s => s.replace(/^bindtap="/, '').replace(/"$/, '')))];
handlers.forEach(h => ok('事件处理函数存在：' + h, typeof pageCfg[h] === 'function'));

// 作用域红线：wx:key 不能是 *this；wx:for-index 不能与 item 字段同名
const keys = (wxml.match(/wx:key="([^"]+)"/g) || []).map(k => k.replace(/wx:key="|"/g, ''));
ok('没有 wx:key="*this"', keys.every(k => k !== '*this'));
ok('wx:key 数量合理', keys.length >= 3);
const idxNames = (wxml.match(/wx:for-index="([^"]+)"/g) || []).map(k => k.replace(/wx:for-index="|"/g, ''));
ok('wx:for-index 未与 item 字段 ri 同名', idxNames.indexOf('ri') === -1);
ok('wx:for-index 未与 item 字段 ui 同名', idxNames.indexOf('ui') === -1);
ok('每个 wx:for 都有 wx:for-item 别名', (wxml.match(/wx:for="/g) || []).length === (wxml.match(/wx:for-item="/g) || []).length);

// ===== 13. 入口注册 =====
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
ok('页面已在 app.json 注册', appJson.pages.indexOf('pages/recipe/recipe') >= 0);
ok('配方手册不在 tabBar（应从商品页进入）', !(appJson.tabBar.list || []).some(t => t.pagePath === 'pages/recipe/recipe'));
const goodsWxml = fs.readFileSync(path.join(ROOT, 'pages/goods/goods.wxml'), 'utf8');
ok('商品页有配方手册入口', /onOpenRecipeBook/.test(goodsWxml));
const goodsJs = fs.readFileSync(path.join(ROOT, 'pages/goods/goods.js'), 'utf8');
ok('商品页入口处理函数已实现', /onOpenRecipeBook\s*\(/.test(goodsJs));
ok('入口指向 recipe 页', /pages\/recipe\/recipe/.test(goodsJs));

console.log('\n===== 配方手册校验: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
