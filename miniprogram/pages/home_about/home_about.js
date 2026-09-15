// pages/home_about/home_about.js
Page({
  goFeedback() {
    wx.navigateTo({ url: '/pages/home_feedback/home_feedback' });
  },

  onShareAppMessage() {
    return {
      title: '云叙石光 · 校园物品信息服务平台',
      path: '/pages/commodity_list/commodity_list'
    };
  }
});
