// utils/backup.js —— 备份文件的落地与读取（纯 IO，不碰业务数据）
// 只做四件事：写临时文件、把文件发到聊天、从聊天选文件读回、剪贴板读写。
// 业务数据的组装与校验在 utils/store.js 的 exportBundle/validateImport 里。

// 文件名：烘焙成本备份-20261115-1820.json
// 用本地时间而不是 ISO，用户在聊天里一眼能认出是哪天导的
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function stamp() {
  const d = new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
}
function fileName() { return '烘焙成本备份-' + stamp() + '.json'; }

function fsm() { return wx.getFileSystemManager(); }

// 清理历史备份文件：每次导出都会写一个新文件，久了会占满用户目录（200MB 上限，
// 备份本身很小但仍会堆积累计）。只保留最新一份，旧的删掉；删失败不影响本次导出。
function cleanOld() {
  try {
    const dir = wx.env.USER_DATA_PATH;
    const fs = fsm();
    (fs.readdirSync(dir) || []).forEach(name => {
      if (!/^烘焙成本备份-\d{8}-\d{4}\.json$/.test(name)) return;
      try { fs.unlinkSync(dir + '/' + name); } catch (e) { /* 忽略单个删除失败 */ }
    });
  } catch (e) { /* 目录读取失败不阻塞导出 */ }
}

// 写入小程序用户目录，返回可分享的本地路径。
// 必须带 .json 扩展名：wx.shareFileMessage 对无扩展名文件不友好，接收方也打不开。
function writeTemp(text) {
  return new Promise((resolve, reject) => {
    const name = fileName();
    const filePath = wx.env.USER_DATA_PATH + '/' + name;
    cleanOld();
    try {
      fsm().writeFileSync(filePath, text, 'utf8');
      resolve({ filePath, fileName: name, bytes: text.length });
    } catch (e) {
      reject(new Error('写入备份文件失败：' + (e && e.errMsg ? e.errMsg : '未知错误')));
    }
  });
}

// 是否支持「发送文件到聊天」（基础库 2.16.1+ / 微信 8.0+；开发者工具部分版本不支持）
function canShareFile() {
  try { return !!(wx.canIUse && wx.canIUse('shareFileMessage')); } catch (e) { return false; }
}

function shareFile(filePath, name) {
  return new Promise((resolve, reject) => {
    if (!canShareFile()) { reject(new Error('当前环境不支持发送文件')); return; }
    wx.shareFileMessage({
      filePath,
      fileName: name || fileName(),
      success: () => resolve(true),
      fail: (err) => reject(new Error((err && err.errMsg) || '发送取消'))
    });
  });
}

// 从聊天记录里选一个备份文件读成文本
function pickFileText() {
  return new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: (res) => {
        const f = res && res.tempFiles && res.tempFiles[0];
        if (!f || !f.path) { reject(new Error('没有取到文件')); return; }
        fsm().readFile({
          filePath: f.path,
          encoding: 'utf8',
          success: (r) => resolve({ name: f.name || '备份文件', text: String(r.data || '') }),
          fail: (err) => reject(new Error('读取文件失败：' + ((err && err.errMsg) || '未知错误')))
        });
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '已取消选择'))
    });
  });
}

function copyText(text) {
  return new Promise((resolve, reject) => {
    if (!text) { reject(new Error('没有可复制的内容')); return; }
    wx.setClipboardData({
      data: text,
      success: () => resolve(true),
      fail: (err) => reject(new Error((err && err.errMsg) || '复制失败'))
    });
  });
}

function readClipboard() {
  return new Promise((resolve, reject) => {
    wx.getClipboardData({
      success: (res) => resolve(String((res && res.data) || '')),
      fail: (err) => reject(new Error((err && err.errMsg) || '读取剪贴板失败'))
    });
  });
}

// 备份体积的人话描述：字符数 → KB（中文按 1 字符估算，仅用于提示）
function sizeText(chars) {
  if (chars < 1024) return chars + ' 字符';
  return (chars / 1024).toFixed(1) + ' KB';
}

module.exports = { fileName, writeTemp, canShareFile, shareFile, pickFileText, copyText, readClipboard, sizeText };
