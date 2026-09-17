// pages/bookcorner/list.js —— 分区书目列表（分类横向筛选 + 下拉刷新 + 触底分页）
const API = require('../../api/api.js');
const { showToast } = require('../../utils/util.js');
const { DEFAULT_SPACE_ID, getZone } = require('../../utils/bookcorner.js');

const PAGE_SIZE = 20;
const SUMMARY_LEN = 40;

Page({
  data: {
    zone: 'A',
    zoneMeta: getZone('A'),
    categories: [],
    activeCategory: '',
    list: [],
    page: 1,
    total: 0,
    loading: false,
    noMore: false
  },

  onLoad(options) {
    const zone = (options && options.zone) || 'A';
    const zoneMeta = getZone(zone);
    this.setData({ zone, zoneMeta });
    wx.setNavigationBarTitle({ title: zoneMeta.name });
    this.loadList(true);
  },

  async loadList(reset) {
    if (this.data.loading) return;
    if (!reset && this.data.noMore) return;

    const page = reset ? 1 : (this.data.page + 1);
    this.setData({ loading: true });
    try {
      const res = await API.getBookList({
        spaceId: DEFAULT_SPACE_ID,
        zone: this.data.zone,
        category: this.data.activeCategory,
        page,
        pageSize: PAGE_SIZE
      });
      if (!res || res.code !== 0) {
        showToast((res && res.msg) || '加载失败');
        return;
      }
      const mapped = (res.data || []).map(item => ({
        _id: item._id,
        title: item.title || '',
        category: item.category || '',
        // 无封面图设计：简介只取前 40 字做摘要，为空则只显示书名 + 分类
        summary: (item.intro || '').slice(0, SUMMARY_LEN)
      }));
      const list = reset ? mapped : this.data.list.concat(mapped);
      this.setData({
        list,
        total: res.total || 0,
        page,
        categories: (Array.isArray(res.categories) && res.categories.length) ? res.categories : this.data.categories,
        noMore: list.length >= (res.total || 0)
      });
    } catch (err) {
      console.error('书目列表加载失败:', err);
      showToast('加载失败，请稍后重试');
    } finally {
      this.setData({ loading: false });
    }
  },

  switchCategory(e) {
    const category = e.currentTarget.dataset.category || '';
    if (category === this.data.activeCategory) return;
    this.setData({ activeCategory: category, list: [], total: 0, noMore: false });
    this.loadList(true);
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/bookcorner/detail?id=${id}` });
  },

  goExchange() {
    wx.navigateTo({ url: '/pages/bookcorner/exchange' });
  },

  onReachBottom() {
    this.loadList(false);
  },

  onPullDownRefresh() {
    this.setData({ noMore: false });
    this.loadList(true).then(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    return {
      title: '茶咖公益图书角 · 书单',
      path: `/pages/bookcorner/list?zone=${this.data.zone}`
    };
  }
});
