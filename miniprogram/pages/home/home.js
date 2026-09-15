// pages/home/home.js
const app = getApp();
const API = require('../../api/api.js');

Page({
  data: {
    userInfo: {},
    isLoggedIn: false,
    isAdmin: false,
    stats: { release: 0, favorite: 0 }
  },

  onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    const isLoggedIn = !!(userInfo && userInfo._openid);
    this.setData({ userInfo, isLoggedIn });
    if (isLoggedIn) {
      this.loadStats();
      this.checkAdmin();
      // 后台刷新最新用户信息（含认证状态），保证全局一致
      app.refreshUserInfo().then((fresh) => {
        if (fresh) {
          this.setData({ userInfo: fresh });
        }
      });
    }
  },

  checkAdmin() {
    if (!this.data.isLoggedIn) return;
    API.adminCheck()
      .then((res) => {
        if (res.code === 0 && res.data && res.data.isAdmin) {
          this.setData({ isAdmin: true });
        }
      })
      .catch((err) => {
        const msg = (err && err.message) || '';
        const isNotFound = msg.includes('504001') || msg.includes('找不到') || msg.includes('not found');
        if (isNotFound) {
          wx.showToast({
            title: '请部署admin云函数',
            icon: 'none',
            duration: 2500
          });
        }
        console.error('管理员校验失败:', err);
      });
  },

  goAdmin() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/admin/admin' });
    });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/index/index' });
  },

  async loadStats() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    try {
      const releaseRes = await API.getCommodityList({ sellerId: openid, page: 1, pageSize: 1 });
      let favoriteTotal = 0;
      try {
        const favRes = await API.getFavoriteList({ page: 1, pageSize: 1 });
        favoriteTotal = favRes.total || 0;
      } catch (e) {
        console.error('加载收藏数失败:', e);
      }

      this.setData({
        stats: {
          release: releaseRes.total || 0,
          favorite: favoriteTotal
        }
      });
    } catch (err) {
      console.error('加载统计失败:', err);
    }
  },

  requireLogin(callback) {
    if (!this.data.isLoggedIn) {
      wx.showModal({
        title: '提示',
        content: '请先登录后再使用此功能',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            this.goLogin();
          }
        }
      });
      return;
    }
    if (callback) callback();
  },

  goUserInfo() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/home_user_info/home_user_info' });
    });
  },

  goMyRelease() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/home_release/home_release' });
    });
  },

  goMyWant() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/home_release/home_release?tab=want' });
    });
  },

  goMyFavorite() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/home_favorite/home_favorite' });
    });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goAbout() {
    wx.navigateTo({ url: '/pages/home_about/home_about' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/home_feedback/home_feedback' });
  },

  logout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          app.globalData.userInfo = null;
          app.globalData.openid = null;
          wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
        }
      }
    });
  }
});