// utils/store.js
// 烘焙成本小程序 · 数据层（状态 / 持久化 / 计算 / 变更）
// 微信原生小程序：CommonJS 模块，页面通过 require('../../utils/store.js') 使用。
// 模块级变量为单例，跨页面共享内存状态；每次变更后写 wx.setStorageSync 持久化。

const STORAGE_KEY = 'baking_state_v1';

// ===== 单位换算（单一事实源）：以克(g)为基准 =====
// 质量单位精确换算；体积单位按「1ml≈1g（水）」近似换算并显式标注口径。
// 注意：油/糖浆/蜂蜜/粉类密度≠1，体积→克重只是估算，不能当精确成本口径。
const UNIT_FACTOR = {
  // 质量（精确）
  g: 1, kg: 1000, jin: 500, liang: 50, lb: 453.59237, oz: 28.3495231, '500g': 500,
  // 体积（估算，1ml≈1g）
  ml: 1, L: 1000, tsp: 5, tbsp: 15, cup: 240
};
const UNIT_LABEL = {
  g: '克(g)', kg: '千克(kg)', jin: '斤', liang: '两', lb: '磅(lb)', oz: '盎司(oz)', '500g': '500g',
  ml: '毫升(ml)', L: '升(L)', tsp: '茶匙(tsp)', tbsp: '汤匙(tbsp)', cup: '量杯(cup)'
};
// 体积单位：克重为估算，各自给出换算口径供核对
const UNIT_IS_VOLUME = { ml: true, L: true, tsp: true, tbsp: true, cup: true };
const UNIT_VOLUME_HINT = {
  ml: '1ml≈1g', L: '1L=1000ml≈1000g', tsp: '1茶匙≈5ml≈5g',
  tbsp: '1汤匙≈15ml≈15g', cup: '1量杯≈240ml≈240g（美制）'
};
function unitOpts(sel) {
  return Object.keys(UNIT_FACTOR).map(u => ({ value: u, label: UNIT_LABEL[u], selected: u === sel }));
}
// picker 用索引定位，需返回当前单位在下拉中的位置，否则每次打开跳回第一项
function unitIndex(unit) { const i = Object.keys(UNIT_FACTOR).indexOf(unit); return i < 0 ? 0 : i; }
function volumeNote(unit) {
  if (!UNIT_IS_VOLUME[unit]) return '';
  return '按 ' + (UNIT_VOLUME_HINT[unit] || '1ml≈1g') + ' 估算；油/糖浆/粉类密度不同，实际克重会有偏差';
}
// 克重展示：大数整数千分位，小数保留 1~2 位，避免抖动
function fmtGram(g) {
  if (!g || g <= 0) return '0';
  if (g >= 100) return Math.round(g).toLocaleString('zh-CN');
  if (g >= 10) return g.toFixed(1);
  return g.toFixed(2);
}

// ===== 定价参数（全局，单一事实源） =====
// 口径说明：单价、时薪、产量全部按「用户自填」为准，不内置任何行业价格数据（不编造）。
// 0 表示「未设置」——计算时按 0 计入但必须显式标注，不允许静默当作真的没有成本。
const PRICING_DEFAULT = {
  hourlyRate: 0,        // 时薪（元/小时）；0 = 未设，人工不计并标注
  monthlyCapacity: 0,   // 月产能（件/月）；0 = 未设，固定分摊不计并标注
  targetMargin: 0.4,    // 目标净利率（0~0.95）
  channelFee: 0.006     // 渠道费率（微信支付约 0.6%，外卖平台需自行改）
};
// 示例数据版本：旧版示例参数与售价互相对不上（会导致所有示例商品红字「低于保本价」），
// 升级时对「仍是原样示例、未被改动过」的存档做一次性校准，不改用户自己加的数据。
const SAMPLE_VER = 2;

// 售价舍入：只能向上取到 0.5 元。向下取整会让建议价跌破保本价，绝对不允许。
function roundHalfUp(x) { return Math.ceil((+x || 0) * 2) / 2; }
function money2(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2); }

// ===== 状态（模块单例） =====
let materials = [];
let goods = [];
let fixedCosts = [];
let settings = Object.assign({}, PRICING_DEFAULT);
let daily = {};           // { 'YYYY-MM-DD': { gid: qty } }
let today = '';
let curDate = '';
let curMonth = '';
let pendingFocusGid = null; // 跨页下钻定位（毛利率预警 → 商品页）
let sampleVer = 0;          // 存档里的示例数据版本（旧存档无此字段 = 0）

// ===== 工具 =====
function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayStr() { return ymd(new Date()); }
function uid(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36); }
function fmt(n) {
  const sign = n < 0 ? '-' : '';
  return sign + '¥' + Math.round(Math.abs(n)).toLocaleString('zh-CN');
}
function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}
function shiftByDay(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return ymd(d); }
function monthCells(month) {
  const [y, mo] = month.split('-').map(Number);
  const startDow = new Date(y, mo - 1, 1).getDay();
  const days = new Date(y, mo, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(month + '-' + pad2(d));
  return cells;
}
function fmtDate(dStr) {
  const t = new Date(dStr + 'T00:00:00');
  const wk = ['日', '一', '二', '三', '四', '五', '六'][t.getDay()];
  return (t.getMonth() + 1) + '月' + t.getDate() + '日 周' + wk;
}

// ===== 计算 =====
function calcMaterial(m) {
  const grams = (m.amount || 0) * (UNIT_FACTOR[m.unit] || 1);
  const unitPrice = grams > 0 ? m.price / grams : 0; // 元/克
  return { grams, unitPrice };
}
function calcGood(g) {
  let c = 0;
  (g.recipe || []).forEach(r => {
    const m = materials.find(x => String(x.id) === String(r.m));
    if (m) c += calcMaterial(m).unitPrice * (r.g * (UNIT_FACTOR[r.unit] || 1));
  });
  c = c * (1 + (g.lossRate || 0));
  const cost = c, profit = g.price - c, margin = g.price > 0 ? (g.price - c) / g.price : 0;
  return { cost, profit, margin };
}

// ===== 建议售价（定价决策）=====
// 与 calcGood 的区别：calcGood 只算「材料成本」（用于日报/月报的真实成本），
// calcPricing 算的是「定价决策用的全成本」——材料 + 包装 + 人工 + 固定分摊 + 渠道费，
// 再按目标净利率反推建议售价。两套口径独立，不要互相引用：
//   · 月报表的固定成本按「已记录天数」折算（monthAgg）
//   · 定价的固定分摊按「月产能」折算（本函数）
// 混用会导致月底记录天数少时，单件固定成本被放大数倍。
function calcPricing(g) {
  const s = settings;
  const lossRate = Math.max(0, +g.lossRate || 0);
  const packCost = Math.max(0, +g.packCost || 0);
  const laborHours = Math.max(0, +g.laborHours || 0);
  const hourlyRate = Math.max(0, +s.hourlyRate || 0);
  const capacity = Math.max(0, +s.monthlyCapacity || 0);
  const fee = Math.min(Math.max(+s.channelFee || 0, 0), 0.5);
  const margin = Math.min(Math.max(+s.targetMargin || 0, 0), 0.95);

  // 材料：以配方逐行重算基础值，才能拆出「损耗」这一层的贡献
  let matBase = 0;
  (g.recipe || []).forEach(r => {
    const m = materials.find(x => String(x.id) === String(r.m));
    if (m) matBase += calcMaterial(m).unitPrice * (+r.g || 0) * (UNIT_FACTOR[r.unit] || 1);
  });
  const material = matBase * (1 + lossRate);
  const pack = packCost * (1 + lossRate);
  const labor = laborHours * hourlyRate;
  const fixedTotal = fixedCosts.reduce((a, f) => a + (+f.amount || 0), 0);
  const fixed = capacity > 0 ? fixedTotal / capacity : 0;

  const other = material + pack + labor + fixed;   // 不含渠道费的全成本
  const lackCapacity = capacity <= 0;
  const lackHourly = hourlyRate <= 0;
  const lackHours = laborHours <= 0;
  const lackPack = packCost <= 0;
  const noMaterial = material <= 0;
  // 净利率 + 渠道费率 ≥ 90% 时分母趋零会算出天价，直接不给建议价
  const badMargin = margin + fee >= 0.9;

  const breakEven = other > 0 && fee < 1 ? other / (1 - fee) : 0;
  const canSuggest = !noMaterial && !badMargin && other > 0;
  const suggest = canSuggest ? roundHalfUp(other / (1 - margin - fee)) : 0;
  const ideal = suggest > 0 ? roundHalfUp(suggest * 1.1) : 0;
  const earn = suggest > 0 ? suggest * margin : 0;          // 每个净赚
  const feeAmount = suggest > 0 ? suggest * fee : 0;        // 渠道抽走多少
  const multiple = material > 0 && suggest > 0 ? suggest / material : 0;

  const fill = (lack, val) => (lack ? '未填' : '¥' + money2(val));
  const detail = [
    { key: 'material', label: '材料', value: material, text: '¥' + money2(material), lack: false },
    { key: 'pack', label: '包装', value: pack, text: fill(lackPack, pack), lack: lackPack },
    { key: 'labor', label: '人工', value: labor, text: fill(lackHourly || lackHours, labor), lack: lackHourly || lackHours },
    { key: 'fixed', label: '固定分摊', value: fixed, text: fill(lackCapacity, fixed), lack: lackCapacity },
    { key: 'fee', label: '渠道费', value: feeAmount, text: suggest > 0 ? '¥' + money2(feeAmount) : '—', lack: false }
  ];

  // 与用户已填售价的对比结论：这是「融入现有售价字段」的核心，用户不必主动点开
  const price = +g.price || 0;
  let status = 'unknown', statusText = '', gap = 0;
  if (noMaterial) {
    status = 'unknown';
    statusText = '先补原料单价才能算建议价';
  } else if (badMargin) {
    status = 'unknown';
    statusText = '目标净利率与费率之和过高，请调整定价参数';
  } else if (price <= 0) {
    status = 'unset';
    statusText = '未定价 · 建议 ¥' + money2(suggest);
  } else if (price < breakEven) {
    status = 'loss';
    gap = breakEven - price;
    statusText = '低于保本价 ¥' + money2(breakEven) + ' · 每单亏 ¥' + money2(gap);
  } else if (price < suggest) {
    status = 'low';
    gap = suggest - price;
    statusText = '偏低 · 保本 ¥' + money2(breakEven) + '，建议 ¥' + money2(suggest);
  } else {
    status = 'ok';
    statusText = '定价健康 · 建议 ¥' + money2(suggest);
  }

  return {
    // detail 仅供调试/未来扩展；页面渲染不要用它做 wx:for ——
    // 成本项固定 5 行，静态行更稳（嵌套 wx:for + wx:key 曾触发渲染层崩溃）
    detail,
    material, pack, labor, fixed, feeAmount, other,
    breakEven, suggest, ideal, earn, multiple,
    // 逐项展示文本（页面直接绑定，不再在模板里循环 detail）
    materialText: '¥' + money2(material),
    packText: fill(lackPack, pack),
    laborText: fill(lackHourly || lackHours, labor),
    fixedText: fill(lackCapacity, fixed),
    feeText: suggest > 0 ? '¥' + money2(feeAmount) : '—',
    lackLabor: lackHourly || lackHours,
    otherText: other > 0 ? money2(other) : '—',
    breakEvenText: breakEven > 0 ? '¥' + money2(breakEven) : '—',
    suggestText: suggest > 0 ? '¥' + money2(suggest) : '—',    idealText: ideal > 0 ? '¥' + money2(ideal) : '—',
    earnText: suggest > 0 ? '¥' + money2(earn) : '—',
    multipleText: multiple > 0 ? multiple.toFixed(1) + ' 倍' : '—',
    // 倍率只作为「参数可能没填全」的嫌疑提示：材料占比低的商品（蛋糕这类人工重的），
    // 倍率天然就到 6~8 倍，参数齐全时再报警只会天天误伤，失去提示价值。
    multipleWarn: multiple > 6 && (lackHourly || lackCapacity || lackHours || lackPack),
    marginPct: Math.round(margin * 100),
    feePct: +(fee * 100).toFixed(2),
    lackCapacity, lackHourly, lackHours, lackPack, noMaterial, badMargin,
    // 缺项提示：缺什么就说什么，不让用户拿着偏低的价去卖
    lackNotes: [
      lackCapacity ? '未设月产能，固定成本未分摊，价格偏低' : '',
      lackHourly ? '未设时薪，人工未计入，价格偏低' : '',
      lackHours ? '该商品未填工时，人工按 0 计' : '',
      lackPack ? '未填包装耗材' : ''
    ].filter(Boolean),
    status, statusText, gap, price
  };
}
function daySummary(date) {
  const map = daily[date] || {};
  let rev = 0, cost = 0;
  goods.forEach(g => { const q = map[g.id] || 0; rev += g.price * q; cost += calcGood(g).cost * q; });
  const profit = rev - cost;
  return { rev, cost, profit, margin: rev > 0 ? profit / rev : 0 };
}
function monthAgg(month) {
  const [y, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  let rev = 0, matCost = 0, recordedDays = 0; const perGood = {};
  Object.entries(daily).forEach(([date, rec]) => {
    if (!date.startsWith(month)) return;
    let has = false;
    goods.forEach(g => {
      const q = rec[g.id] || 0;
      if (q) { rev += g.price * q; matCost += calcGood(g).cost * q; perGood[g.id] = (perGood[g.id] || 0) + q; has = true; }
    });
    if (has) recordedDays++;
  });
  const fixedTotal = fixedCosts.reduce((s, f) => s + (+f.amount || 0), 0);
  const fixed = daysInMonth > 0 ? fixedTotal * recordedDays / daysInMonth : 0; // 固定成本按已记录天数折算
  const gross = rev - matCost, net = gross - fixed;
  return {
    rev, matCost, fixed, fixedTotal, gross, net,
    netRate: rev > 0 ? net / rev : 0, grossRate: rev > 0 ? gross / rev : 0,
    perGood, recordedDays, daysInMonth
  };
}
function yearAgg(year) {
  const feb29 = new Date(+year, 1, 29).getDate() === 29;
  const daysInYear = feb29 ? 366 : 365;
  let rev = 0, matCost = 0, recordedDays = 0; const perGood = {};
  Object.entries(daily).forEach(([date, rec]) => {
    if (!date.startsWith(year)) return;
    let has = false;
    goods.forEach(g => {
      const q = rec[g.id] || 0;
      if (q) { rev += g.price * q; matCost += calcGood(g).cost * q; perGood[g.id] = (perGood[g.id] || 0) + q; has = true; }
    });
    if (has) recordedDays++;
  });
  const fixedTotal = fixedCosts.reduce((s, f) => s + (+f.amount || 0), 0);
  const fixed = daysInYear > 0 ? fixedTotal * recordedDays / daysInYear : 0;
  const gross = rev - matCost, net = gross - fixed;
  return {
    rev, matCost, fixed, fixedTotal, gross, net,
    netRate: rev > 0 ? net / rev : 0, grossRate: rev > 0 ? gross / rev : 0,
    perGood, recordedDays, daysInYear
  };
}

// ===== 持久化 =====
function save() {
  try {
    wx.setStorageSync(STORAGE_KEY, { materials, goods, fixedCosts, daily, settings, sampleVer });
  } catch (e) { /* 存储失败不影响内存态 */ }
}
// ===== 示例数据校准（一次性，只动「还是原样示例」的存档）=====
// 旧版示例：固定支出 2500 ÷ 产能 100（每件摊 25 元）+ 时薪 30，却配 12/8/28 的售价，
// 结果每个示例商品都判「低于保本价·每单亏」。用户填完用量看到红字，会当成程序报错。
// 这里只在「四要素全部仍是旧示例原值」时才校准，用户改过任何一项都不碰。
function migrateSample() {
  if (sampleVer >= SAMPLE_VER) return 0;
  const s = settings || {};
  const isOldSample =
    +s.hourlyRate === 30 && +s.monthlyCapacity === 100 &&
    fixedCosts.length === 2 &&
    fixedCosts.some(f => f.name === '房租' && +f.amount === 2000) &&
    fixedCosts.some(f => f.name === '水电' && +f.amount === 500) &&
    ['g1', 'g2', 'g3'].every(id => !!goods.find(g => g.id === id)) &&
    (goods.find(g => g.id === 'g1') || {}).price === 12 &&
    (goods.find(g => g.id === 'g2') || {}).price === 8 &&
    (goods.find(g => g.id === 'g3') || {}).price === 28;
  if (!isOldSample) { sampleVer = SAMPLE_VER; save(); return 0; }

  settings.hourlyRate = 20;
  settings.monthlyCapacity = 200;
  fixedCosts.forEach(f => {
    if (f.name === '房租') f.amount = 600;
    if (f.name === '水电') f.amount = 200;
  });
  const patch = { g1: { price: 22, laborHours: 0.1 }, g2: { price: 26, laborHours: 0.15 }, g3: { price: 45, laborHours: 0.5 } };
  Object.keys(patch).forEach(id => {
    const g = goods.find(x => x.id === id);
    if (g) Object.assign(g, patch[id]);
  });
  sampleVer = SAMPLE_VER;
  save();
  return 1;
}

function init() {
  let saved = null;
  try { saved = wx.getStorageSync(STORAGE_KEY); } catch (e) { saved = null; }
  // 判「有无存档」看整体结构，不能只看 materials 非空：
  // 用户把原料全删光后重进，旧写法会整份重新 seed，把商品与销量一起冲掉（数据丢失）。
  const hasArchive = !!(saved && (saved.materials || saved.goods || saved.daily));
  // 老存档没有 settings（定价参数是后加的），要按默认补齐并补存一次，否则每次进来都重算默认值
  const hasSettings = !!(saved && saved.settings);
  if (hasArchive) {
    materials = saved.materials || [];
    goods = saved.goods || [];
    fixedCosts = saved.fixedCosts || [];
    daily = saved.daily || {};
    settings = Object.assign({}, PRICING_DEFAULT, saved.settings || {});
    sampleVer = +saved.sampleVer || 0;
  } else {
    seed();
    save();
  }
  ensureUniqueIds();  // 先修复历史脏数据的 id 缺失/重复，保证后面所有按 id 的操作都是精确单条
  pruneBlankGoods();  // 再收敛历史堆积的空白商品壳（每次进入商品页也会再跑一次）
  migrateSample();    // 最后校准仍是原样的旧示例数据（不改用户自己加/改的数据）
  if (hasArchive && !hasSettings) save();  // 老存档补齐定价参数
  today = todayStr();
  curDate = today;
  curMonth = today.slice(0, 7);
}
// 孤儿配方只做「标记」不做删除：配方行引用的原料被删掉后，该行永远选不到原料、成本恒 0，
// 在卡片上表现为一片空白，看起来像空商品。这里在 getState 里给出 missing 标记，
// 由页面显示「原料已删除，请重选」，既不静默删用户数据，也不让用户误判。
// 内存与存储对不上时的兜底重载（仅在最坏状态下调用，如内存里原料/商品为空但存储里有）。
// 所有 mutator 都是「改完立即 save」，因此存储始终是权威版本，重载是安全的。
function reloadFromStorage() {
  let saved = null;
  try { saved = wx.getStorageSync(STORAGE_KEY); } catch (e) { return false; }
  if (!saved) return false;
  materials = Array.isArray(saved.materials) ? saved.materials : materials;
  goods = Array.isArray(saved.goods) ? saved.goods : goods;
  fixedCosts = Array.isArray(saved.fixedCosts) ? saved.fixedCosts : fixedCosts;
  daily = saved.daily && typeof saved.daily === 'object' ? saved.daily : daily;
  settings = Object.assign({}, PRICING_DEFAULT, saved.settings || settings);
  sampleVer = +saved.sampleVer || sampleVer;
  return true;
}
// id 自愈：早期版本/异常存档可能留下「无 id」或「id 重复」的商品。
// 这类数据下 goods.filter(x => x.id !== id) 会一次删掉一批（点 1 次全没了）。
// 启动时统一补齐为唯一非空字符串 id；数字 id 转字符串，避免与 WXML dataset 类型不一致。
// 注：重分配 id 的商品本身是空壳（无配方/无销量），daily 中若有同 id 销量记录按首个保留。
function ensureUniqueIds() {
  const seen = new Set();
  let changed = false;
  goods.forEach(g => {
    if (typeof g.id === 'number') { g.id = String(g.id); changed = true; }
    if (typeof g.id !== 'string' || !g.id || seen.has(g.id)) {
      g.id = uid('g');
      changed = true;
    }
    seen.add(g.id);
  });
  if (changed) save();
  return changed;
}
// 空壳判定（单一、可解释）：
//   · 有效商品：有配方 / 记过正数销量 / 名字非占位且售价非默认占位值 —— 一律保留
//   · 其余为空壳（含被改过名字、但没配方没销量没改售价的历史空卡）
// 「改过名字」不再作为保留依据：bindinput 随手打字也会写回 storage，
// 旧版只认占位名会把这类空壳全部漏掉。售价默认 10 是 addGood 的占位值。
function isBlankShell(g, usedIds) {
  if ((g.recipe && g.recipe.length) || usedIds.has(g.id)) return false;
  const nm = (g.name || '').trim();
  const named = !!nm && nm !== '新商品' && nm !== '商品名';
  const priceSet = !!(+g.price) && +g.price !== 10;
  if (named && priceSet) return false; // 认真填过名字+售价，哪怕还没加配方也保留
  return true;
}
// 空壳收敛：
//   · 只在空壳 ≥2 张时才动手；只保留最后一张作为「正在填写的草稿」，其余清除
//   · 只有 1 张草稿时完全不动，避免打扰用户正在录入的那一张
//   · 清理结果立即写回 storage，防止下次启动/切页又冒出来
//   · 返回本次清理张数（供页面决定是否提示），幂等：重复调用不会反复写盘
function pruneBlankGoods() {
  if (goods.length <= 1) return 0;
  const usedIds = new Set();
  Object.keys(daily).forEach(d => {
    const rec = daily[d] || {};
    Object.keys(rec).forEach(gid => { if (+rec[gid] > 0) usedIds.add(gid); });
  });
  const shells = goods.filter(g => isBlankShell(g, usedIds));
  if (shells.length <= 1) return 0;
  // 用对象引用而非 id 判定保留项：历史脏数据 id 重复时，按 id 比较会一次留下多个壳
  const keep = shells[shells.length - 1]; // 最新的草稿
  const removed = shells.length - 1;
  goods = goods.filter(g => !isBlankShell(g, usedIds) || g === keep);
  save();
  return removed;
}
function seed() {
  materials = [
    { id: 'm1', name: '高筋面粉', price: 5,  amount: 500, unit: 'g' },
    { id: 'm2', name: '黄油',     price: 18, amount: 200, unit: 'g' },
    { id: 'm3', name: '细砂糖',   price: 6,  amount: 400, unit: 'g' },
    { id: 'm4', name: '鸡蛋',     price: 12, amount: 1,   unit: 'jin' },
  ];
  // 默认只保留 3 个示例商品（与下方演示销量 g1/g2/g3 对应），避免一进来就是一堆占位卡片
  // packCost = 包装耗材（元/件，蛋糕盒+丝带这类）；laborHours = 制作工时（小时/件）
  // 示例数据必须「自洽」：售价、工时、固定支出、月产能要互相对得上。
  // 早期示例是「固定支出 2500 ÷ 产能 100 = 每件摊 25 元 + 人工 9 元」，却配 12 元售价 →
  // 一进商品页三个示例全是红线「低于保本价」。新用户会把这当成程序报错。
  // 现按「家庭私房、月出 200 件、房租水电 800、时薪 20」自洽，示例商品定价均在健康区间。
  goods = [
    { id: 'g1', name: '原味贝果', price: 22, lossRate: 0.05, packCost: 1.2, laborHours: 0.1,  recipe: [ { m: 'm1', g: 200, unit: 'g' }, { m: 'm2', g: 30, unit: 'g' } ] },
    { id: 'g2', name: '黄油曲奇', price: 26, lossRate: 0.03, packCost: 1.5, laborHours: 0.15, recipe: [ { m: 'm1', g: 100, unit: 'g' }, { m: 'm2', g: 50, unit: 'g' }, { m: 'm3', g: 30, unit: 'g' } ] },
    { id: 'g3', name: '草莓蛋糕', price: 45, lossRate: 0.02, packCost: 4,   laborHours: 0.5,  recipe: [ { m: 'm1', g: 80, unit: 'g' }, { m: 'm4', g: 100, unit: 'g' }, { m: 'm2', g: 20, unit: 'g' }, { m: 'm3', g: 40, unit: 'g' } ] },
  ];
  fixedCosts = [ { name: '房租', amount: 600 }, { name: '水电', amount: 200 } ];
  // 示例定价参数（示例值，页面上会标注「请按实际修改」）：
  // 时薪 20 元/时、月产能 200 件/月 —— 只为让新用户一进来就能看到一个算完且合理的建议价
  settings = { hourlyRate: 20, monthlyCapacity: 200, targetMargin: 0.4, channelFee: 0.006 };
  sampleVer = SAMPLE_VER;
  // 样例销量：相对今天生成（含 1 个未来日，演示「提前填预估」）
  const t = new Date();
  daily = {
    [shiftByDay(t, 0)]: { g1: 35, g2: 22, g3: 4 },
    [shiftByDay(t, -1)]: { g1: 28, g2: 18, g3: 6 },
    [shiftByDay(t, -2)]: { g1: 30, g2: 20, g3: 5 },
    [shiftByDay(t, 6)]: { g1: 40, g2: 25, g3: 10 },
  };
}

// ===== 状态快照（供页面渲染，附带派生计算结果） =====
function getState() {
  const matOptions = materials.map(m => ({ value: m.id, label: m.name }));
  return {
    materials: materials.map(m => { const cm = calcMaterial(m); return { ...m, ...cm, unitOpts: unitOpts(m.unit), unitIdx: unitIndex(m.unit), unitLabel: UNIT_LABEL[m.unit], unitPriceText: '¥' + cm.unitPrice.toFixed(3), gramsText: fmtGram(cm.grams), unitNote: volumeNote(m.unit) }; }),
    goods: goods.map(g => ({
      ...g, ...calcGood(g),
      // 老存档没有这两个字段，统一补 0，避免页面输入框显示 undefined
      packCost: +g.packCost || 0,
      laborHours: +g.laborHours || 0,
      pricing: calcPricing(g),
      matOptions,
      recipe: (g.recipe || []).map((r, i) => {
        const mat = materials.find(x => String(x.id) === String(r.m));
        const picked = r.m !== undefined && r.m !== null && r.m !== '';
        return {
          ...r,
          ri: i,                  // 行序号：给 WXML 的 wx:key 用（wx:key 只能指向 item 上的真实字段）
          matName: mat ? mat.name : '',
          picked,                 // 是否已选择原料（未选 = 待下拉选择，不是数据损坏）
          missing: picked && !mat, // 已选但原料已被删除：页面显示「原料已删除·重选」而不是一片空白
          unitOpts: unitOpts(r.unit || 'g'),
          unitIdx: unitIndex(r.unit || 'g'),
          unitLabel: UNIT_LABEL[r.unit || 'g']
        };
      })
    })),
    fixedCosts: fixedCosts.map((f, i) => ({ ...f, _i: i })),
    // 定价参数（全局）：页面直接显示 *Pct 字段，编辑时按百分数转回小数
    settings: {
      ...settings,
      hourlyRate: +settings.hourlyRate || 0,
      monthlyCapacity: +settings.monthlyCapacity || 0,
      targetMarginPct: Math.round((+settings.targetMargin || 0) * 100),
      channelFeePct: +((+settings.channelFee || 0) * 100).toFixed(2)
    },
    matOptions,
    daily, today, curDate, curMonth
  };
}

// ===== 原料 mutator =====
function addMaterial() { materials.push({ id: uid('m'), name: '新原料', price: 0, amount: 100, unit: 'g' }); save(); }
function updateMaterial(id, key, val) { const m = materials.find(x => String(x.id) === String(id)); if (m) m[key] = val; save(); }
// 同 deleteGood：精确删除一条，避免 id 为空/重复时批量误删原料
function deleteMaterial(id) {
  if (id === undefined || id === null || id === '') return 0;
  const idx = materials.findIndex(x => String(x.id) === String(id));
  if (idx < 0) return 0;
  materials.splice(idx, 1);
  save();
  return 1;
}

// ===== 商品 mutator =====
// 新增商品：若已存在「未填写的空商品」则不再堆叠，直接复用其 id，避免连点堆出一堆空白卡
function addGood() {
  const blank = goods.find(g => (!g.name || g.name === '新商品') && (!g.recipe || g.recipe.length === 0));
  // 复用已有草稿时也要保证 id 合法：历史脏数据可能留下无 id 的空壳，
  // 直接返回会让 WXML 的 data-gid 渲染成空值，点删除就变成「未识别到商品」。
  if (blank) { ensureUniqueIds(); save(); return blank.id; }
  const g = { id: uid('g'), name: '新商品', price: 10, lossRate: 0, recipe: [] };
  goods.push(g);
  ensureUniqueIds(); // 保证 id 为唯一非空字符串（g 是对象引用，被重分配后 g.id 同步更新）
  save();
  return g.id;
}
function updateGood(id, key, val) { const g = goods.find(x => String(x.id) === String(id)); if (g) g[key] = val; save(); }
// 精确删除「一条」：按索引 splice，绝不用 filter(x => x.id !== id)。
// 旧写法在 id 为空/重复时会一次删掉一批（用户点 1 次删除、整屏商品全没了）。
// 返回实际删除条数（0=未找到或 id 非法 / 1=已删），供页面决定是否提示。
function deleteGood(id) {
  if (id === undefined || id === null || id === '') return 0;
  const idx = goods.findIndex(x => String(x.id) === String(id));
  if (idx < 0) return 0;
  goods.splice(idx, 1);
  // 与删除确认文案一致：同步清除该商品在所有日期的销量记录，避免残留孤儿数据
  Object.keys(daily).forEach(d => { if (daily[d]) delete daily[d][id]; });
  save();
  return 1;
}
// 新增一行配方。返回值供页面判断结果，避免「点了没反应」的静默失败：
//   返回配方行对象 = 成功；返回 'NO_GOOD' = 商品不存在；返回 'NO_MATERIAL' = 原料库为空
// 原料库为空时不再写入 m:'' 的无效行——那样的行 picker 无选项、成本恒为 0，
// 用户看到的是「加进去了但选不到原料」，等同于加不了。
function addRecipe(gid) {
  let g = goods.find(x => String(x.id) === String(gid));
  // 内存态异常（商品或原料对不上）时先从存储重载一次，再判定，
  // 避免「明明原料页有原料，商品页却说没有」这种状态不同步造成的误拦截。
  if (!g || !materials.length) {
    if (reloadFromStorage()) g = goods.find(x => String(x.id) === String(gid));
  }
  if (!g) return 'NO_GOOD';
  if (!Array.isArray(materials) || !materials.length) return 'NO_MATERIAL';
  g.recipe = g.recipe || [];
  // 新增行默认「未选择原料」：页面会显示可点击的「选择原料 ▾」下拉，
  // 由用户自己选。原先默认塞第一种原料，会被误认为是一行不可改的静态文字。
  const row = { m: '', g: 100, unit: 'g' };
  g.recipe.push(row);
  save();
  return row;
}
function updateRecipe(gid, idx, key, val) {
  const g = goods.find(x => String(x.id) === String(gid)); if (!g || !g.recipe[idx]) return;
  if (key === 'm') {
    g.recipe[idx].m = val;
    const mm = materials.find(x => String(x.id) === String(val));
    if (mm) g.recipe[idx].unit = mm.unit; // 切换原料 → 配方单位同步为该原料采购单位
  } else {
    g.recipe[idx][key] = val;
  }
  save();
}
function deleteRecipe(gid, idx) {
  const g = goods.find(x => String(x.id) === String(gid)); if (!g) return;
  g.recipe.splice(idx, 1); save();
}

// ===== 每日销量 mutator（单条可编辑记录） =====
function setDaily(date, gid, qty) {
  const map = daily[date] || (daily[date] = {});
  map[gid] = qty; save();
}
function addDailyGood(date, gid) {
  const map = daily[date] || (daily[date] = {});
  if (!(gid in map)) map[gid] = 0;
  save();
}
function removeDailyGood(date, gid) {
  const map = daily[date] || (daily[date] = {});
  delete map[gid]; save(); // 仅从当天移除，不删商品库
}
function setCurDate(d) { curDate = d; }
function setCurMonth(m) { curMonth = m; }

// ===== 固定支出 mutator =====
function addFixed() { fixedCosts.push({ name: '其他', amount: 0 }); save(); }
function updateFixed(i, key, val) { if (fixedCosts[i]) fixedCosts[i][key] = val; save(); }
function deleteFixed(i) { fixedCosts.splice(i, 1); save(); }

// ===== 定价参数 mutator =====
// 白名单 + 上下限收敛：净利率 ≥ 100% 会让分母为负算出负价，费率过高会算出天价，都必须在入口挡住
const PRICING_RULE = {
  hourlyRate:      { min: 0, max: 10000 },
  monthlyCapacity: { min: 0, max: 100000 },
  targetMargin:    { min: 0, max: 0.95 },
  channelFee:      { min: 0, max: 0.5 }
};
function updateSetting(key, val) {
  const rule = PRICING_RULE[key];
  if (!rule) return false;
  let v = +val;
  if (!isFinite(v) || v < 0) v = 0;
  if (v < rule.min) v = rule.min;
  if (v > rule.max) v = rule.max;
  settings[key] = v;
  save();
  return true;
}
function getSettings() { return Object.assign({}, settings); }

// ===== 备份与恢复（数据只在本机，必须能导出/导回） =====
// 设计要点：
// 1) 备份是「全量快照」：原料、商品、固定支出、定价参数、每日销量一起走。
//    少任何一项，恢复后成本与报表都是错的（配方引用的原料 id 也在备份里才不失效）。
// 2) 导入前自动留一份「导入前快照」，导入不满意可一键撤销；撤销本身也留快照，可反悔。
// 3) 导入只做本地校验与合并，不联网不上传 —— 备份文件由用户自己保管（发聊天/收藏）。
const SNAPSHOT_KEY = 'baking_state_snapshot_v1';
const BACKUP_APP = 'baking-cost-miniprogram';
const BACKUP_SCHEMA = 1;

function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; } }
const numOr = (v, d) => { const n = +v; return isFinite(n) ? n : (d || 0); };

function dataStats() {
  return {
    materials: materials.length,
    goods: goods.length,
    fixedCosts: fixedCosts.length,
    dailyDays: Object.keys(daily).length
  };
}

function exportBundle() {
  return {
    app: BACKUP_APP,
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    counts: dataStats(),
    data: {
      materials: clone(materials) || [],
      goods: clone(goods) || [],
      fixedCosts: clone(fixedCosts) || [],
      daily: clone(daily) || {},
      settings: Object.assign({}, PRICING_DEFAULT, settings),
      sampleVer
    }
  };
}
function exportJSON() { return JSON.stringify(exportBundle()); }

// —— 清洗：导入的数据可能来自老版本、手改文本或被截断，逐字段收敛到合法结构 ——
function cleanMaterial(m) {
  if (!m || typeof m !== 'object') return null;
  const unit = UNIT_FACTOR[m.unit] ? m.unit : 'g';
  return {
    id: (m.id === undefined || m.id === null || m.id === '') ? uid('m') : String(m.id),
    name: typeof m.name === 'string' && m.name ? m.name : '未命名原料',
    price: Math.max(0, numOr(m.price)),
    amount: Math.max(0, numOr(m.amount)),
    unit
  };
}
function cleanRecipeRow(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    // 保留「未选原料」的空行：用户可能正填到一半，不该被静默丢弃
    m: (r.m === undefined || r.m === null) ? '' : String(r.m),
    g: Math.max(0, numOr(r.g)),
    unit: UNIT_FACTOR[r.unit] ? r.unit : 'g'
  };
}
function cleanGood(g) {
  if (!g || typeof g !== 'object') return null;
  return {
    id: (g.id === undefined || g.id === null || g.id === '') ? uid('g') : String(g.id),
    name: typeof g.name === 'string' && g.name ? g.name : '未命名商品',
    price: Math.max(0, numOr(g.price)),
    lossRate: Math.max(0, numOr(g.lossRate)),
    packCost: Math.max(0, numOr(g.packCost)),
    laborHours: Math.max(0, numOr(g.laborHours)),
    recipe: (Array.isArray(g.recipe) ? g.recipe : []).map(cleanRecipeRow).filter(Boolean)
  };
}
function cleanFixed(f) {
  if (!f || typeof f !== 'object') return null;
  return {
    name: typeof f.name === 'string' && f.name ? f.name : '未命名支出',
    amount: Math.max(0, numOr(f.amount))
  };
}
function cleanSettings(s) {
  const out = Object.assign({}, PRICING_DEFAULT, (s && typeof s === 'object') ? s : {});
  out.hourlyRate = Math.max(0, numOr(out.hourlyRate));
  out.monthlyCapacity = Math.max(0, numOr(out.monthlyCapacity));
  out.targetMargin = Math.min(Math.max(numOr(out.targetMargin), 0), 0.95);
  out.channelFee = Math.min(Math.max(numOr(out.channelFee), 0), 0.5);
  return out;
}
// 同一份备份内 id 重复时重新分配，否则合并/覆盖后又会回到「一删删一批」的老坑
function dedupeIds(list, prefix) {
  const seen = new Set();
  list.forEach(x => {
    if (seen.has(x.id)) x.id = uid(prefix);
    seen.add(x.id);
  });
}
// 真实日历校验：只靠正则会把 2026-13-99 也放进 daily，之后日历与月报表都会错位
function isValidYmd(k) {
  if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  const [y, mo, d] = k.split('-').map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}
function cleanDaily(d) {
  const out = {};
  if (!d || typeof d !== 'object') return out;
  Object.keys(d).forEach(k => {
    if (!isValidYmd(k)) return;
    const row = d[k];
    if (!row || typeof row !== 'object') return;
    const clean = {};
    Object.keys(row).forEach(gid => {
      const q = Math.max(0, numOr(row[gid]));
      if (q > 0) clean[String(gid)] = q;
    });
    if (Object.keys(clean).length) out[k] = clean;
  });
  return out;
}

// 校验并解析备份文本：页面先用它做「将导入多少条」的预览，再决定覆盖还是合并
function validateImport(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '内容是空的，请确认已选择备份文件或复制成功' };
  let raw = null;
  try { raw = JSON.parse(text); } catch (e) {
    return { ok: false, error: '不是合法的 JSON，可能复制时被截断了。请重新导出文件后导入' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '备份格式不正确' };
  if (raw.app && raw.app !== BACKUP_APP) return { ok: false, error: '这不是本小程序的备份（来源：' + raw.app + '）' };
  // 兼容两种：完整备份对象 {app,schema,data}，或用户手抄时只存了 data 本体
  const data = (raw.data && typeof raw.data === 'object') ? raw.data : raw;
  if (!Array.isArray(data.materials) && !Array.isArray(data.goods)) {
    return { ok: false, error: '备份里没有原料或商品数据，无法导入' };
  }
  const mats = (Array.isArray(data.materials) ? data.materials : []).map(cleanMaterial).filter(Boolean);
  const gs = (Array.isArray(data.goods) ? data.goods : []).map(cleanGood).filter(Boolean);
  dedupeIds(mats, 'm');
  dedupeIds(gs, 'g');
  const bundle = {
    app: BACKUP_APP,
    schema: BACKUP_SCHEMA,
    exportedAt: (typeof raw.exportedAt === 'string' ? raw.exportedAt : ''),
    data: {
      materials: mats,
      goods: gs,
      fixedCosts: (Array.isArray(data.fixedCosts) ? data.fixedCosts : []).map(cleanFixed).filter(Boolean),
      daily: cleanDaily(data.daily),
      settings: cleanSettings(data.settings)
    }
  };
  return {
    ok: true,
    bundle,
    exportedAt: bundle.exportedAt,
    counts: {
      materials: bundle.data.materials.length,
      goods: bundle.data.goods.length,
      fixedCosts: bundle.data.fixedCosts.length,
      dailyDays: Object.keys(bundle.data.daily).length
    }
  };
}

function readSnapshot() {
  let s = null;
  try { s = wx.getStorageSync(SNAPSHOT_KEY); } catch (e) { s = null; }
  return (s && s.data) ? s : null;
}
function snapshotNow() {
  const at = new Date().toISOString();
  try {
    wx.setStorageSync(SNAPSHOT_KEY, {
      at,
      counts: dataStats(),
      data: {
        materials: clone(materials) || [],
        goods: clone(goods) || [],
        fixedCosts: clone(fixedCosts) || [],
        daily: clone(daily) || {},
        settings: Object.assign({}, settings)
      }
    });
    return { ok: true, at };
  } catch (e) {
    return { ok: false, error: '本地存储写入失败（可能空间不足），为保护现有数据未执行导入' };
  }
}
function getSnapshotInfo() {
  const s = readSnapshot();
  if (!s) return { exists: false, at: '', counts: null };
  return { exists: true, at: s.at || '', counts: s.counts || null };
}

// 导入：replace = 用备份整体替换；merge = 保留现有，只补备份独有（同 id 一律本地优先）
function importBundle(bundle, mode) {
  if (!bundle || !bundle.data) return { ok: false, error: '备份内容无效' };
  const m = mode === 'replace' ? 'replace' : 'merge';
  const d = bundle.data;
  // 先留快照：快照失败就不导入，宁可不导入也不能让现有数据没了退路
  const snap = snapshotNow();
  if (!snap.ok) return { ok: false, error: snap.error };

  const stats = { mode: m, addedM: 0, addedG: 0, addedF: 0, addedDay: 0, skippedM: 0, skippedG: 0, skippedF: 0, skippedDay: 0 };

  if (m === 'replace') {
    materials = clone(d.materials) || [];
    goods = clone(d.goods) || [];
    fixedCosts = clone(d.fixedCosts) || [];
    daily = clone(d.daily) || {};
    settings = cleanSettings(d.settings);
    // 备份里带了示例数据版本就一并恢复，避免恢复后又被示例校准改一遍售价
    if (+d.sampleVer >= 0) sampleVer = +d.sampleVer || 0;
    stats.addedM = materials.length;
    stats.addedG = goods.length;
    stats.addedF = fixedCosts.length;
    stats.addedDay = Object.keys(daily).length;
  } else {
    const mIds = new Set(materials.map(x => String(x.id)));
    (d.materials || []).forEach(x => {
      if (mIds.has(String(x.id))) { stats.skippedM++; return; }
      materials.push(clone(x)); mIds.add(String(x.id)); stats.addedM++;
    });
    const gIds = new Set(goods.map(x => String(x.id)));
    (d.goods || []).forEach(x => {
      if (gIds.has(String(x.id))) { stats.skippedG++; return; }
      goods.push(clone(x)); gIds.add(String(x.id)); stats.addedG++;
    });
    // 固定支出没有 id，按「名称 + 金额」判重，避免每次合并都翻倍
    const fKeys = new Set(fixedCosts.map(f => (f.name || '') + '|' + numOr(f.amount)));
    (d.fixedCosts || []).forEach(x => {
      const k = (x.name || '') + '|' + numOr(x.amount);
      if (fKeys.has(k)) { stats.skippedF++; return; }
      fixedCosts.push(clone(x)); fKeys.add(k); stats.addedF++;
    });
    // 销量：同一天本地已有记录就整天跳过 —— 覆盖掉会把本机真实销量冲成旧值
    Object.keys(d.daily || {}).forEach(date => {
      if (daily[date] && Object.keys(daily[date]).length) { stats.skippedDay++; return; }
      daily[date] = clone(d.daily[date]); stats.addedDay++;
    });
    // 合并模式下不覆盖已有定价参数，只补空值（0 = 用户从未设置）
    settings = Object.assign({}, settings);
    ['hourlyRate', 'monthlyCapacity'].forEach(k => { if (!(+settings[k] > 0) && +d.settings[k] > 0) settings[k] = +d.settings[k]; });
    if (d.settings && +d.settings.targetMargin > 0) settings.targetMargin = +d.settings.targetMargin;
    if (d.settings && +d.settings.channelFee > 0) settings.channelFee = +d.settings.channelFee;
  }

  ensureUniqueIds();
  save();
  return { ok: true, stats, snapshotAt: snap.at };
}

// 撤销导入：把当前数据也存成快照（撤销本身可反悔），再恢复旧快照
function restoreSnapshot() {
  const s = readSnapshot();
  if (!s) return { ok: false, error: '没有可撤销的快照' };
  snapshotNow();
  materials = clone(s.data.materials) || [];
  goods = clone(s.data.goods) || [];
  fixedCosts = clone(s.data.fixedCosts) || [];
  daily = clone(s.data.daily) || {};
  settings = cleanSettings(s.data.settings);
  ensureUniqueIds();
  save();
  return { ok: true, at: s.at || '', counts: s.counts || dataStats() };
}

// ===== 跨页下钻定位 =====
function setPendingFocus(gid) { pendingFocusGid = gid; }
function getPendingFocus() { const g = pendingFocusGid; pendingFocusGid = null; return g; }

module.exports = {
  UNIT_FACTOR, UNIT_LABEL, UNIT_IS_VOLUME, UNIT_VOLUME_HINT, unitOpts, unitIndex, volumeNote,
  init, save, getState, pruneBlankGoods, reloadFromStorage, ensureUniqueIds,
  pad2, ymd, todayStr, shiftMonth, shiftByDay, monthCells, fmtDate, fmt,
  calcMaterial, calcGood, calcPricing, daySummary, monthAgg, yearAgg,
  PRICING_DEFAULT, roundHalfUp,
  addMaterial, updateMaterial, deleteMaterial,
  addGood, updateGood, deleteGood, addRecipe, updateRecipe, deleteRecipe,
  setDaily, addDailyGood, removeDailyGood, setCurDate, setCurMonth,
  addFixed, updateFixed, deleteFixed,
  updateSetting, getSettings,
  // 备份与恢复
  BACKUP_SCHEMA, dataStats, exportBundle, exportJSON, validateImport, importBundle,
  snapshotNow, getSnapshotInfo, restoreSnapshot,
  setPendingFocus, getPendingFocus
};
