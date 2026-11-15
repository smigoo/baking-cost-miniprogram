// pages/daily/daily.js
const store = require('../../utils/store.js');

Page({
  data: {
    curDate: '', curMonth: '', calMonthLabel: '',
    calCells: [],
    dayLabel: '', day: {},
    dayList: [],
    pickerOpen: false, pickerOptions: [], pickerIndex: 0, pickerText: '', pickerHint: ''
  },

  onShow() { this.refresh(); },

  monthLabel(m) { const [y, mo] = m.split('-').map(Number); return y + '年' + mo + '月'; },

  refresh() {
    const st = store.getState();
    const cells = store.monthCells(st.curMonth).map((cell, i) => {
      if (cell === null) return { idx: i, date: '', day: '', empty: true, has: false, sel: false, isToday: false };
      const r = st.daily[cell] || {};
      const has = Object.values(r).some(v => (+v || 0) > 0);
      return {
        idx: i, date: cell, day: +cell.slice(8), empty: false, has,
        sel: cell === st.curDate, isToday: cell === st.today
      };
    });
    const dayObj = this.buildDay(st.curDate, st);
    const dayList = this.buildDayList(st.curDate, st);
    const picker = this.buildPicker(st);

    this.setData({
      curMonth: st.curMonth, curDate: st.curDate,
      calMonthLabel: this.monthLabel(st.curMonth),
      calCells: cells,
      dayLabel: store.fmtDate(st.curDate),
      day: dayObj, dayList,
      pickerOptions: picker.options, pickerHint: picker.hint
    });
    if (this.data.pickerOpen) this.syncPickerText();
  },

  buildDay(date, st) {
    const s = store.daySummary(date);
    const margin = s.margin;
    const ringColor = s.profit >= 0 ? 'var(--caramel)' : 'var(--brick)';
    return {
      rev: store.fmt(s.rev), cost: store.fmt(s.cost), profit: store.fmt(s.profit),
      marginText: (Math.max(0, margin) * 100).toFixed(1) + '%',
      marginDeg: Math.max(0, margin) * 360,
      ringColor
    };
  },

  buildDayList(date, st) {
    const map = st.daily[date] || {};
    const ids = Object.keys(map).filter(gid => st.goods.some(g => g.id === gid));
    return ids.map(gid => {
      const g = st.goods.find(x => x.id === gid);
      return { gid, name: g ? g.name : '', qty: map[gid] || 0 };
    });
  },

  buildPicker(st) {
    const map = st.daily[st.curDate] || {};
    const avail = st.goods.filter(g => !(g.id in map));
    const options = avail.map(g => ({ value: g.id, label: g.name }));
    const hint = avail.length ? ('还可添加 ' + avail.length + ' 个商品') : '商品库里的商品今天都添加过了';
    return { options, hint };
  },

  syncPickerText() {
    const opts = this.data.pickerOptions;
    let i = this.data.pickerIndex;
    if (i >= opts.length) i = 0;
    this.setData({ pickerIndex: i, pickerText: opts.length ? opts[i].label : '（无可添加商品）' });
  },

  onTapCell(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    store.setCurDate(date);
    const st = store.getState();
    this.refresh();
  },

  prevMonth() { store.setCurMonth(store.shiftMonth(this.data.curMonth, -1)); this.refresh(); },
  nextMonth() { store.setCurMonth(store.shiftMonth(this.data.curMonth, 1)); this.refresh(); },

  backToday() {
    store.setCurDate(store.getState().today);
    store.setCurMonth(store.getState().today.slice(0, 7));
    this.refresh();
  },

  togglePicker() {
    const open = !this.data.pickerOpen;
    this.setData({ pickerOpen: open });
    if (open) this.syncPickerText();
  },

  onPickerChange(e) {
    const i = +e.detail.value;
    const opt = this.data.pickerOptions[i];
    // 可选项为空（商品库商品今天都已录入，或商品被删光）时 picker 也可能触发 change，
    // 直接取 .label 会 TypeError 崩掉整个页面。这里必须容错。
    if (!opt) { this.syncPickerText(); return; }
    this.setData({ pickerIndex: i, pickerText: opt.label });
  },

  confirmAdd() {
    const opts = this.data.pickerOptions;
    if (!opts.length) {
      wx.showToast({ title: '暂无可添加的商品', icon: 'none', duration: 1500 });
      return;
    }
    let i = this.data.pickerIndex;
    if (i >= opts.length) i = 0;
    store.addDailyGood(this.data.curDate, opts[i].value);
    this.setData({ pickerOpen: false });
    this.refresh();
  },

  onQtyInput(e) {
    const gid = e.currentTarget.dataset.gid;
    const qty = +e.detail.value || 0;
    store.setDaily(this.data.curDate, gid, qty);
    // 只重算当日收支，不重建 dayList（避免输入光标跳动）
    const st = store.getState();
    this.setData({ day: this.buildDay(this.data.curDate, st) });
  },

  onQtyMinus(e) {
    const gid = e.currentTarget.dataset.gid;
    const cur = (this.data.dayList.find(x => x.gid === gid) || {}).qty || 0;
    store.setDaily(this.data.curDate, gid, Math.max(0, Math.floor(cur) - 1));
    this.afterQtyChange();
  },
  onQtyPlus(e) {
    const gid = e.currentTarget.dataset.gid;
    const cur = (this.data.dayList.find(x => x.gid === gid) || {}).qty || 0;
    store.setDaily(this.data.curDate, gid, Math.floor(cur) + 1);
    this.afterQtyChange();
  },
  afterQtyChange() {
    const st = store.getState();
    this.setData({ dayList: this.buildDayList(this.data.curDate, st), day: this.buildDay(this.data.curDate, st) });
  },

  onRemove(e) {
    const gid = e.currentTarget.dataset.gid;
    store.removeDailyGood(this.data.curDate, gid);
    this.refresh();
  }
});
