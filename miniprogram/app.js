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
    }
  }
});
