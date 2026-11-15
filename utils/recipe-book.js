// utils/recipe-book.js
// 配方手册 · 纯计算层
//
// 设计原则：
// 1) 不 require store，只接收 `store.getState()` 的快照作为入参 —— 纯函数，可桩测试，
//    也不会出现「页面用一份 state、store 单例是另一份」的双数据源错位。
// 2) 单位换算只走 store 导出的 UNIT_FACTOR（以克为基准的单一事实源），不在这里另立一套。
// 3) 金额一律两位小数（store.fmt 是取整到元，颗粒度不够看单行原料成本）。
const store = require('./store.js');

const FACTOR = store.UNIT_FACTOR;

// 两位小数金额（不带 ¥，由模板决定前缀位置）。极小非零值显示 0.01，避免「有成本却显示 0.00」
function money2(n) {
  const v = +n || 0;
  if (v > 0 && v < 0.005) return '0.01';
  return v.toFixed(2);
}
// 百分比整数
function pct(n) { return Math.round((+n || 0) * 100); }

// 克数展示：与 store 内部 fmtGram 同口径，但独立实现（那边未导出，且需处理 0）
function gramText(g) {
  const v = +g || 0;
  if (v <= 0) return '0';
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

// ===== 视图一：按商品 =====
// 每个商品一张配方卡。行按「小计金额」降序 —— 成本大头自动顶到最上，
// 用户不需要自己心算哪样原料最贵。
function byGood(st) {
  const mats = (st && st.materials) || [];
  const goods = (st && st.goods) || [];
  const matMap = {};
  mats.forEach(m => { matMap[String(m.id)] = m; });

  return goods.map(g => {
    const lossRate = Math.max(0, +g.lossRate || 0);
    const rows = (g.recipe || []).map((r, i) => {
      const m = matMap[String(r.m)];
      const picked = r.m !== undefined && r.m !== null && r.m !== '';
      const grams = (+r.g || 0) * (FACTOR[r.unit] || 1);
      const sub = m ? (+m.unitPrice || 0) * grams : 0;
      return {
        ri: i,
        picked,
        missing: picked && !m,           // 已选原料但原料已被删：显式标注，不显示成空白
        matName: m ? m.name : (picked ? '原料已删除' : '未选原料'),
        amountText: picked && m ? String(+r.g || 0) : '—',
        unitLabel: m ? (store.UNIT_LABEL[r.unit] || r.unit || '') : '',
        grams,
        sub,
        subText: money2(sub)
      };
    });

    // 材料合计（不含损耗），作为占比分母
    const matBase = rows.reduce((a, r) => a + r.sub, 0);
    rows.forEach(r => {
      r.pct = matBase > 0 ? r.sub / matBase : 0;
      r.pctText = pct(r.pct);
      // 条宽：占比极小但真实存在的行也要有一点点长度，否则看起来像 0
      r.barW = r.sub > 0 ? Math.max(2, Math.round(r.pct * 100)) : 0;
    });
    rows.sort((a, b) => b.sub - a.sub || a.ri - b.ri);

    const lossAdd = matBase * lossRate;
    const cost = matBase + lossAdd;   // 与 store.calcGood 口径一致：材料 ×(1+损耗率)
    const price = +g.price || 0;
    const profit = price - cost;
    const margin = price > 0 ? (price - cost) / price : 0;

    return {
      id: g.id,
      name: g.name || '未命名商品',
      hasRecipe: rows.length > 0,
      rows,
      matBase,
      matBaseText: money2(matBase),
      lossRatePct: pct(lossRate),
      lossAdd,
      lossAddText: money2(lossAdd),
      hasLoss: lossAdd > 0,
      cost,
      costText: money2(cost),
      priceText: money2(price),
      profitText: money2(profit),
      marginText: (margin * 100).toFixed(1),
      marginBad: margin < 0.3,
      // 副标题在数据层拼好：模板里不写多段字符串拼接，少一处出错面
      metaText: '售价 ¥' + money2(price) + ' · 毛利 ¥' + money2(profit) +
        ' · 毛利率 ' + (margin * 100).toFixed(1) + '%'
    };
  });
}

// ===== 视图二：按原料反查 =====
// 每样原料被哪些商品使用、各用多少、各花多少钱。
// 这是「黄油涨价影响哪几个商品」的直接依据，也是后续涨价影响面分析的底座。
function byMaterial(st) {
  const mats = (st && st.materials) || [];
  const goods = (st && st.goods) || [];

  const list = mats.map(m => {
    const uses = [];
    let gramTotal = 0;
    let subTotal = 0;
    goods.forEach(g => {
      (g.recipe || []).forEach(r => {
        if (String(r.m) !== String(m.id)) return;
        const grams = (+r.g || 0) * (FACTOR[r.unit] || 1);
        const sub = (+m.unitPrice || 0) * grams;
        gramTotal += grams;
        subTotal += sub;
        uses.push({
          ui: uses.length,
          goodId: g.id,
          goodName: g.name || '未命名商品',
          amountText: String(+r.g || 0),
          unitLabel: store.UNIT_LABEL[r.unit] || r.unit || '',
          grams,
          sub,
          subText: money2(sub)
        });
      });
    });
    uses.sort((a, b) => b.sub - a.sub || a.ui - b.ui);

    return {
      id: m.id,
      name: m.name || '未命名原料',
      // 单价统一折成「元/kg」便于横向比较（原料单价内部是元/克，直接显示小数位太多）
      pricePerKgText: money2((+m.unitPrice || 0) * 1000),
      useCount: uses.length,
      uses,
      gramText: gramText(gramTotal),
      subTotal,
      subTotalText: money2(subTotal),
      metaText: uses.length > 0
        ? '被 ' + uses.length + ' 个商品使用 · 在这 ' + uses.length + ' 个商品里共花 ¥' + money2(subTotal) + ' · 合计 ' + gramText(gramTotal) + 'g'
        : '暂无商品使用'
    };
  });

  // 使用次数多的排前面；未被任何商品使用的原料沉到末尾但仍显示
  list.sort((a, b) => b.useCount - a.useCount || b.subTotal - a.subTotal);
  return list;
}

module.exports = { byGood, byMaterial, money2, pct, gramText };
