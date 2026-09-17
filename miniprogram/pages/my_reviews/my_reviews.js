// pages/my_reviews/my_reviews.js —— 我收到的评价
const API = require('../../api/api.js');
const { formatDate } = require('../../utils/util.js');
const { formatRating } = require('../../utils/expert.js');

Page({
  data: {
    list: [],
    total: 0,
    ratingText: '',
    loading: true
  },

  onShow() {
    this.loadList();
  },

  async loadList() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ loading: false });
      return;
    }
    try {
      const res = await API.getMyReceivedReviews({ page: 1, pageSize: 20 });
      const list = (res.data || []).map(item => ({
        ...item,
        timeText: formatDate(item.created_at),
        stars: '★★★★★'.slice(0, item.rating || 0)
      }));
      const summary = res.summary || { avg: 0, count: 0 };
      this.setData({
        list,
        total: res.total || 0,
        ratingText: formatRating(summary.avg, summary.count),
        loading: false
      });
    } catch (err) {
      console.error('加载评价失败:', err);
      this.setData({ loading: false });
    }
  }
});
