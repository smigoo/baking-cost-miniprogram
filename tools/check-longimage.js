// 长图绘制校验：月报 / 日报的长图是纯 canvas 手绘，坐标全靠算，
// 改一个区块高度就可能出现「文字压到右边数字上」「末块被截掉」「底部大片留白」。
// 这里用 mock canvas 2d 上下文把 buildReport + drawReport 真跑一遍，检查：
//   1. 不抛异常（含空数据 / 亏损 / 零营收 / 无销量等极端场景）
//   2. 所有文字坐标在画布内，且文本不超出画布宽度（clipText 是否生效）
//   3. blocks 累计高度不超过画布高度（防止末块被截）
//   4. 文本里不出现 undefined / NaN
//
// 用法：node tools/check-longimage.js [工程目录]
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..');
const W = 750;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

// ---- mock 微信环境 ----
const storage = {};
global.wx = {
  getStorageSync: k => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: k => { delete storage[k]; },
  showToast: () => {}, showModal: () => {}, showActionSheet: () => {},
  getAppBaseInfo: () => ({ theme: 'light' }),
  getWindowInfo: () => ({ pixelRatio: 2 }),
  canvasToTempFilePath: () => {}
};
let captured = null;
global.Page = obj => {
  obj.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  captured = obj;
};

const CN = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
function measure(text, fontPx) {
  let w = 0;
  for (const ch of String(text)) w += CN.test(ch) ? fontPx : fontPx * 0.56;
  return w;
}
function makeCtx() {
  const calls = [];
  let fontPx = 22;
  const ctx = {
    _calls: calls,
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    textAlign: 'left', textBaseline: 'alphabetic',
    measureText: s => ({ width: measure(s, fontPx) }),
    fillRect(x, y, w, h) { calls.push({ op: 'rect', x, y, w, h }); },
    fillText(t, x, y) { calls.push({ op: 'text', t: String(t), x, y, font: fontPx, align: ctx.textAlign }); },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {},
    fill() {}, stroke() {}, save() {}, restore() {}, scale() {}
  };
  Object.defineProperty(ctx, 'font', {
    get() { return fontPx + 'px sans-serif'; },
    set(v) { const m = /(\d+(?:\.\d+)?)px/.exec(String(v)); if (m) fontPx = +m[1]; }
  });
  return ctx;
}

const store = require(path.join(ROOT, 'utils/store.js'));
const exportUtil = require(path.join(ROOT, 'utils/export.js'));
store.init();
require(path.join(ROOT, 'pages/monthly/monthly.js'));
const monthlyPage = captured;

function run(plan, label, page) {
  const ctx = makeCtx();
  let thrown = null;
  try { page.drawReport(ctx, W, plan.H, exportUtil.getPalette(false), plan); }
  catch (e) { thrown = e; }
  ok(label + ' 绘制不抛异常', !thrown, thrown && thrown.message);
  if (thrown) return;

  ok(label + ' 高度合理', plan.H > 600 && plan.H < 3600, 'H=' + plan.H);

  const texts = ctx._calls.filter(c => c.op === 'text');
  ok(label + ' 有足够绘制内容', texts.length > 10, texts.length + ' 段');
  ok(label + ' 坐标无 NaN', texts.every(c => Number.isFinite(c.x) && Number.isFinite(c.y)));
  ok(label + ' 文字坐标不越界', texts.every(c => c.y >= 0 && c.y <= plan.H && c.x >= 0 && c.x <= W));
  ok(label + ' 无 undefined/NaN 文本', texts.every(c => !/undefined|null|NaN/.test(c.t)));

  const overflow = texts.filter(c => {
    const w = measure(c.t, c.font);
    if (c.align === 'right') return c.x - w < -2;
    if (c.align === 'center') return c.x + w / 2 > W + 2 || c.x - w / 2 < -2;
    return c.x + w > W + 2;
  });
  ok(label + ' 无文字溢出画布', overflow.length === 0,
    overflow.slice(0, 2).map(c => c.t).join(' | '));

  let y = plan.top;
  plan.blocks.forEach(b => { y += b.h + 26; });
  ok(label + ' 累计高度不超出画布', y <= plan.H + 1, y + ' ≤ ' + plan.H);
}

console.log('--- 月报长图 ---');
const m1 = monthlyPage.buildReport();
ok('月报 区块数 ≥5', m1.blocks.length >= 5, m1.blocks.length + ' 个');
ok('月报 盈亏平衡有判词', /回本|保本价/.test(m1.beText), m1.beText);
run(m1, '月报-示例', monthlyPage);

store.getState().goods.forEach(g => store.updateGood(g.id, 'name', '超长名称测试商品用了非常非常非常非常非常非常长的名字'));
run(monthlyPage.buildReport(), '月报-长名', monthlyPage);

store.getState().fixedCosts.forEach((f, i) => store.updateFixed(i, 'amount', 99999));
const m3 = monthlyPage.buildReport();
ok('月报 亏损月净利润带负号', m3.net.indexOf('-') >= 0, m3.net);
run(m3, '月报-亏损', monthlyPage);

store.getState().goods.forEach(g => store.updateGood(g.id, 'price', 0));
run(monthlyPage.buildReport(), '月报-零营收', monthlyPage);

const st = store.getState();
Object.keys(st.daily).forEach(date => {
  Object.keys(st.daily[date]).forEach(gid => store.setDaily(date, gid, 0));
});
const m5 = monthlyPage.buildReport();
ok('月报 无销量仍给判词', /回本|保本价/.test(m5.beText), m5.beText);
run(m5, '月报-无销量', monthlyPage);

// 覆盖率提示：日历格子删掉后，漏记信息并入 banner，这里守住「列漏记/未来月不列/无 NaN」
console.log('--- 月报覆盖率提示 ---');
store.reloadFromStorage(); // 恢复被上面用例改坏的销量/商品数据
const coverSt = store.getState();
const coverMonth = coverSt.curMonth;
const coverMm = coverMonth.slice(5);
const p2 = n => (n < 10 ? '0' + n : '' + n);
const dayNow = +coverSt.today.slice(8);
const missA = dayNow >= 8 ? 3 : 1, missB = dayNow >= 8 ? 7 : 2;
Object.keys(coverSt.daily).forEach(k => delete coverSt.daily[k]);
for (let d = 1; d <= dayNow; d++) {
  if (d !== missA && d !== missB) coverSt.daily[coverMonth + '-' + p2(d)] = { g1: 1 };
}
monthlyPage.refresh();
const lab1 = monthlyPage.data.covLabel;
ok('当月 列出漏记两天', lab1.includes('漏记 2 天') && lab1.includes(coverMm + '-' + p2(missA)) && lab1.includes(coverMm + '-' + p2(missB)), lab1);
store.setCurMonth(store.shiftMonth(coverMonth, 1));
monthlyPage.refresh();
ok('未来月 不列漏记日期', !monthlyPage.data.covLabel.includes('漏记'), monthlyPage.data.covLabel);
store.setCurMonth(coverMonth);
Object.keys(coverSt.daily).forEach(k => delete coverSt.daily[k]);
monthlyPage.refresh();
ok('无销量 提示无 NaN/undefined', !/NaN|undefined/.test(monthlyPage.data.covLabel), monthlyPage.data.covLabel);

console.log('\n===== 月报长图绘制校验: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' ' + pass + ' / FAIL ' + fail + ' =====');
process.exit(fail === 0 ? 0 : 1);
