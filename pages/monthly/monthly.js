// pages/monthly/monthly.js
const store = require('../../utils/store.js');
const exportUtil = require('../../utils/export.js');
const backup = require('../../utils/backup.js');
const KIT = require('../../utils/canvas-kit.js');
const TOPN = 8;

Page({
  data: {
    curMonth: '', calMonthLabel: '',
    covLabel: '', covColor: '', covBg: '',
    monthLbl: '', net: '', badge: '', netColor: '',
    netRateText: '', costVal: '', grossVal: '', grossColor: '',
    ringColor: '', profitDeg: 0,
    rev: '', gross: '', fixedK: '', fixed: '', rNet: '', rNetClass: '',
    avgM: 0, avgMDeg: 0, gaugeColor: '', gaugeText: '',
    lowWarn: [], warnListShow: false,
    fixedList: [], pricingSettings: {},
    rankPeriod: 'month', rankDim: 'profit', rankExpanded: false,
    rankPeriodLbl: '', rankPeriodColor: '', rankList: [], rankShowAll: false, rankCount: 0, rankMore: false,
    // 数据备份：数据只在本机，换机/清缓存会丢，所以必须能导出与导回
    backupText: '', backupSnapExists: false, backupSnapAt: '',
    canvasH: 1500
  },

  onShow() { this.refresh(); },

  monthLabel(m) { const [y, mo] = m.split('-').map(Number); return y + '年' + mo + '月'; },

  refresh() {
    const st = store.getState();
    const curMonth = st.curMonth;
    const [y, mo] = curMonth.split('-').map(Number);

    const m = store.monthAgg(curMonth);
    const covFull = m.recordedDays >= m.daysInMonth;
    // 日历格子删掉后，「哪几天漏记」并入覆盖率提示。
    // 当月只算到今天、历史月算整月、未来月不算——避免把未来全列成漏记。
    const t = st.today, cur = t.slice(0, 7);
    const upto = curMonth > cur ? 0 : (curMonth === cur ? +t.slice(8) : m.daysInMonth);
    const missing = [];
    for (let d = 1; d <= upto; d++) {
      const ds = curMonth + '-' + (d < 10 ? '0' + d : d);
      const r = st.daily[ds] || {};
      if (!Object.values(r).some(v => (+v || 0) > 0)) missing.push(ds.slice(5));
    }
    const missText = missing.length
      ? (' · 漏记 ' + missing.length + ' 天（' + missing.slice(0, 3).join('、') + (missing.length > 3 ? '…' : '') + '）')
      : '';
    const covLabel = covFull
      ? ('已记录 ' + m.recordedDays + ' / ' + m.daysInMonth + ' 天（完整）')
      : ('⚠ 已记录 ' + m.recordedDays + ' / ' + m.daysInMonth + ' 天' + missText);
    const covColor = covFull ? '#8BAE6B' : '#CF6A4F';
    const covBg = covFull ? 'rgba(139,174,107,.16)' : 'rgba(207,106,79,.16)';
    const netColor = m.net >= 0 ? '#8BAE6B' : '#CF6A4F';
    const ringColor = m.net >= 0 ? '#8BAE6B' : '#CF6A4F';
    const grossColor = m.grossRate < 0.3 ? '#CF6A4F' : '#4A3B2E';

    const avgM = st.goods.length ? st.goods.reduce((s, g) => s + g.margin, 0) / st.goods.length * 100 : 0;
    const gaugeColor = avgM < 30 ? '#CF6A4F' : '#8BAE6B';
    const lowWarn = st.goods.filter(g => g.margin < 0.3).map(g => ({ gid: g.id, name: g.name, margin: (g.margin * 100).toFixed(1) }));
    const fixedList = st.fixedCosts.map((f, i) => {
      // 正在输入的这一行保留 data 里的原样值：金额可能是「1500.」，存进去会变 1500，
      // 若把它 setData 回去，小数点就被吞掉（永远输不进小数）。
      // 值一致时微信的 diff 判定为无变化，不会下发，光标也就不跳。
      const prev = (this.data.fixedList || [])[i];
      const editing = this._editingFixed === i && prev;
      return { idx: i, name: editing ? prev.name : f.name, amount: editing ? prev.amount : f.amount };
    });
    // 定价参数：*Pct 字段供输入框直接显示百分数（40 而不是 0.4）
    const pricingSettings = {
      hourlyRate: st.settings.hourlyRate,
      monthlyCapacity: st.settings.monthlyCapacity,
      targetMarginPct: st.settings.targetMarginPct,
      channelFeePct: st.settings.channelFeePct,
      fixedTotal: st.fixedCosts.reduce((a, f) => a + (+f.amount || 0), 0)
    };

    const rank = this.buildRank(st, curMonth, y, mo, m);
    const snap = store.getSnapshotInfo();

    this.setData({
      curMonth, calMonthLabel: this.monthLabel(curMonth),
      covLabel, covColor, covBg,
      monthLbl: y + '年' + mo + '月 净利润', net: store.fmt(m.net),
      badge: m.net >= 0 ? '盈利 ✅' : '亏损 🔴', netColor,
      netRateText: (m.netRate * 100).toFixed(1) + '%',
      costVal: store.fmt(m.matCost + m.fixed), grossVal: (m.grossRate * 100).toFixed(1) + '%', grossColor,
      ringColor, profitDeg: Math.max(0, m.netRate) * 360,
      rev: store.fmt(m.rev), gross: store.fmt(m.gross),
      fixedK: covFull ? '固定成本' : ('固定成本(按' + m.recordedDays + '天)'),
      fixed: store.fmt(m.fixed), rNet: store.fmt(m.net), rNetClass: m.net >= 0 ? 'profit' : 'loss',
      avgM, avgMDeg: Math.max(0, avgM) * 3.6, gaugeColor, gaugeText: avgM.toFixed(0) + '%',
      lowWarn, fixedList, pricingSettings,
      backupText: st.materials.length + ' 个原料 · ' + st.goods.length + ' 个商品 · '
        + st.fixedCosts.length + ' 项固定支出 · ' + Object.keys(st.daily).length + ' 天销量',
      backupSnapExists: !!snap.exists,
      backupSnapAt: snap.exists ? this.snapLabel(snap.at) : '',
      rankPeriodLbl: rank.periodLbl, rankPeriodColor: rank.periodColor,
      rankList: rank.list, rankShowAll: rank.showAll, rankCount: rank.count, rankMore: rank.more
    });
  },

  // ISO → 「11-15 18:20」，快照时间要能被用户直接读懂
  snapLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = n => (n < 10 ? '0' + n : '' + n);
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  buildRank(st, curMonth, y, mo, m) {
    const useYear = this.data.rankPeriod === 'year';
    const src = useYear ? store.yearAgg(String(y)) : store.monthAgg(curMonth);
    let periodLbl, periodColor;
    if (useYear) {
      periodLbl = y + '年（已记录 ' + src.recordedDays + '/' + src.daysInYear + ' 天）';
      periodColor = src.recordedDays < src.daysInYear ? '#CF6A4F' : '#8BAE6B';
    } else {
      periodLbl = y + '年' + mo + '月（已记录 ' + src.recordedDays + '/' + src.daysInMonth + ' 天）';
      periodColor = src.recordedDays >= src.daysInMonth ? '#8BAE6B' : '#CF6A4F';
    }
    const dim = this.data.rankDim;
    const arr = st.goods.map(g => {
      const q = src.perGood[g.id] || 0;
      return { name: g.name, qty: q, profit: g.profit * q, margin: g.margin * 100 };
    });
    if (dim === 'qty') arr.sort((a, b) => b.qty - a.qty);
    else if (dim === 'margin') arr.sort((a, b) => b.margin - a.margin);
    else arr.sort((a, b) => b.profit - a.profit);

    const showAll = this.data.rankExpanded || arr.length <= TOPN;
    const ranked = showAll ? arr : arr.slice(0, TOPN);
    const max = ranked.length ? (dim === 'margin' ? Math.max(...ranked.map(r => r.margin), 1) : Math.max(...ranked.map(r => r[dim]), 1)) : 1;
    const list = ranked.map(r => {
      let val, color = '#DE8A4E';
      if (dim === 'qty') val = r.qty + ' 个';
      else if (dim === 'margin') { val = r.margin.toFixed(1) + '%'; color = r.margin < 30 ? '#CF6A4F' : '#8BAE6B'; }
      else val = store.fmt(r.profit);
      const w = (dim === 'margin' ? r.margin : r[dim]) / max * 100;
      return { name: r.name, val, width: w.toFixed(0), color };
    });
    const more = !showAll && arr.length > TOPN;
    return { periodLbl, periodColor, list, showAll, count: arr.length, more };
  },

  // ===== 月份导航 =====
  prevMonth() { store.setCurMonth(store.shiftMonth(this.data.curMonth, -1)); this.refresh(); },
  nextMonth() { store.setCurMonth(store.shiftMonth(this.data.curMonth, 1)); this.refresh(); },
  backToday() { store.setCurMonth(store.getState().today.slice(0, 7)); this.refresh(); },

  // ===== 毛利率预警下钻 =====
  toggleWarn() { this.setData({ warnListShow: !this.data.warnListShow }); },
  onTapWarn(e) {
    const gid = e.currentTarget.dataset.gid;
    store.setPendingFocus(gid);
    wx.switchTab({ url: '/pages/goods/goods' });
  },

  // ===== 固定支出 =====
  onFixedInput(e) {
    const i = +e.currentTarget.dataset.i, k = e.currentTarget.dataset.k;
    const v = e.detail.value;
    store.updateFixed(i, k, k === 'name' ? v : (+v || 0));
    // 把用户原样输入静默写进 data（不单独 setData），refresh 时这一行取现值
    this._editingFixed = i;
    if (this.data.fixedList[i]) this.data.fixedList[i][k] = v;
    this.refresh();
  },
  onFixedBlur() { this._editingFixed = -1; },
  onFixedDel(e) { store.deleteFixed(+e.currentTarget.dataset.i); this.refresh(); },
  onFixedAdd() { store.addFixed(); this.refresh(); },

  // 定价参数输入：百分数字段按 /100 存成小数。
  // 注意这里「不」调用 refresh：逐字符输入时 refresh 会用已存值回写输入框，
  // 把用户正在输入的「0.6」吞成「0」「6」，参数被悄悄改错。
  // 本页不展示定价结果，改完切回商品页时那边 onShow 会重新计算，无需实时刷新。
  onSettingInput(e) {
    const k = e.currentTarget.dataset.k;
    const v = +e.detail.value || 0;
    if (k === 'targetMargin') store.updateSetting('targetMargin', v / 100);
    else if (k === 'channelFee') store.updateSetting('channelFee', v / 100);
    else if (k === 'hourlyRate' || k === 'monthlyCapacity') store.updateSetting(k, v);
  },

  // ===== 排行 =====
  onRankPeriod(e) { this.setData({ rankPeriod: e.currentTarget.dataset.period, rankExpanded: false }); this.refresh(); },
  onRankDim(e) { this.setData({ rankDim: e.currentTarget.dataset.dim, rankExpanded: false }); this.refresh(); },
  onRankMore() { this.setData({ rankExpanded: true }); this.refresh(); },

  // ===== 数据备份 / 恢复 =====
  // 原则：导出要「能落地到用户自己手里」（发聊天 / 剪贴板），导入要「先预览、选模式、可撤销」。
  // 全程不联网：备份文件不上传任何服务器。
  emptyGuard() {
    const s = store.dataStats();
    if (s.materials === 0 && s.goods === 0) {
      wx.showToast({ title: '还没有可备份的数据', icon: 'none' });
      return true;
    }
    return false;
  },

  // 导出为文件 → 直接调起「发送给朋友/文件传输助手」
  onBackupExportFile() {
    if (this.emptyGuard()) return;
    const json = store.exportJSON();
    backup.writeTemp(json).then(r => {
      return backup.shareFile(r.filePath, r.fileName).then(() => {
        wx.showToast({ title: '已发送，留存在聊天里即可', icon: 'none', duration: 2000 });
      });
    }).catch(err => {
      // 两种失败分开处理：写文件失败要报错；发送不可用则退回剪贴板，别让用户白点
      const msg = (err && err.message) || '';
      if (msg.indexOf('写入') >= 0) {
        wx.showModal({ title: '导出失败', content: msg, showCancel: false });
        return;
      }
      backup.copyText(json).then(() => {
        wx.showModal({
          title: '已复制备份文本',
          content: '当前环境不支持直接发送文件，备份内容（' + backup.sizeText(json.length) + '）已复制到剪贴板。可粘贴到备忘录或「文件传输助手」里保存。',
          showCancel: false
        });
      }).catch(() => wx.showModal({ title: '导出失败', content: '发送文件与复制都不可用，请稍后重试', showCancel: false }));
    });
  },

  // 导出为文本（兜底通道，也是手动小改数据的入口）
  onBackupExportText() {
    if (this.emptyGuard()) return;
    const json = store.exportJSON();
    backup.copyText(json).then(() => {
      wx.showModal({
        title: '已复制备份文本',
        content: '共 ' + backup.sizeText(json.length) + '，请注意：\n· 微信聊天里直接粘贴长文本可能被折叠或截断；\n· 建议粘贴到「文件传输助手」的输入框后发送，或存进备忘录。',
        showCancel: false
      });
    }).catch(() => wx.showToast({ title: '复制失败', icon: 'none' }));
  },

  onBackupImportFile() {
    backup.pickFileText()
      .then(r => this.startImport(r.text, r.name))
      .catch(err => {
        const m = (err && err.message) || '';
        if (m.indexOf('取消') >= 0) return;   // 用户取消，不打扰
        wx.showModal({ title: '读取失败', content: m, showCancel: false });
      });
  },

  onBackupImportText() {
    backup.readClipboard()
      .then(text => this.startImport(text, '剪贴板内容'))
      .catch(err => wx.showModal({ title: '读取失败', content: (err && err.message) || '剪贴板为空', showCancel: false }));
  },

  // 先校验 + 报数，再让用户选覆盖还是合并
  startImport(text, sourceName) {
    const v = store.validateImport(text);
    if (!v.ok) {
      wx.showModal({ title: '无法导入', content: v.error, showCancel: false });
      return;
    }
    const c = v.counts;
    const cur = store.dataStats();
    const when = v.exportedAt ? ('备份时间：' + this.snapLabel(v.exportedAt) + '\n') : '';
    wx.showActionSheet({
      alertText: when + (sourceName || '备份') + ' 含 ' + c.materials + ' 原料 / ' + c.goods + ' 商品 / '
        + c.fixedCosts + ' 项固定支出 / ' + c.dailyDays + ' 天销量\n现有：' + cur.materials + ' 原料 / '
        + cur.goods + ' 商品。请选择导入方式：',
      itemList: ['覆盖导入（用备份替换现有全部数据）', '合并导入（保留现有，只补备份独有的）'],
      success: (r) => {
        if (r.tapIndex === 0) this.confirmReplace(v.bundle, cur);
        else this.doImport(v.bundle, 'merge');
      },
      fail: () => {}
    });
  },

  confirmReplace(bundle, cur) {
    wx.showModal({
      title: '确认覆盖现有数据？',
      content: '现有 ' + cur.materials + ' 个原料、' + cur.goods + ' 个商品、' + cur.fixedCosts + ' 项固定支出、'
        + cur.dailyDays + ' 天销量将被备份替换。\n\n导入前会自动存一份快照，导入后可点「撤销上次导入」找回。',
      confirmText: '覆盖导入',
      confirmColor: '#CF6A4F',
      success: (m) => { if (m.confirm) this.doImport(bundle, 'replace'); }
    });
  },

  doImport(bundle, mode) {
    const r = store.importBundle(bundle, mode);
    if (!r.ok) {
      wx.showModal({ title: '导入失败', content: r.error || '未知错误', showCancel: false });
      return;
    }
    const s = r.stats;
    const added = s.addedM + ' 原料 · ' + s.addedG + ' 商品 · ' + s.addedF + ' 项固定支出 · ' + s.addedDay + ' 天销量';
    const skipped = s.skippedM + s.skippedG + s.skippedF + s.skippedDay;
    const body = (s.mode === 'replace' ? '已用备份覆盖，共 ' : '已合并，新增 ') + added + '。'
      + (s.mode === 'merge' && skipped > 0 ? '\n\n' + skipped + ' 项因已存在（同 id / 同名称金额 / 同日期销量）而跳过，现有数据未被改动。' : '')
      + '\n\n如需退回导入前的数据，点下方「撤销上次导入」。';
    this.refresh();
    wx.showModal({ title: '导入完成', content: body, showCancel: false });
  },

  onBackupUndo() {
    const info = store.getSnapshotInfo();
    if (!info.exists) return;
    const c = info.counts || {};
    wx.showModal({
      title: '撤销上次导入？',
      content: '将把数据恢复到 ' + this.snapLabel(info.at) + ' 的状态（'
        + (c.materials || 0) + ' 原料 / ' + (c.goods || 0) + ' 商品）。当前数据会再存一份快照，撤销本身也可反悔。',
      confirmText: '撤销导入',
      success: (m) => {
        if (!m.confirm) return;
        const r = store.restoreSnapshot();
        if (!r.ok) { wx.showModal({ title: '撤销失败', content: r.error || '', showCancel: false }); return; }
        this.refresh();
        wx.showToast({ title: '已恢复到导入前', icon: 'none' });
      }
    });
  },

  // ===== 导出长图 + 分享 =====
  // 长图不是「把页面上的数字搬过去」：页面用于操作，长图用于让看的人三秒抓住结论。
  // 所以文字罗列一律换成图表（瀑布图看钱去哪了、逐日柱看哪天在赚、进度条看回本没有）。
  // 高度由 buildReport 统一算出（两遍法第一遍），绘制严格按同一份 blocks 走，
  // 避免「加一个区块就末块被截 / 底部大片留白」——原先是估高度的，加内容必然错位。
  onExport() {
    const plan = this.buildReport();
    this.setData({ canvasH: plan.H }, () => {
      const q = wx.createSelectorQuery();
      q.select('#exportCanvas').fields({ node: true, size: true }).exec(res => {
        if (!res || !res[0] || !res[0].node) { wx.showToast({ title: '导出组件未就绪', icon: 'none' }); return; }
        const canvas = res[0].node;
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2;
        const W = 750, H = plan.H;
        const p = exportUtil.getPalette(exportUtil.isSystemDark());
        exportUtil.renderToImage(canvas, dpr, W, H, ctx => this.drawReport(ctx, W, H, p, plan))
          .then(path => exportUtil.shareImage(path))
          .catch(() => wx.showToast({ title: '生成长图失败', icon: 'none' }));
      });
    });
  },

  // 第一遍：算出所有绘制数据与精确总高。blocks 里每项的 fn 自带绘制逻辑，
  // 与 h 绑在一起，加区块只需 push 一项，总高与绘制不可能不同步。
  // 注意：数据一律从 store.getState() 取，不接收外部传入的 state——
  // store.monthAgg 读的是模块内单例，若外面再传一份 state 进来就会变成两套数据源，
  // 页面里恰好一致看不出问题，但一改就错位。
  buildReport() {
    const st = store.getState();
    const curMonth = st.curMonth;
    const [y, mo] = curMonth.split('-').map(Number);
    const m = store.monthAgg(curMonth);
    const prev = store.monthAgg(store.shiftMonth(curMonth, -1));

    const covFull = m.recordedDays >= m.daysInMonth;
    const covShort = '已记录 ' + m.recordedDays + '/' + m.daysInMonth + ' 天';

    // 盈亏平衡：整月固定支出 ÷ 当月单均毛利 = 整月至少要做多少单。
    // 用「整月固定支出总额 fixedTotal」而不是「按已记录天数折算的 fixed」：
    // 后者分母随记录天数变化，目标单量会天天飘，用户没法拿它当经营目标。
    let doneQty = 0;
    st.goods.forEach(g => { doneQty += (m.perGood[g.id] || 0); });
    const unitProfit = doneQty > 0 ? m.gross / doneQty : 0;
    const needQty = unitProfit > 0 ? Math.ceil(m.fixedTotal / unitProfit) : 0;
    const reached = needQty > 0 && doneQty >= needQty;
    let beText;
    if (needQty <= 0) beText = '单均毛利为负，先把售价调到保本价以上';
    else if (reached) beText = '已回本 · 超出 ' + (doneQty - needQty) + ' 单';
    else beText = '整月需 ' + needQty + ' 单回本，还差 ' + (needQty - doneQty) + ' 单';

    // 环比：上月没有记录时不硬算，直接说明暂无可比，避免给出负数百分比误导
    let momNote;
    if (prev.rev > 0) {
      const d = (m.rev - prev.rev) / prev.rev * 100;
      momNote = '营收环比上月 ' + (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
    } else {
      momNote = '上月无销量记录，暂无可比';
    }

    // 逐日毛利柱：未记录的日子留底部灰条，漏记的日子一眼能看出来
    const days = [];
    for (let d = 1; d <= m.daysInMonth; d++) {
      const date = curMonth + '-' + (d < 10 ? '0' + d : d);
      const rec = st.daily[date] || {};
      let pm = 0, has = false;
      st.goods.forEach(g => {
        const q = rec[g.id] || 0;
        if (q) { has = true; pm += g.profit * q; }
      });
      days.push({ day: d, value: pm, recorded: has });
    }

    // 瀑布四步：营收 → 减材料 → 减固定 → 净利
    const wfSteps = [
      { label: '营收', value: m.rev, type: 'total', color: '#DE8A4E', valueText: store.fmt(m.rev) },
      { label: '材料', value: m.matCost, type: 'minus', color: '#CF6A4F', valueText: '-' + store.fmt(m.matCost), valueColor: '#CF6A4F' },
      { label: '固定', value: m.fixed, type: 'minus', color: '#E0997F', valueText: '-' + store.fmt(m.fixed), valueColor: '#CF6A4F' },
      { label: '净利', value: Math.abs(m.net), type: 'total', color: m.net >= 0 ? '#8BAE6B' : '#CF6A4F', valueText: store.fmt(m.net), valueColor: m.net >= 0 ? '#8BAE6B' : '#CF6A4F' }
    ];

    // 商品排行：按赚钱额取前 6，毛利率低于 30% 标红（卖得动但不赚钱的品一眼可见）
    const ALL = st.goods.map(g => {
      const q = m.perGood[g.id] || 0;
      return { name: g.name, qty: q, profit: g.profit * q, margin: g.margin };
    }).filter(r => r.qty > 0).sort((a, b) => b.profit - a.profit);
    const TOP = 6;
    const top = ALL.slice(0, TOP);
    const maxP = Math.max.apply(null, top.map(r => Math.abs(r.profit)).concat([1]));
    const rankItems = top.map(r => ({
      name: r.name,
      valueText: store.fmt(r.profit),
      ratio: Math.abs(r.profit) / maxP,
      color: r.margin < 0.3 ? '#CF6A4F' : '#DE8A4E',
      warn: r.margin < 0.3
    }));

    // 低毛利预警：原来只写「N 个」，看不出是谁，等于没给信息
    const lowWarn = st.goods.filter(g => g.margin < 0.3).sort((a, b) => a.margin - b.margin);
    const lowRows = lowWarn.slice(0, 4).map(g => [g.name, (g.margin * 100).toFixed(0) + '%']);

    const fixedRows = st.fixedCosts.length
      ? st.fixedCosts.map(f => [f.name, store.fmt(f.amount)])
      : [['（未设置固定支出）', '—']];

    const TOP_Y = 330;   // 深棕区（标题条 + hero）总高
    const GAP = 26;
    const PAD = 40;
    const CW = 750 - PAD * 2;
    const blocks = [];
    const add = (h, fn) => blocks.push({ h, fn });

    // 核心指标
    add(132, (ctx, x, yy, w, p) => {
      KIT.sectionHead(ctx, p, x, yy, w, '核心指标', momNote);
      KIT.metricRow(ctx, p, x, yy + 32, w, [
        { label: '营收', value: store.fmt(m.rev) },
        { label: '毛利', value: store.fmt(m.gross), color: m.gross >= 0 ? p.text : p.brick },
        { label: '毛利率', value: (m.grossRate * 100).toFixed(1) + '%', color: m.grossRate < 0.3 ? p.brick : p.text }
      ]);
    });

    // 收支瀑布
    add(232, (ctx, x, yy, w, p) => {
      KIT.sectionHead(ctx, p, x, yy, w, '收支去向', '营收 − 材料 − 固定 = 净利');
      KIT.waterfall(ctx, p, x + 16, yy + 48, w - 32, 140, wfSteps);
    });

    // 逐日毛利
    add(216, (ctx, x, yy, w, p) => {
      KIT.sectionHead(ctx, p, x, yy, w, '逐日毛利', '底部灰条＝当天没记销量');
      KIT.dayBars(ctx, p, x, yy + 46, w, 130, days);
      ctx.textBaseline = 'middle';
      ctx.font = '18px sans-serif';
      ctx.fillStyle = p.sub;
      ctx.textAlign = 'left';
      ctx.fillText('1 日', x, yy + 192);
      ctx.textAlign = 'center';
      ctx.fillText('15 日', x + w / 2, yy + 192);
      ctx.textAlign = 'right';
      ctx.fillText(m.daysInMonth + ' 日', x + w, yy + 192);
    });

    // 商品排行
    add(32 + Math.max(1, rankItems.length) * 40 + (ALL.length > TOP ? 26 : 0), (ctx, x, yy, w, p) => {
      KIT.sectionHead(ctx, p, x, yy, w, '赚钱排行', '前 ' + Math.min(TOP, ALL.length) + ' 名 / 共 ' + ALL.length + ' 个');
      if (!rankItems.length) {
        KIT.fillRound(ctx, x, yy + 32, w, 60, 14, p.card);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.font = '22px sans-serif';
        ctx.fillStyle = p.sub;
        ctx.fillText('本月还没有销量记录', x + w / 2, yy + 62);
        return;
      }
      const endY = KIT.rankBars(ctx, p, x, yy + 32, w, rankItems);
      if (ALL.length > TOP) {
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.font = '18px sans-serif';
        ctx.fillStyle = p.accent;
        ctx.fillText('另有 ' + (ALL.length - TOP) + ' 个商品未显示', x + w / 2, endY + 14);
      }
    });

    // 低毛利预警（没有就不占位，不画空卡）
    if (lowRows.length) {
      const more = lowWarn.length > lowRows.length ? lowWarn.length - lowRows.length : 0;
      add(32 + lowRows.length * 42 + 16 + (more ? 34 : 0), (ctx, x, yy, w, p) => {
        KIT.sectionHead(ctx, p, x, yy, w, '低毛利预警', '毛利率 < 30%');
        const endY = KIT.kvRows(ctx, p, x, yy + 32, w, lowRows.map(r => [r[0], r[1], p.text, p.brick]));
        if (more) {
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'center';
          ctx.font = '18px sans-serif';
          ctx.fillStyle = p.brick;
          ctx.fillText('另有 ' + more + ' 个商品同样低于 30%', x + w / 2, endY + 20);
        }
      });
    }

    // 固定支出
    add(32 + fixedRows.length * 42 + 16, (ctx, x, yy, w, p) => {
      KIT.sectionHead(ctx, p, x, yy, w, '固定支出（按月）', '合计 ' + store.fmt(m.fixedTotal));
      KIT.kvRows(ctx, p, x, yy + 32, w, fixedRows);
    });

    let H = TOP_Y + 30;
    blocks.forEach(b => { H += b.h + GAP; });
    H = H - GAP + 76;

    return {
      H, top: TOP_Y + 30, blocks,
      monthLabel: this.monthLabel(curMonth),
      covShort, covFull,
      net: store.fmt(m.net), netColor: m.net >= 0 ? '#9EC27F' : '#E07A5F',
      beText, beRatio: needQty > 0 ? doneQty / needQty : 0, beColor: reached ? '#9EC27F' : '#F2B75E'
    };
  },

  // 第二遍：按 plan.blocks 顺序绘制，y 推进与 buildReport 的高度计算共用同一套常量
  drawReport(ctx, W, H, p, plan) {
    const PAD = 40;
    const CW = W - PAD * 2;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);
    this.drawHero(ctx, W, p, plan);

    let y = plan.top;
    plan.blocks.forEach(b => {
      b.fn(ctx, PAD, y, CW, p);
      y += b.h + 26;
    });

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = '18px sans-serif';
    ctx.fillStyle = p.sub;
    ctx.fillText('数据来自「烘焙成本」小程序 · 仅供经营参考', W / 2, H - 36);
  },

  // 深棕 hero 区：标题 + 月份 + 净利大数字 + 盈亏平衡进度（长图最该被看见的一屏）
  drawHero(ctx, W, p, plan) {
    const PAD = 40;
    const CW = W - PAD * 2;
    ctx.fillStyle = '#3A2F25';
    ctx.fillRect(0, 0, W, 330);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#F2B75E';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText('烘焙经营报表', PAD, 56);
    ctx.font = '24px sans-serif';
    ctx.fillText(plan.monthLabel, PAD, 100);

    ctx.textAlign = 'right';
    ctx.font = '20px sans-serif';
    ctx.fillStyle = plan.covFull ? '#9EC27F' : '#E07A5F';
    ctx.fillText(plan.covShort, W - PAD, 56);

    ctx.textAlign = 'left';
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#B7A994';
    ctx.fillText('本月净利', PAD, 168);

    ctx.font = 'bold 72px sans-serif';
    ctx.fillStyle = plan.netColor;
    ctx.fillText(plan.net, PAD, 224);

    KIT.progress(ctx, p, PAD, 272, CW, 10, plan.beRatio, plan.beColor, 'rgba(255,255,255,0.16)');

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#B7A994';
    ctx.fillText(plan.beText, PAD, 306);
  }
});
