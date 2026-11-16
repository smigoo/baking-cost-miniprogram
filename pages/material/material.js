// pages/material/material.js
const store = require('../../utils/store.js');

Page({
  data: { materials: [], keyword: '', searching: false },

  onShow() { this.refresh(); },

  // 名称模糊搜索：忽略大小写、忽略首尾空格。只匹配名称（原料没有更合适的检索维度）。
  // 注意用「全量数据」过滤，不能用当前渲染的 this.data.materials（那已是上次过滤结果，会越搜越少）。
  matchMaterials(kw) {
    const all = store.getState().materials || [];
    const q = String(kw || '').trim().toLowerCase();
    return q ? all.filter(m => String(m.name || '').toLowerCase().indexOf(q) >= 0) : all;
  },

  refresh() {
    this.setData({ materials: this.matchMaterials(this.data.keyword) });
  },

  // 搜索框输入：keyword 是独立的搜索态，不属于原料字段，整体 setData 列表不会打断
  // 原料名称/价格输入框的光标（那些走 patchDerived，红线见 check-input-binding）。
  onSearch(e) {
    const kw = e.detail.value || '';
    this.setData({ keyword: kw, materials: this.matchMaterials(kw) });
  },

  onClearSearch() {
    this.setData({ keyword: '', materials: this.matchMaterials('') });
  },

  onInput(e) {
    const id = e.currentTarget.dataset.id, k = e.currentTarget.dataset.k;
    let v = e.detail.value;
    if (k !== 'name') v = +v || 0;
    store.updateMaterial(id, k, v);
    this.patchDerived(id);
  },

  // 输入源（名称 / 进价 / 重量）只能静默写进 data，不能整体 setData 下发：
  // 数字会被规范化，用户敲「12.」时立刻被回写成「12」→ 小数点永远打不出来（单价经常是 12.5 这种）。
  // 需要实时刷新的是「重量换算 / 每克单价」这类派生文案，用路径式精确下发。
  patchDerived(id) {
    const i = this.data.materials.findIndex(x => String(x.id) === String(id));
    if (i < 0) return;
    const st = store.getState();
    const nm = st.materials.find(x => String(x.id) === String(id));
    if (!nm) return;
    const cur = this.data.materials[i];
    cur.name = nm.name;
    cur.price = nm.price;
    cur.amount = nm.amount;
    const base = 'materials[' + i + ']';
    this.setData({
      [base + '.grams']: nm.grams,
      [base + '.unitPrice']: nm.unitPrice,
      [base + '.unitPriceText']: nm.unitPriceText,
      [base + '.gramsText']: nm.gramsText,
      [base + '.unitNote']: nm.unitNote,
      [base + '.isCount']: nm.isCount,
      [base + '.classifier']: nm.classifier
    });
  },

  onUnitChange(e) {
    const id = e.currentTarget.dataset.id;
    const idx = +e.detail.value;
    const m = this.data.materials.find(x => x.id === id);
    if (!m) return;
    store.updateMaterial(id, 'unit', m.unitOpts[idx].value);
    this.refresh();
  },

  onDel(e) { store.deleteMaterial(e.currentTarget.dataset.id); this.refresh(); },

  onAdd() { store.addMaterial(); this.refresh(); }
});
