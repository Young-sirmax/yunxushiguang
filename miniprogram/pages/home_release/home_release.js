// pages/home_release/home_release.js
const app = getApp();
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');
Page({
  data: { list: [], deletedList: [] },
  onShow() { this.loadList(); },
  async loadList() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;
    showLoading();
    try {
      const res = await API.getCommodityList({ sellerId: openid, page: 1, pageSize: 100, includeDeleted: true });
      const all = res.data || [];
      this.setData({
        list: all.filter(i => i.status !== 'deleted'),
        deletedList: all.filter(i => i.status === 'deleted')
      });
    } catch(err) { console.error(err); }
    hideLoading();
  },
  editItem(e) {
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release?mode=edit&id=' + e.currentTarget.dataset.id });
  },
  deleteItem(e) {
    wx.showModal({ title: '确认删除', content: '删除后可在"已删除商品"中恢复', success: async (res) => {
      if (res.confirm) {
        try { await API.deleteCommodity(e.currentTarget.dataset.id); showToast('已删除'); this.loadList(); }
        catch(err) { showToast('删除失败'); }
      }
    }});
  },
  restoreItem(e) {
    wx.showModal({ title: '恢复商品', content: '恢复后商品将回到"出售中"状态，可继续编辑', success: async (res) => {
      if (res.confirm) {
        try {
          await API.restoreCommodity(e.currentTarget.dataset.id);
          showToast('已恢复');
          this.loadList();
        } catch(err) { showToast('恢复失败'); }
      }
    }});
  },
  editDeletedItem(e) {
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release?mode=edit&id=' + e.currentTarget.dataset.id });
  }
});
