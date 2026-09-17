// pages/home_about/home_about.js
Page({
  data: {
    // ⚠️ 请把这里替换成平台官方微信号；留空则「官方微信」一行不展示
    officialWechat: '',
    version: 'v2.0.0'
  },

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
