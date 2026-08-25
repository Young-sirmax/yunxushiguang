// pages/business/business.js
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');

Page({
  data: {
    activeTab: 'pack',
    operatorWechat: 'campus-helper',

    packServices: [
      {
        id: 'single',
        name: '单条代发',
        price: 1,
        unit: '条',
        desc: '素材精修 + 模板文案 + 社群推送',
        features: ['选主图调色', '标准化标题', '定价建议', '同步推群']
      },
      {
        id: 'semester',
        name: '学期会员',
        price: 19,
        unit: '学期',
        desc: '学期内不限量代发，长期锁定',
        features: ['不限条代发', '优先精修', '专属社群推送', '会员标识']
      }
    ],

    boostServices: [
      { id: 'multiImg', name: '多图权限', icon: '🖼️', price: 1, desc: '可一次性发9张图+1个视频' },
      { id: 'urgent', name: '急出标签', icon: '🔥', price: 2, desc: '帖子角标变红，触发一次社群广播' },
      { id: 'top', name: '置顶展示', icon: '📌', price: 3, desc: '固定在分类信息流顶部24小时' },
      { id: 'precision', name: '精准推送', icon: '🎯', price: 5, desc: '手动推送到3个垂直社群' }
    ]
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  applyService(e) {
    const id = e.currentTarget.dataset.id;
    const type = e.currentTarget.dataset.type;
    const typeMap = { pack: '信息精装', boost: '信息加速', match: '悬赏撮合' };
    wx.showModal({
      title: '申请服务',
      content: `请添加运营者微信"${this.data.operatorWechat}"，发送服务ID"${id}"进行开通。`,
      confirmText: '复制微信号',
      cancelText: '我知道了',
      confirmColor: '#07c160',
      success: (res) => {
        if (res.confirm) {
          this.copyWechat();
        }
      }
    });
  },

  copyWechat() {
    wx.setClipboardData({
      data: this.data.operatorWechat,
      success: () => {
        showToast('微信号已复制，可去微信添加好友');
      }
    });
  },

  goRelease() {
    if (!wx.getStorageSync('openid')) {
      wx.navigateTo({ url: '/pages/index_register/index_register' });
      return;
    }
    wx.setStorageSync('releaseMode', 'want');
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release' });
  }
});