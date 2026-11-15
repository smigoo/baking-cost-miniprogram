// app.js
const store = require('./utils/store.js');

App({
  onLaunch() {
    // 初始化数据层：从本地存储读取，首次启动写入样例 seed
    store.init();
  }
});
