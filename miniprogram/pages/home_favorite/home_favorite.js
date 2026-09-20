const API = require('../../api/api.js');
const NATIVE_COLORS = require('../../utils/nativeColors.js');
const { formatDate, showToast } = require('../../utils/util.js');
const { formatSkillPrice } = require('../../utils/expert.js');

Page({
  data: {
    list: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false
  },

  onLoad() {
    // 打开右上角“转发给朋友 / 分享到朋友圈”
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
  },

  onShareAppMessage() {
    return {
      title: '我在云叙石光收藏了不少好物，快来看看～',
      path: '/pages/commodity_list/commodity_list'
    };
  },

  onShareTimeline() {
    return { title: '云叙石光 · 校园物品信息服务平台', query: '' };
  },

  onShow() {
    this.setData({ page: 1, list: [] });
    this.loadList();
  },

  async loadList() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      showToast('请先登录');
      return;
    }

    this.setData({ loading: true });
    try {
      const res = await API.getFavoriteList({
        page: this.data.page,
        pageSize: this.data.pageSize
      });

      const newList = (res.data || []).map(item => ({
        ...item,
        timeText: formatDate(item.createTime),
        // 交易状态：已预定 / 已完成
        tradeStatusText: item.commodityTradeStatus === 'matched'
          ? '已预定'
          : (item.commodityTradeStatus === 'completed' ? '已完成' : ''),
        // 技能服务：报价文案
        priceText: item.commodityType === 'skill'
          ? formatSkillPrice(item.commodityPriceUnit, item.commodityPrice)
          : ''
      }));

      this.setData({
        list: this.data.page === 1 ? newList : this.data.list.concat(newList),
        total: res.total || 0,
        loading: false
      });
    } catch (err) {
      console.error('加载收藏列表失败:', err);
      this.setData({ loading: false });
      showToast('加载失败');
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/commodity_detail/commodity_detail?id=${id}`
    });
  },

  goHome() {
    wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
  },

  removeFavorite(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '取消收藏',
      content: '确定要取消收藏这件商品吗？',
      confirmColor: NATIVE_COLORS.error,
      success: async (res) => {
        if (res.confirm) {
          try {
            await API.removeFavorite(id);
            showToast('已取消收藏');
            this.setData({ page: 1, list: [] });
            this.loadList();
          } catch (err) {
            showToast('操作失败');
          }
        }
      }
    });
  },

  onReachBottom() {
    if (this.data.loading) return;
    if (this.data.list.length >= this.data.total) return;

    this.setData({ page: this.data.page + 1 });
    this.loadList();
  },

  onPullDownRefresh() {
    this.setData({ page: 1, list: [] });
    this.loadList().then(() => {
      wx.stopPullDownRefresh();
    });
  }
});
