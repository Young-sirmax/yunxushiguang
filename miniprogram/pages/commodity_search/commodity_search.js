// pages/commodity_search/commodity_search.js
const API = require('../../api/api.js');
const { formatSkillPrice } = require('../../utils/expert.js');
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
        // 图书专区：适用专业（数组）拼接为可展示文本
        item.majorText = Array.isArray(item.major) ? item.major.join('、') : (item.major || '');
        // 类型角标与交易状态
        item.typeLabel = item.type === 'want' ? '求购' : (item.type === 'exchange' ? '易物' : (item.type === 'skill' ? '技能' : '闲置'));
        item.priceText = item.type === 'skill' ? formatSkillPrice(item.price_unit, item.price) : '';
        item.tradeStatusText = item.tradeStatus === 'matched'
          ? '已预定'
          : (item.tradeStatus === 'completed' ? '已完成' : '');
        return item;
      });
      this.setData({ results: list, searched: true });
    } catch(err) { console.error(err); }
    wx.hideLoading();
  },

  goDetail(e) { wx.navigateTo({ url: `/pages/commodity_detail/commodity_detail?id=${e.currentTarget.dataset.id}` }); },
  goBack() { wx.navigateBack(); }
});