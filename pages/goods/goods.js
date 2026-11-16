// pages/goods/goods.js
const store = require('../../utils/store.js');

// 定价状态 → 徽标文案（颜色由 wxss 的 .pricing-bar.ok/.low/.loss/.unset/.unknown 决定）
const PRICING_TAG = { ok: '定价健康', low: '定价偏低', loss: '低于保本', unset: '未定价', unknown: '待补全' };

Page({
  data: { goods: [], keyword: '' },

  onShow() {
    // 每次切到商品页都收敛一次历史空壳（不依赖「重新编译」，切 tab 即生效）。
    // 幂等：清完只剩 1 张草稿后不再写盘、不再提示；有配方/有销量/填过名字+售价的商品一律保留。
    const removed = store.pruneBlankGoods();
    this.refresh();
    if (removed > 0) wx.showToast({ title: '已收起 ' + removed + ' 个空白商品', icon: 'none', duration: 1500 });
    const gid = store.getPendingFocus();
    if (gid && this.data.keyword) {
      // 从配方手册跳回来定位某商品，但当前有搜索词可能把它过滤掉 → 先清搜索再定位
      this.setData({ keyword: '' });
      this.refresh();
    }
    if (gid && this.data.goods.some(g => g.id === gid)) {
      const goods = this.data.goods.map(x => ({ ...x, collapsed: x.id !== gid }));
      this.setData({ goods });
      this.scrollToGood(gid);
    }
  },

  // 滚动到指定卡片。卡片可能已被收敛/删除，selector 找不到节点时不必打扰控制台。
  scrollToGood(gid) {
    setTimeout(() => {
      if (!this.data.goods.some(x => String(x.id) === String(gid))) return;
      wx.pageScrollTo({ selector: '#good-' + gid, offsetTop: 20, fail: () => {} });
    }, 60);
  },

  // 统一解析商品 id：优先 dataset.gid；框架层 dataset 偶发丢失（列表节点复用）时，
  // 用 wx:for 的索引 data-gi 从当前页数据兜底，最后再试 target.dataset。
  // allowExpandedFallback=false 时不做「唯一展开卡」兜底——删除这类破坏性操作宁可不做，
  // 也不能因为猜错卡片而删掉用户别的商品。
  resolveGid(e, allowExpandedFallback) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const tds = (e && e.target && e.target.dataset) || {};
    if (ds.gid !== undefined && ds.gid !== null && ds.gid !== '') return String(ds.gid);
    if (tds.gid !== undefined && tds.gid !== null && tds.gid !== '') return String(tds.gid);
    const raw = ds.gi !== undefined ? ds.gi : tds.gi;
    const gi = Number(raw);
    if (raw !== undefined && Number.isInteger(gi) && gi >= 0 && this.data.goods[gi]) return String(this.data.goods[gi].id);
    if (allowExpandedFallback === false) return null;
    // 最后兜底：页面上只有一张展开的卡时，点它内部的按钮（如 + 加原料）一定是冲这张卡来的
    const expanded = this.data.goods.filter(x => !x.collapsed);
    if (expanded.length === 1 && expanded[0].id) return String(expanded[0].id);
    return null;
  },

  // 定价对象兜底：数据层正常时一定带 pricing，但模板里有多处 g.pricing.xxx，
  // 一旦某条商品缺 pricing（历史存档 / 中途新增），模板取值会直接抛渲染错误。
  // 这里统一补一个结构完整的空壳，坏数据显示「—」，不崩页面。
  pricingSafe(p) {
    if (p && typeof p === 'object') return p;
    return {
      status: 'unknown', statusText: '补全原料单价后才能算建议价',
      materialText: '—', packText: '—', laborText: '—', fixedText: '—', feeText: '—',
      otherText: '—', breakEvenText: '—', suggestText: '—', earnText: '—', multipleText: '—',
      multiple: 0, lackCapacity: false, lackHourly: false, lackHours: false, lackPack: false
    };
  },

  decorate(g, collapsed, pricingOpen) {
    return {
      ...g, collapsed, pricingOpen: !!pricingOpen,
      pricing: this.pricingSafe(g.pricing),
      pricingTag: PRICING_TAG[(g.pricing && g.pricing.status) || 'unknown'] || '待补全',
      // 折叠态也要看到「实际售价」：售价输入框在 good-body 里，折叠后隐藏，
      // 故在主卡头下方常驻这条定价提示里补一个售价数字（两位小数，与建议价口径一致）。
      priceText: Number(g.price || 0).toFixed(2),
      costText: store.fmt(g.cost),
      profitText: store.fmt(g.profit),
      marginText: (g.margin * 100).toFixed(1),
      marginColor: g.margin < 0.3 ? '#CF6A4F' : '#8BAE6B',
      lossRateText: (g.lossRate * 100).toFixed(0)
    };
  },

  refresh() {
    const st = store.getState();
    const prev = this.data.goods;
    // 只渲染带合法 id 的商品：杜绝「无 id 的幽灵卡」——这类卡片 data-gid 为空，
    // 表现为一张空白卡且点删除永远提示「未识别到商品」。
    const all = st.goods.filter(g => g && g.id !== undefined && g.id !== null && g.id !== '');
    // 名称模糊搜索（忽略大小写/首尾空格）。基于全量 all 过滤，不能用 this.data.goods
    // （那是上次过滤结果，会越搜越少）。prev 仍按 id 匹配折叠态，过滤不影响状态保留。
    const q = String(this.data.keyword || '').trim().toLowerCase();
    const list = q ? all.filter(g => String(g.name || '').toLowerCase().indexOf(q) >= 0) : all;
    this.setData({
      goods: list.map(g => {
        const p = prev.find(x => x.id === g.id);
        const collapsed = p ? p.collapsed : (list.indexOf(g) !== 0);
        // pricingOpen 与 collapsed 一样属于「页面态」，刷新时保留，不能被计算值重建冲掉
        return this.decorate(g, collapsed, p ? p.pricingOpen : false);
      })
    });
  },

  // 搜索框输入：keyword 是独立搜索态，不是商品字段，整体 setData 列表不会打断
  // 商品名/售价等输入框的光标（那些走 patchDerived，红线见 check-input-binding）。
  onSearch(e) {
    this.setData({ keyword: e.detail.value || '' });
    this.refresh();
  },

  onClearSearch() {
    this.setData({ keyword: '' });
    this.refresh();
  },

  // 局部同步某商品卡片（保留 collapsed，更新派生计算值）。
  // 只用于 picker（选原料/选单位）这类「选择型」控件：它们必须看到新的 recipe 行。
  // 输入型控件（用量/售价/名称/损耗/包装/工时）一律走 patchDerived，理由见其注释。
  syncGood(gid) {
    const st = store.getState();
    const ng = st.goods.find(x => String(x.id) === String(gid));
    if (!ng) return;
    const goods = this.data.goods.map(x => String(x.id) === String(gid) ? this.decorate(ng, x.collapsed, x.pricingOpen) : x);
    this.setData({ goods });
  },

  // 只回写「派生计算值」，用路径式 setData 精确更新到 goods[gi].xxx。
  //
  // 为什么不能用 `this.setData({ goods })`：那样会把 recipe / name / price /
  // packCost / laborHours 等**输入源**一起下发，渲染层会用 data 里的旧值回填 input ——
  // 表现就是「框能点进去但打不了字」「打一个字跳回原值」（输 10 只剩 1）。
  //
  // 但也不能完全不更新 data：否则点开/收起明细、切 tab 回来这类重渲染，
  // 会拿 data 里的旧值重建输入框。所以输入源**静默写进 data 内存（不 setData）**——
  // 不触发渲染、不打断光标，而 data 始终与存储一致。
  patchDerived(gid) {
    const gi = this.data.goods.findIndex(x => String(x.id) === String(gid));
    if (gi < 0) return;
    const st = store.getState();
    const ng = st.goods.find(x => String(x.id) === String(gid));
    if (!ng) return;
    const cur = this.data.goods[gi];

    // 1) 输入源：只写内存，不下发
    cur.name = ng.name;
    cur.price = ng.price;
    cur.packCost = ng.packCost;
    cur.laborHours = ng.laborHours;
    cur.lossRate = ng.lossRate;
    cur.lossRateText = (ng.lossRate * 100).toFixed(0);
    if (cur.recipe && ng.recipe) {
      ng.recipe.forEach((r, i) => { if (cur.recipe[i]) cur.recipe[i].g = r.g; });
    }

    // 2) 派生值：路径式下发，精确到字段，不碰其它节点
    const d = this.decorate(ng, cur.collapsed, cur.pricingOpen);
    const base = 'goods[' + gi + ']';
    this.setData({
      [base + '.cost']: d.cost,
      [base + '.profit']: d.profit,
      [base + '.margin']: d.margin,
      [base + '.costText']: d.costText,
      [base + '.profitText']: d.profitText,
      [base + '.marginText']: d.marginText,
      [base + '.marginColor']: d.marginColor,
      [base + '.pricing']: d.pricing,
      [base + '.pricingTag']: d.pricingTag,
      [base + '.priceText']: d.priceText
    });
  },

  onToggleHead(e) {
    const gid = this.resolveGid(e);
    if (!gid) return;
    const cur = this.data.goods.find(x => x.id === gid);
    const wasCollapsed = !cur || cur.collapsed;
    // 展开：只留这一张；收起：只收这一张，不动其它卡
    const goods = this.data.goods.map(x => {
      if (x.id === gid) return { ...x, collapsed: !wasCollapsed };
      return wasCollapsed ? { ...x, collapsed: true } : x;
    });
    this.setData({ goods });
  },

  onHeadInput(e) {
    const gid = this.resolveGid(e), k = e.currentTarget.dataset.k;
    if (!gid) return; // 解析不到 id 时不覆盖用户输入，避免文字「输入后被吞掉」
    const v = e.detail.value;
    if (k === 'name') store.updateGood(gid, 'name', v);
    else if (k === 'loss') store.updateGood(gid, 'lossRate', (+v || 0) / 100);
    else store.updateGood(gid, 'price', +v || 0);
    // 不回写 name / price / lossRateText：这三个正是用户正在敲的输入源
    this.patchDerived(gid);
  },

  // 展开/收起定价明细。点提示条即视为「我要看这个价怎么来的」，
  // 若卡片处于折叠态先展开，否则点开明细却看不到内容会很困惑。
  onTogglePricing(e) {
    const gid = this.resolveGid(e);
    if (!gid) return;
    const goods = this.data.goods.map(x => {
      if (String(x.id) !== String(gid)) return x;
      const open = !x.pricingOpen;
      return { ...x, pricingOpen: open, collapsed: open ? false : x.collapsed };
    });
    this.setData({ goods });
  },

  // 商品级定价参数：包装耗材（元/件）与制作工时（小时/件）。
  // 只局部更新这张卡的 pricing 与两个输入值，保持输入光标不跳。
  onPricingInput(e) {
    const gid = this.resolveGid(e), k = e.currentTarget.dataset.k;
    if (!gid) return;
    if (k !== 'packCost' && k !== 'laborHours') return;
    const v = Math.max(0, +e.detail.value || 0);
    store.updateGood(gid, k, v);
    // 不回写 packCost / laborHours（正在输入的是它们），只刷定价结果
    this.patchDerived(gid);
  },

  onRecipeInput(e) {
    const gid = this.resolveGid(e), i = +e.currentTarget.dataset.i;
    if (!gid) return;
    store.updateRecipe(gid, i, 'g', +e.detail.value || 0);
    // 只回派生字段：材料成本变了，提示条/明细要立刻跟着变，但绝不能重发 recipe 行，
    // 否则渲染层拿旧用量回填输入框，用户会觉得「这个框点得进去却打不了字」。
    this.patchDerived(gid);
  },

  onRecipeChange(e) {
    const gid = this.resolveGid(e), i = +e.currentTarget.dataset.i;
    if (!gid) return;
    const idx = +e.detail.value;
    const g = this.data.goods.find(x => x.id === gid);
    const opt = g && g.matOptions ? g.matOptions[idx] : null;
    if (!opt) { this.refresh(); return; } // 原料库变动导致选项越界时自愈，不静默崩掉
    store.updateRecipe(gid, i, 'm', opt.value); // 内部自动同步单位
    this.syncGood(gid);
  },

  onRecipeUnitChange(e) {
    const gid = this.resolveGid(e), i = +e.currentTarget.dataset.i;
    if (!gid) return;
    const idx = +e.detail.value;
    const g = this.data.goods.find(x => x.id === gid);
    const row = g && g.recipe ? g.recipe[i] : null;
    const opt = row && row.unitOpts ? row.unitOpts[idx] : null;
    if (!opt) return;
    store.updateRecipe(gid, i, 'unit', opt.value);
    this.syncGood(gid);
  },

  onAddRecipe(e) {
    const gid = this.resolveGid(e);
    if (!gid) {
      this.refresh();
      wx.showToast({ title: '卡片已刷新，请再点一次', icon: 'none', duration: 1500 });
      return;
    }
    const r = store.addRecipe(gid);
    if (r === 'NO_MATERIAL') {
      // 原料库为空：不写入无效行，直接引导去原料页。否则会加出一行「选不到原料」的空壳，
      // 用户看到的就是「加了但没用」。
      const n = store.getState().materials.length;
      wx.showModal({
        title: '原料库是空的',
        content: '当前原料共 ' + n + ' 条，配方只能从这里选。先去原料页添加原料，再回来配配方。',
        confirmText: '去原料页', cancelText: '稍后',
        success: (res) => { if (res.confirm) wx.switchTab({ url: '/pages/material/material' }); }
      });
      return;
    }
    if (r === 'NO_GOOD') {
      this.refresh();
      wx.showToast({ title: '未找到该商品，请重试', icon: 'none', duration: 1500 });
      return;
    }
    // 成功：刷新并强制展开该卡——折叠卡里新加的配方行看不见，会被误判为「加不上」
    const rowIdx = (store.getState().goods.find(x => String(x.id) === String(gid)) || { recipe: [] }).recipe.length - 1;
    this.refresh();
    this.setData({ goods: this.data.goods.map(x => x.id === gid ? { ...x, collapsed: false } : x) });
    this.scrollToRecipe(gid, rowIdx);
    wx.showToast({ title: '已加一行，点下拉选原料', icon: 'none', duration: 1600 });
  },
  // 滚动到新加的配方行，避免行在屏幕外被误判为「没加上」
  scrollToRecipe(gid, idx) {
    if (idx < 0) return;
    setTimeout(() => {
      wx.pageScrollTo({ selector: '#rc-' + gid + '-' + idx, duration: 200, fail: () => {} });
    }, 80);
  },
  onDelRecipe(e) {
    const gid = this.resolveGid(e, false); // 破坏性操作：不做「唯一展开卡」兜底，避免删错卡
    if (!gid) return;
    store.deleteRecipe(gid, +e.currentTarget.dataset.i); this.refresh();
  },
  onDelGood(e) {
    // 关键：id 必须在同步阶段解析。wx.showModal 的 success 是异步回调，
    // 那时事件对象可能已被框架回收；先解析好再进回调。
    // 删除是破坏性操作，禁用「唯一展开卡」兜底：宁可少删一次，也不删错别人的商品。
    const gid = this.resolveGid(e, false);
    if (!gid) {
      // 兜底自愈：强制刷新一次让视图层重新绑定 dataset，用户再点一次即可删除
      this.refresh();
      wx.showToast({ title: '卡片已刷新，请再点一次删除', icon: 'none', duration: 1800 });
      return;
    }
    // 二次校验：只删当前页面上真实存在的那张卡，避免删到已不存在的 id
    if (!this.data.goods.some(x => String(x.id) === gid)) {
      this.refresh();
      wx.showToast({ title: '卡片已刷新，请再点一次删除', icon: 'none', duration: 1800 });
      return;
    }
    wx.showModal({
      title: '删除商品', content: '删除该商品会同时清除它在所有日期的销量记录，确定吗？',
      success: (res) => {
        if (!res.confirm) return;
        const n = store.deleteGood(gid); // 精确删 1 条；返回 0 表示未找到
        this.refresh();
        wx.showToast({
          title: n > 0 ? '已删除 1 个商品' : '未找到该商品',
          icon: n > 0 ? 'success' : 'none', duration: 1200
        });
      }
    });
  },
  // 跳到只读的配方手册。手册是 navigateTo 的非 tab 页，返回即回到商品页原位（可加即可看）。
  onOpenRecipeBook() {
    wx.navigateTo({
      url: '/pages/recipe/recipe',
      fail: () => wx.showToast({ title: '打开失败，请重试', icon: 'none' })
    });
  },

  onAddGood() {
    // 搜索态下新增的商品名默认为空，会被搜索过滤掉导致「点了没反应」→ 先清搜索
    if (this.data.keyword) this.setData({ keyword: '' });
    const before = this.data.goods.map(x => x.id);
    const gid = store.addGood();
    if (!gid) { wx.showToast({ title: '添加失败，请重试', icon: 'none', duration: 1500 }); return; }
    const isNew = before.indexOf(gid) === -1; // false = 复用了已有空商品
    this.refresh();
    // 目标卡展开、其余收起，并滚动到位：避免「点了没反应」被反复连点
    this.setData({ goods: this.data.goods.map(x => ({ ...x, collapsed: x.id !== gid })) });
    this.scrollToGood(gid);
    if (!isNew) wx.showToast({ title: '先填完这个空商品', icon: 'none', duration: 1500 });
  }
});
