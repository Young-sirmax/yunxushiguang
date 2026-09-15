// pages/commodity_search/commodity_search.js
const API = require('../../api/api.js');
Page({
  data: { keyword: '', results: [], searched: false, focusInput: false },

  onReady() {
    setTimeout(() => {
      this.setData({ focusInput: true });
    }, 100);
  },

  onInputFocus() {
    this.setData({ focusInput: true });
  },

  onInputBlur() {
    this.setData({ focusInput: false });
  },

  onInput(e) { this.setData({ keyword: e.detail.value }); },

  clearKeyword() {
    this.setData({ keyword: '', results: [], searched: false, focusInput: true });
  },

  async doSearch() {
    if (!this.data.keyword.trim()) return;
    wx.showLoading({ title: '搜索中...' });
    try {
      const res = await API.searchCommodity(this.data.keyword.trim());
      const list = (res.data || []).map(item => {
        item.isVerified = item.isStudentVerified || false;
        return item;
      });
      this.setData({ results: list, searched: true });
    } catch(err) { console.error(err); }
    wx.hideLoading();
  },

  goDetail(e) { wx.navigateTo({ url: `/pages/commodity_detail/commodity_detail?id=${e.currentTarget.dataset.id}` }); },
  goBack() { wx.navigateBack(); }
});