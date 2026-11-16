// 滚动浮窗组件：一键到顶/到底 + 长按拖动定位 + 半透明减少遮挡。
// 项目全部页面均为页面级滚动（wx.pageScrollTo），没有用 scroll-view，故此处统一走页面滚动。
//
// 手势约定：
// - 轻点按钮：照常滚动（toTop / toBottom）
// - 长按浮窗 400ms：进入拖拽态（透明度和阴影给出反馈），移动手指可拖动浮窗到任意位置
// - 松手：保存位置到本地缓存（独立 key，不碰业务数据），下次进入自动恢复
// - 拖拽误触保护：真正拖动过则抑制本次松手产生的 tap，避免滚错页面

const POS_KEY = 'scroll_fab_pos_v1';          // 位置持久化 key（与业务数据 baking_state_v1 隔离）
const LONG_PRESS_MS = 400;                    // 长按触发拖拽的时长(ms)
const MOVE_TOLERANCE = 10;                    // 长按前手指移动的容忍距离(px)，超过则取消长按(视为误触)
const FAB_W = 56;                             // 浮窗宽度(px)，用于边界约束
const FAB_H = 116;                            // 浮窗高度(px)，两枚按钮 48+48+间距+内边距
const EDGE = 8;                               // 距离视口边缘的最小留白(px)
const OPACITY_IDLE = 0.55;                    // 平时半透明，减少内容遮挡
const OPACITY_DRAG = 0.95;                    // 拖拽时不透明，明确反馈

// 取视口宽高（含安全区），兼容新旧基础库
function viewport() {
  let w, h;
  if (typeof wx.getWindowInfo === 'function') {
    const info = wx.getWindowInfo();
    w = info.windowWidth; h = info.windowHeight;
  } else {
    const info = wx.getSystemInfoSync();
    w = info.windowWidth; h = info.windowHeight;
  }
  return { w: w || 375, h: h || 667 };
}

// 把位置约束在视口内
function clampXY(x, y) {
  const { w, h } = viewport();
  const maxX = Math.max(EDGE, w - FAB_W - EDGE);
  const maxY = Math.max(EDGE, h - FAB_H - EDGE);
  return {
    x: Math.round(Math.min(maxX, Math.max(EDGE, x))),
    y: Math.round(Math.min(maxY, Math.max(EDGE, y)))
  };
}

// 默认位置：右下角，避开 tabBar（88px）与安全区
function defaultXY() {
  const { w, h } = viewport();
  let safeBottom = 0;
  try {
    let safe = null;
    if (typeof wx.getWindowInfo === 'function') safe = wx.getWindowInfo().safeArea;
    else safe = wx.getSystemInfoSync().safeArea;
    if (safe && typeof safe.bottom === 'number') safeBottom = Math.max(0, h - safe.bottom);
  } catch (e) {}
  return clampXY(w - FAB_W - 16, h - FAB_H - 88 - safeBottom);
}

Component({
  options: { addGlobalClass: true }, // 让组件内能用到 app.wxss 的暖色板 CSS 变量（--card/--caramel 等）

  data: {
    x: 0,                 // 浮窗左上角横坐标(px)，相对视口
    y: 0,                 // 浮窗左上角纵坐标(px)
    opacity: OPACITY_IDLE,// 透明度：平时半透明，拖拽时不透明
    dragging: false       // 是否处于拖拽态（控制阴影/缩放反馈）
  },

  lifetimes: {
    attached() {
      // 恢复上次保存的位置；无记录或数据异常则回落到右下角默认位置
      let saved = null;
      try { saved = wx.getStorageSync(POS_KEY); } catch (e) {}
      const pos = (saved && typeof saved.x === 'number' && typeof saved.y === 'number')
        ? clampXY(saved.x, saved.y)
        : defaultXY();
      this.setData(pos);
    }
  },

  methods: {
    // 手指按下：记起点与初始位置，启动长按计时器
    onTouchStart(e) {
      const t = (e.touches && e.touches[0]) || {};
      this._sx = t.clientX || 0;
      this._sy = t.clientY || 0;
      this._ox = this.data.x;
      this._oy = this.data.y;
      this._longPressed = false;
      this._suppressTap = false;
      const self = this;
      this._pressTimer = setTimeout(function () {
        self._longPressed = true;
        self._suppressTap = true; // 一旦进入拖拽态，松手后的 tap 一律吞掉，避免误滚动
        self.setData({ dragging: true, opacity: OPACITY_DRAG });
        if (typeof wx.vibrateShort === 'function') {
          try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
        }
      }, LONG_PRESS_MS);
    },

    // 手指移动：未达长按且位移超阈值→取消长按(误触)；已长按→拖动浮窗并约束在视口内
    onTouchMove(e) {
      const t = (e.touches && e.touches[0]) || {};
      const dx = (t.clientX || 0) - (this._sx || 0);
      const dy = (t.clientY || 0) - (this._sy || 0);
      if (!this._longPressed) {
        if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) {
          clearTimeout(this._pressTimer); // 用户想滑动页面，放弃本次长按
        }
        return;
      }
      this._suppressTap = true; // 真正拖动过，松手后的 tap 要吞掉
      this.setData(clampXY(this._ox + dx, this._oy + dy));
    },

    // 手指抬起：结束拖拽、恢复透明度；拖动过则持久化位置
    onTouchEnd() {
      clearTimeout(this._pressTimer);
      if (this._longPressed) {
        if (this._suppressTap) {
          try { wx.setStorageSync(POS_KEY, { x: this.data.x, y: this.data.y }); } catch (e) {}
        }
        this._longPressed = false;
      }
      this.setData({ dragging: false, opacity: OPACITY_IDLE });
    },

    // 回到页面顶部（拖拽松手产生的 tap 会被 _suppressTap 吞掉一次）
    toTop() {
      if (this._suppressTap) { this._suppressTap = false; return; }
      wx.pageScrollTo({ scrollTop: 0, duration: 300, fail: () => {} });
    },

    // 跳到页面底部：传一个远超页面长度的值，微信会自动 clamp 到真正底部。
    // 不用选择器是为了通用——5 个页面结构不同，没有统一的「最后一个元素」锚点。
    toBottom() {
      if (this._suppressTap) { this._suppressTap = false; return; }
      wx.pageScrollTo({ scrollTop: 200000, duration: 300, fail: () => {} });
    }
  }
});
