// pages/home/home.js
const app = getApp();
const API = require('../../api/api.js');

Page({
  data: {
    userInfo: {},
    stats: { release: 0, favorite: 0 },
    unreadMessageCount: 0,
    lifePlaza: [
      { id: 1, name: '学长打印店', tag: '打印·复印·装订', image: '/images/plaza-print.png' },
      { id: 2, name: '校园驾校', tag: 'C1/C2 驾照培训', image: '/images/plaza-drive.png' },
      { id: 3, name: '考研自习室', tag: '寄宿·网课·答疑', image: '/images/plaza-exam.png' },
      { id: 4, name: '神秘小甜水', tag: '奶茶·柠檬水', image: '/images/plaza-milk.png' },
      { id: 5, name: '校园洗衣房', tag: '干洗·水洗·上门', image: '/images/plaza-wash.png' }
    ]
  },

  onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({ userInfo });
    this.loadStats();
    this.loadUnreadCount();
  },

  async loadUnreadCount() {
    try {
      const res = await API.chatGetConversationList();
      if (res.code === 0) {
        let unread = 0;
        (res.data || []).forEach(c => {
          unread += (c.unreadCount || 0);
        });
        this.setData({ unreadMessageCount: unread });
      }
    } catch (err) {
      console.error('加载未读消息数失败:', err);
    }
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

  goUserInfo() {
    wx.navigateTo({ url: '/pages/home_user_info/home_user_info' });
  },

  goMyRelease() {
    wx.navigateTo({ url: '/pages/home_release/home_release' });
  },

  goMyFavorite() {
    wx.navigateTo({ url: '/pages/home_favorite/home_favorite' });
  },

  goMessage() {
    wx.navigateTo({ url: '/pages/home_message/home_message' });
  },

  goService() {
    wx.switchTab({ url: '/pages/business/business' });
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

  openPlaza(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.lifePlaza.find(p => p.id === id);
    if (item) {
      wx.showModal({
        title: item.name,
        content: item.tag + '\n\n信息位租赁中，如有合作意向请联系运营者微信',
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#07c160'
      });
    }
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
          wx.reLaunch({ url: '/pages/index/index' });
        }
      }
    });
  }
});