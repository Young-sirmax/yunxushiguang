// app.js
App({
  globalData: {
    userInfo: null,
    openid: null,
    university: null,
    editParams: null
  },
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-d0gvvc41c5a9dab3f',
        traceUser: true
      });
    }
    this.checkLoginStatus();
  },
  checkLoginStatus() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      // 后台静默刷新一次最新用户信息，保证认证状态全局同步
      this.refreshUserInfo();
    }
  },
  // 全局同步用户信息（storage + globalData），保证认证状态等数据全局一致、一次认证全平台生效
  syncUserInfo(userInfo) {
    if (!userInfo) return;
    wx.setStorageSync('userInfo', userInfo);
    this.globalData.userInfo = userInfo;
    const openid = userInfo._openid || userInfo.openid;
    if (openid) {
      wx.setStorageSync('openid', openid);
      this.globalData.openid = openid;
    }
  },
  // 从云端拉取最新用户信息（含认证状态），并全局同步
  async refreshUserInfo() {
    // 延迟加载 api.js，确保 wx.cloud.init 已完成（api.js 顶层会调用 wx.cloud.database()）
    const API = require('./api/api.js');
    const local = wx.getStorageSync('userInfo');
    if (!local || !local._openid) return null;
    try {
      const res = await API.getUserInfo();
      if (res && res.code === 0 && res.data) {
        this.syncUserInfo(res.data);
        return res.data;
      }
    } catch (err) {
      console.error('刷新用户信息失败:', err);
    }
    return null;
  }
});
