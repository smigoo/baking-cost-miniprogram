// utils/export.js —— 导出长图 + 分享（日报/月报复用）
// 颜色与 app.wxss 的 CSS 变量保持一致，长图随系统深浅主题变化。

// 协调烘焙暖色：奶油米底 + 焦糖橙强调 + 橄榄绿=盈利 + 砖红=成本/预警；深色下降饱和更柔和
function getPalette(dark) {
  if (dark) {
    return {
      bg: '#211A14', card: '#2C241C', surface: '#3A3128',
      text: '#EDE3D6', sub: '#B7A994', line: '#3A3128',
      accent: '#E89A5A', honey: '#D9A05B', olive: '#9EC27F',
      brick: '#E07A5F', white: '#FBF4EC'
    };
  }
  return {
    bg: '#FBF4EC', card: '#FFFFFF', surface: '#FFFFFF',
    text: '#4A3B2E', sub: '#8C7A6B', line: '#F0E4D6',
    accent: '#DE8A4E', honey: '#F2B75E', olive: '#8BAE6B',
    brick: '#CF6A4F', white: '#FBF4EC'
  };
}

// 读取系统主题（darkmode 开启后，getAppBaseInfo/getWindowInfo 会带 theme 字段）
function isSystemDark() {
  try {
    let info;
    if (wx.getAppBaseInfo) info = wx.getAppBaseInfo();
    else if (wx.getWindowInfo) info = wx.getWindowInfo();
    else info = wx.getSystemInfoSync();
    return !!(info && info.theme === 'dark');
  } catch (e) {
    return false;
  }
}

// 在离屏 canvas 上绘制并导出临时图片
function renderToImage(canvas, dpr, W, H, draw) {
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  draw(ctx, W);
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      success: r => resolve(r.tempFilePath),
      fail: () => reject(new Error('canvas-to-temp-failed'))
    });
  });
}

// 统一分享：保存相册 / 分享给微信好友·朋友圈
function shareImage(path) {
  wx.showActionSheet({
    itemList: ['保存到相册', '分享给微信好友 / 朋友圈'],
    success: res => {
      if (res.tapIndex === 0) {
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => wx.showToast({ title: '已保存到相册' }),
          fail: () => wx.showModal({ title: '保存失败', content: '请在「设置」中允许保存到相册后重试', showCancel: false })
        });
      } else if (wx.showShareImageMenu) {
        wx.showShareImageMenu({ path, fail: () => wx.showToast({ title: '当前微信版本不支持，请先保存相册', icon: 'none' }) });
      } else {
        wx.showToast({ title: '请先保存相册再手动分享', icon: 'none' });
      }
    }
  });
}

module.exports = { getPalette, isSystemDark, renderToImage, shareImage };
