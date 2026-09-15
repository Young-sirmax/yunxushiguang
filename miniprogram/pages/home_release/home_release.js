// pages/home_release/home_release.js —— 我发布的信息（闲置商品 / 求购物品 双分类）
const app = getApp();
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');

Page({
  data: {
    tab: 'sell',            // 'sell' 闲置商品 | 'want' 求购物品
    list: [],               // 当前 Tab 的进行中信息（未删除）
    deletedList: [],        // 当前 Tab 的已删除信息
    sellList: [],           // 闲置（全部，含已删除）
    sellDeletedList: [],
    wantList: [],
    wantDeletedList: [],
    sellCount: 0,
    wantCount: 0,
    loading: true
  },

  onLoad(options) {
    const tab = (options && options.tab === 'want') ? 'want' : 'sell';
    this.setData({ tab });
    wx.setNavigationBarTitle({ title: '我发布的信息' });
  },

  onShow() {
    this.loadList();
  },

  // 补充展示字段（审核状态 / 认证标识）
  decorate(item) {
    const isWant = item.type === 'want';
    // 审核状态展示：onSale 出售中/求购中 · pendingReview 审核中 · rejected 已驳回 · sold 已结束
    const statusMap = {
      onSale: { text: isWant ? '求购中' : '出售中', cls: 'onsale' },
      pendingReview: { text: '审核中', cls: 'pending' },
      rejected: { text: '已驳回', cls: 'rejected' },
      sold: { text: '已结束', cls: 'sold' }
    };
    const st = statusMap[item.status] || { text: '已结束', cls: 'sold' };
    return Object.assign({}, item, {
      isVerified: item.isStudentVerified || false,
      statusText: st.text,
      statusClass: st.cls
    });
  },

  splitByStatus(items) {
    const all = items.map(i => this.decorate(i));
    return {
      active: all.filter(i => i.status !== 'deleted'),
      deleted: all.filter(i => i.status === 'deleted')
    };
  },

  async loadList() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      this.setData({ loading: false });
      return;
    }
    showLoading();
    try {
      // 分别拉取「闲置商品」与「求购物品」两类，供两个 Tab 即时切换
      const [sellRes, wantRes] = await Promise.all([
        API.getCommodityList({ sellerId: openid, page: 1, pageSize: 100, includeDeleted: true, type: 'sell' }),
        API.getCommodityList({ sellerId: openid, page: 1, pageSize: 100, includeDeleted: true, type: 'want' })
      ]);
      const sell = this.splitByStatus((sellRes && sellRes.data) || []);
      const want = this.splitByStatus((wantRes && wantRes.data) || []);

      const sellCount = sell.active.length;
      const wantCount = want.active.length;

      this.setData({
        sellList: sell.active,
        sellDeletedList: sell.deleted,
        wantList: want.active,
        wantDeletedList: want.deleted,
        sellCount,
        wantCount,
        loading: false
      });
      this.syncTabView();
    } catch (err) {
      console.error('加载我发布的信息失败:', err);
      this.setData({ loading: false });
      showToast('加载失败，请稍后重试');
    }
    hideLoading();
  },

  // 将当前 Tab 对应的列表同步到渲染字段
  syncTabView() {
    const { tab, sellList, sellDeletedList, wantList, wantDeletedList } = this.data;
    if (tab === 'want') {
      this.setData({ list: wantList, deletedList: wantDeletedList });
    } else {
      this.setData({ list: sellList, deletedList: sellDeletedList });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (this.data.tab === tab) return;
    this.setData({ tab });
    this.syncTabView();
  },

  goPublish() {
    const type = this.data.tab === 'want' ? 'want' : 'sell';
    const url = type === 'want'
      ? '/pages/commodity_release/commodity_release?type=want'
      : '/pages/commodity_release/commodity_release?type=sell';
    wx.navigateTo({ url });
  },

  editItem(e) {
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release?mode=edit&id=' + e.currentTarget.dataset.id });
  },

  deleteItem(e) {
    wx.showModal({
      title: '确认删除',
      content: '删除后可在"已删除"列表中恢复',
      success: async (res) => {
        if (res.confirm) {
          try {
            await API.deleteCommodity(e.currentTarget.dataset.id);
            showToast('已删除');
            this.loadList();
          } catch (err) {
            showToast('删除失败');
          }
        }
      }
    });
  },

  restoreItem(e) {
    wx.showModal({
      title: '恢复信息',
      content: '恢复后信息将重新提交审核，审核通过后重新展示',
      success: async (res) => {
        if (res.confirm) {
          try {
            await API.restoreCommodity(e.currentTarget.dataset.id);
            showToast('已恢复');
            this.loadList();
          } catch (err) {
            showToast('恢复失败');
          }
        }
      }
    });
  },

  editDeletedItem(e) {
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release?mode=edit&id=' + e.currentTarget.dataset.id });
  },

  onPullDownRefresh() {
    this.loadList().then(() => {
      wx.stopPullDownRefresh();
    });
  }
});
