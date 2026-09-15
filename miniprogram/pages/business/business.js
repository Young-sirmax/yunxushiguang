// pages/business/business.js
const { showToast } = require('../../utils/util.js');

Page({
  data: {
    operatorWechat: 'campus-helper'
  },

  goRelease() {
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release' });
  },

  copyWechat() {
    wx.setClipboardData({
      data: this.data.operatorWechat,
      success: () => { showToast('微信号已复制'); }
    });
  }
});