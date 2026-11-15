// pages/recipe/recipe.js
// 配方手册：只读查看，不提供编辑。所有编辑入口仍集中在「商品」页，
// 这里只做「算清楚 + 看得懂」，避免同一份配方有两个可写入口导致状态分叉。
const store = require('../../utils/store.js');
const book = require('../../utils/recipe-book.js');

Page({
  data: {
    view: 'good',      // good = 按商品 / mat = 按原料
    byGood: [],
    byMat: [],
    summary: '',
    hasGoods: false,
    hasMats: false
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const st = store.getState();
    const byGood = book.byGood(st);
    const byMat = book.byMaterial(st);
    this.setData({
      byGood,
      byMat,
      hasGoods: byGood.length > 0,
      hasMats: byMat.length > 0,
      summary: buildSummary(byGood, byMat)
    });
  },

  onSwitch(e) {
    const v = (e && e.currentTarget && e.currentTarget.dataset.v) || 'good';
    if (v === this.data.view) return;
    this.setData({ view: v });
  },

  // 从手册直接跳回去改配方：省得用户自己找是哪个商品
  onEditGood(e) {
    const gid = e && e.currentTarget && e.currentTarget.dataset.gid;
    if (!gid) return;
    store.setPendingFocus(String(gid));
    wx.switchTab({
      url: '/pages/goods/goods',
      fail: () => wx.showToast({ title: '跳转失败，请手动切到「商品」页', icon: 'none' })
    });
  },

  onGoMaterial() {
    wx.switchTab({ url: '/pages/material/material' });
  },
  onGoGoods() {
    wx.switchTab({ url: '/pages/goods/goods' });
  }
});

// 顶部一句话汇总：只陈述事实，不编造结论
function buildSummary(byGood, byMat) {
  if (byGood.length === 0) return '还没有商品，先去「商品」页添加';
  const withRecipe = byGood.filter(g => g.hasRecipe);
  const usedMats = byMat.filter(m => m.useCount > 0);
  if (withRecipe.length === 0) return byMat.length === 0
    ? '还没有原料，配方只能从原料库选'
    : byMat.length + ' 样原料待分配 · 还没有商品配了配方';
  let top = withRecipe[0];
  withRecipe.forEach(g => { if (g.matBase > top.matBase) top = g; });
  return withRecipe.length + '/' + byGood.length + ' 个商品已配配方 · ' +
    usedMats.length + '/' + byMat.length + ' 样原料在用 · 材料成本最高：' + top.name + ' ¥' + top.matBaseText;
}
