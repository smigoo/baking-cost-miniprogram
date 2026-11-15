// utils/canvas-kit.js —— 长图绘制原语（月报 / 日报共用）
//
// 为什么要单独抽一层：
// 一张长图少则 5 个区块、多则 9 个，靠「画完一块手动 y += 高度」拼下去，
// 高度一旦对不上就会出现「最后一块被截掉」或「底部一大片留白」。
// 这里统一成「每个函数接收左上角 (x, y) 与可用宽度 w，返回下一块的 y」，
// 页面只负责按顺序调用，新增区块不必回头改别处的坐标。
//
// 约定期：所有文字用 textBaseline = 'middle'（按单元格中心对齐，不做基线换算），
// 所有卡片用圆角（与小程序内 .card 的 24rpx 观感一致），文字一律走 clipText 防溢出。

// 圆角矩形路径。不用 ctx.roundRect：老基础库没有该方法，直接调用会整块不画。
function rrect(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function fillRound(ctx, x, y, w, h, r, color) {
  rrect(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

// 按像素宽度截断。中文是逐字测量，不能用字符数估——
// 750 宽画布下 22px 字一行约 30 个汉字，商品名超长会直接压到右侧数值上。
function clipText(ctx, text, maxW) {
  const s = String(text == null ? '' : text);
  if (maxW <= 0) return '';
  if (ctx.measureText(s).width <= maxW) return s;
  const dots = '…';
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + dots).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? s.slice(0, lo) + dots : dots;
}

// 区块标题：左标题 + 右注释（注释可为空）。返回内容区起始 y。
function sectionHead(ctx, p, x, y, w, text, note) {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = p.text;
  ctx.fillText(text, x, y + 12);
  if (note) {
    ctx.textAlign = 'right';
    ctx.font = '18px sans-serif';
    ctx.fillStyle = p.sub;
    ctx.fillText(clipText(ctx, note, w * 0.5), x + w, y + 13);
  }
  return y + 32;
}

// 键值行列表（卡片内多行「标签 —— 数值」）。rows: [标签, 数值, 标签色?, 数值色?]
function kvRows(ctx, p, x, y, w, rows, rowH) {
  const rh = rowH || 42;
  const h = rows.length * rh + 16;
  fillRound(ctx, x, y, w, h, 14, p.card);
  ctx.textBaseline = 'middle';
  rows.forEach((row, i) => {
    const cy = y + 8 + rh * i + rh / 2;
    ctx.textAlign = 'left';
    ctx.font = '22px sans-serif';
    ctx.fillStyle = row[2] || p.sub;
    ctx.fillText(clipText(ctx, row[0], w * 0.58), x + 20, cy);
    ctx.textAlign = 'right';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = row[3] || p.text;
    ctx.fillText(clipText(ctx, String(row[1]), w * 0.36), x + w - 20, cy);
  });
  return y + h;
}

// 横排指标卡。items: [{ label, value, color?, sub? }]
function metricRow(ctx, p, x, y, w, items) {
  const n = items.length || 1;
  const gap = 12;
  const cw = (w - gap * (n - 1)) / n;
  const h = 100;
  ctx.textBaseline = 'middle';
  items.forEach((it, i) => {
    const cx = x + i * (cw + gap);
    fillRound(ctx, cx, y, cw, h, 14, p.card);
    ctx.textAlign = 'left';
    ctx.font = '20px sans-serif';
    ctx.fillStyle = p.sub;
    ctx.fillText(clipText(ctx, it.label, cw - 32), cx + 16, y + 32);
    ctx.font = 'bold 34px sans-serif';
    ctx.fillStyle = it.color || p.text;
    ctx.fillText(clipText(ctx, String(it.value), cw - 32), cx + 16, y + 70);
  });
  return y + h;
}

// 细进度条。ratio 0~1，超出自动截断。
function progress(ctx, p, x, y, w, h, ratio, color, trackColor) {
  fillRound(ctx, x, y, w, h, h / 2, trackColor || p.line);
  const r = Math.max(0, Math.min(1, ratio || 0));
  const fw = w * r;
  if (fw > h) fillRound(ctx, x, y, fw, h, h / 2, color);
  else if (fw > 0) fillRound(ctx, x, y, h, h, h / 2, color);
  return y + h;
}

// 瀑布图：把钱从「营收」一层层减到「净利」的过程画出来。
// steps: [{ label, value(正数), type: 'total' | 'minus', color?, valueText? }]
function waterfall(ctx, p, x, y, w, h, steps) {
  const n = steps.length || 1;
  const gap = 18;
  const bw = (w - gap * (n - 1)) / n;
  const maxV = Math.max.apply(null, steps.map(s => Math.abs(+s.value || 0)).concat([1]));
  const baseY = y + h;
  let cum = 0;
  ctx.textBaseline = 'middle';
  steps.forEach((s, i) => {
    const v = Math.abs(+s.value || 0);
    let top, bot;
    if (s.type === 'minus') { bot = cum; top = cum - v; cum = top; }
    else { top = v; bot = 0; cum = v; }
    const yTop = baseY - (top / maxV) * h;
    const yBot = baseY - (bot / maxV) * h;
    const bh = Math.max(3, Math.abs(yBot - yTop));
    const bx = x + i * (bw + gap);
    fillRound(ctx, bx, Math.min(yTop, yBot), bw, bh, 4, s.color || p.accent);

    ctx.textAlign = 'center';
    ctx.font = 'bold 21px sans-serif';
    ctx.fillStyle = s.valueColor || p.text;
    const vy = Math.max(y - 4, Math.min(yTop, yBot) - 17);
    ctx.fillText(clipText(ctx, s.valueText != null ? s.valueText : String(v), bw + 24), bx + bw / 2, vy);

    ctx.font = '20px sans-serif';
    ctx.fillStyle = p.sub;
    ctx.fillText(clipText(ctx, s.label, bw + 24), bx + bw / 2, baseY + 22);
  });
  return baseY + 40;
}

// 逐日营收柱：31 根窄柱 + 未记录日的底部灰条（漏记一眼可见）。
// days: [{ day, value, recorded }]
function dayBars(ctx, p, x, y, w, h, days) {
  const n = days.length || 1;
  const gap = 4;
  const bw = Math.max(3, (w - gap * (n - 1)) / n);
  const maxV = Math.max.apply(null, days.map(d => (d.recorded ? Math.abs(d.value) : 0)).concat([1]));
  const baseY = y + h;
  days.forEach((d, i) => {
    const bx = x + i * (bw + gap);
    if (!d.recorded) {
      fillRound(ctx, bx, baseY - 5, bw, 5, 2.5, p.line);
      return;
    }
    const bh = Math.max(5, Math.abs(d.value) / maxV * h);
    fillRound(ctx, bx, baseY - bh, bw, bh, 3, d.value < 0 ? p.brick : p.accent);
  });
  return baseY;
}

// 排行横条。items: [{ name, valueText, ratio(0~1), color, warn? }]
function rankBars(ctx, p, x, y, w, items) {
  const rowH = 40;
  const nameW = Math.min(210, w * 0.34);
  const barX = x + nameW + 14;
  const barW = Math.max(40, w - nameW - 14 - 96);
  ctx.textBaseline = 'middle';
  items.forEach((it, i) => {
    const cy = y + rowH * i + rowH / 2;
    ctx.textAlign = 'left';
    ctx.font = '22px sans-serif';
    ctx.fillStyle = p.text;
    ctx.fillText(clipText(ctx, ((i + 1) + '. ' + it.name), nameW), x, cy);

    fillRound(ctx, barX, cy - 9, barW, 18, 9, p.line);
    const fw = Math.max(10, barW * Math.max(0, Math.min(1, it.ratio || 0)));
    fillRound(ctx, barX, cy - 9, fw, 18, 9, it.color || p.accent);

    ctx.textAlign = 'right';
    ctx.font = 'bold 21px sans-serif';
    ctx.fillStyle = it.warn ? p.brick : p.sub;
    ctx.fillText(clipText(ctx, it.valueText, 86), x + w, cy);
  });
  return y + rowH * items.length;
}

// 环形图（中心留白，可叠中心文字）。ratio 0~1。
function donut(ctx, p, cx, cy, r, thick, ratio, color, track) {
  ctx.lineWidth = thick;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = track || p.line;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  const rr = Math.max(0, Math.min(1, ratio || 0));
  if (rr > 0.001) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * rr);
    ctx.stroke();
  }
}

// 深/浅色主题共用的「暖色分档」，热力与柱状配色统一走这里
function tone(p, level) {
  // level: 1 浅 / 2 中 / 3 深
  const dark = p.text === '#EDE3D6';
  if (level >= 3) return dark ? '#E89A5A' : '#C9743A';
  if (level === 2) return dark ? '#C98A52' : '#E2A46B';
  return dark ? '#7A5C40' : '#F2D3B4';
}

module.exports = {
  rrect, fillRound, clipText, sectionHead, kvRows, metricRow,
  progress, waterfall, dayBars, rankBars, donut, tone
};
