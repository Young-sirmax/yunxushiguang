// pages/bookcorner/exchange.js —— B区「拿一留一」换书登记
const API = require('../../api/api.js');
const NATIVE_COLORS = require('../../utils/nativeColors.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');
const { DEFAULT_SPACE_ID } = require('../../utils/bookcorner.js');

const TITLE_MAX = 50;

Page({
  data: {
    bookTitle: '',
    giveTitle: '',
    bookLen: 0,
    giveLen: 0,
    titleMax: TITLE_MAX,
    nickname: '',
    submitting: false,
    done: false
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({
      nickname: userInfo.nickName || userInfo.nickname || '（登录后自动带出昵称）'
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = (e.detail.value || '').slice(0, TITLE_MAX);
    if (field === 'bookTitle') {
      this.setData({ bookTitle: value, bookLen: value.length });
    } else {
      this.setData({ giveTitle: value, giveLen: value.length });
    }
  },

  requireLogin() {
    wx.showModal({
      title: '需要登录',
      content: '登录后才能登记换书',
      confirmText: '去登录',
      confirmColor: NATIVE_COLORS.primary,
      success: (res) => {
        if (res.confirm) wx.navigateTo({ url: '/pages/index/index' });
      }
    });
  },

  async submit() {
    if (this.data.submitting) return;
    const bookTitle = (this.data.bookTitle || '').trim();
    const giveTitle = (this.data.giveTitle || '').trim();
    if (!bookTitle) {
      showToast('请填写要带走的书名');
      return;
    }
    if (!giveTitle) {
      showToast('请填写要留下的书名');
      return;
    }
    if (!wx.getStorageSync('openid')) {
      this.requireLogin();
      return;
    }

    this.setData({ submitting: true });
    showLoading('提交中...');
    try {
      const res = await API.addBookExchange({
        spaceId: DEFAULT_SPACE_ID,
        bookTitle,
        giveTitle
      });
      hideLoading();
      if (!res || res.code !== 0) {
        showToast((res && res.msg) || '登记失败');
        return;
      }
      this.setData({ done: true });
    } catch (err) {
      hideLoading();
      showToast(err.message || '登记失败，请稍后重试');
    } finally {
      this.setData({ submitting: false });
    }
  },

  // 转化钩子：手上还有闲置教材 → 去发布（发布页暂不支持 from 参数，先本地记录来源）
  goPublish() {
    wx.setStorageSync('publishFrom', 'bookcorner');
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release?from=bookcorner' });
  },

  backToList() {
    wx.navigateTo({ url: '/pages/bookcorner/list?zone=A' });
  }
});
