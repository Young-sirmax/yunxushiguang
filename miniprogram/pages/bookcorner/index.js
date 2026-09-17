// pages/bookcorner/index.js —— 公益图书角主页（空间信息 + 两个分区入口）
const API = require('../../api/api.js');
const { showToast } = require('../../utils/util.js');
const { DEFAULT_SPACE_ID, ZONES } = require('../../utils/bookcorner.js');

Page({
  data: {
    loading: true,
    spaceName: '公益图书角',
    spaceLogo: '',
    zones: [ZONES.A, ZONES.B]
  },

  onLoad() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    this.loadSpace();
  },

  async loadSpace() {
    this.setData({ loading: true });
    try {
      const res = await API.getBookcornerSpace(DEFAULT_SPACE_ID);
      if (res && res.code === 0 && res.data) {
        this.setData({
          spaceName: res.data.name || '公益图书角',
          spaceLogo: res.data.logo || ''
        });
      } else {
        showToast((res && res.msg) || '空间信息加载失败');
      }
    } catch (err) {
      console.error('图书角空间加载失败:', err);
      showToast('网络失败，请稍后重试');
    } finally {
      this.setData({ loading: false });
    }
  },

  goList(e) {
    const zone = e.currentTarget.dataset.zone;
    wx.navigateTo({ url: `/pages/bookcorner/list?zone=${zone}` });
  },

  onShareAppMessage() {
    return {
      title: '茶咖公益图书角 · 来留一段读书的话',
      path: '/pages/bookcorner/index'
    };
  },

  onShareTimeline() {
    return { title: '茶咖公益图书角 · 云叙石光' };
  }
});
