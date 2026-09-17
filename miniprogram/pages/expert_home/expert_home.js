// pages/expert_home/expert_home.js —— 技能达人主页（简单版）
const API = require('../../api/api.js');
const { formatDate } = require('../../utils/util.js');
const { formatSkillPrice, formatRating } = require('../../utils/expert.js');

Page({
  data: {
    openid: '',
    user: {},
    skills: [],
    certs: [],
    ratingText: '',
    reviews: [],
    posts: [],
    loading: true,
    isSelf: false
  },

  onLoad(options) {
    const openid = (options && options.openid) || '';
    this.setData({
      openid,
      isSelf: openid === (wx.getStorageSync('openid') || '')
    });
    this.loadAll();
  },

  async loadAll() {
    if (!this.data.openid) {
      this.setData({ loading: false });
      return;
    }
    wx.showLoading({ title: '加载中...' });
    await Promise.all([this.loadUser(), this.loadReviews(), this.loadPosts()]);
    wx.hideLoading();
    this.setData({ loading: false });
  },

  async loadUser() {
    try {
      const res = await API.getUserInfo(this.data.openid);
      if (res.code === 0 && res.data) {
        const u = res.data;
        const count = u.rating_count || 0;
        this.setData({
          user: u,
          skills: Array.isArray(u.expert_skills) ? u.expert_skills : [],
          certs: Array.isArray(u.expert_certs) ? u.expert_certs : [],
          ratingText: formatRating(count > 0 ? (u.rating_sum || 0) / count : 0, count)
        });
      }
    } catch (err) {
      console.error('加载达人信息失败:', err);
    }
  },

  async loadReviews() {
    try {
      const res = await API.getReviewsByTarget({ targetId: this.data.openid, page: 1, pageSize: 20 });
      const list = (res.data || []).map(item => ({
        ...item,
        timeText: formatDate(item.created_at),
        stars: '★★★★★'.slice(0, item.rating || 0)
      }));
      this.setData({ reviews: list });
      if (res.summary) {
        this.setData({ ratingText: formatRating(res.summary.avg, res.summary.count) });
      }
    } catch (err) {
      console.error('加载评价失败:', err);
    }
  },

  async loadPosts() {
    try {
      const res = await API.getCommodityList({
        sellerId: this.data.openid,
        type: 'skill',
        page: 1,
        pageSize: 20
      });
      const list = (res.data || [])
        .filter(item => item.status === 'onSale')
        .map(item => ({
          ...item,
          cover: item.cover || '',
          priceText: formatSkillPrice(item.price_unit, item.price),
          timeText: formatDate(item.createTime)
        }));
      this.setData({ posts: list });
    } catch (err) {
      console.error('加载技能服务失败:', err);
    }
  },

  previewCert(e) {
    const index = e.currentTarget.dataset.index;
    wx.previewImage({ current: this.data.certs[index], urls: this.data.certs });
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/commodity_detail/commodity_detail?id=${e.currentTarget.dataset.id}` });
  },

  goApply() {
    wx.navigateTo({ url: '/pages/expert_apply/expert_apply' });
  }
});
