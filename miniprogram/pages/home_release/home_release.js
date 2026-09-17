// pages/home_release/home_release.js —— 我发布的信息（闲置转让 / 求购 / 以物易物 三分类）
const app = getApp();
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');
const { formatSkillPrice } = require('../../utils/expert.js');

// 发布类型：闲置转让 / 求购 / 以物易物 / 技能服务
const TAB_TYPES = ['sell', 'want', 'exchange', 'skill'];

Page({
  data: {
    tab: 'sell',            // 'sell' 闲置 | 'want' 求购 | 'exchange' 以物易物
    list: [],               // 当前 Tab 的进行中信息（未删除）
    deletedList: [],        // 当前 Tab 的已删除信息
    sellList: [],
    sellDeletedList: [],
    sellCount: 0,
    wantList: [],
    wantDeletedList: [],
    wantCount: 0,
    exchangeList: [],
    exchangeDeletedList: [],
    exchangeCount: 0,
    skillList: [],
    skillDeletedList: [],
    skillCount: 0,
    loading: true
  },

  onLoad(options) {
    const tab = (options && TAB_TYPES.indexOf(options.tab) > -1) ? options.tab : 'sell';
    this.setData({ tab });
    wx.setNavigationBarTitle({ title: '我发布的信息' });
  },

  onShow() {
    this.loadList();
  },

  // 补充展示字段（类型 / 审核状态 / 交易状态 / 认证标识）
  decorate(item) {
    const isWant = item.type === 'want';
    const isExchange = item.type === 'exchange';
    const isSkill = item.type === 'skill';

    // 审核状态：onSale 出售中/求购中/易物中/服务中 · pendingReview 审核中 · rejected 已驳回 · sold 已结束
    const statusMap = {
      draft: { text: '待上架', cls: 'pending' },   // 批量上架导入的草稿
      onSale: {
        text: isWant ? '求购中' : (isExchange ? '易物中' : (isSkill ? '服务中' : '出售中')),
        cls: 'onsale'
      },
      pendingReview: { text: '审核中', cls: 'pending' },
      rejected: { text: '已驳回', cls: 'rejected' },
      sold: { text: '已结束', cls: 'sold' }
    };
    const st = statusMap[item.status] || { text: '已结束', cls: 'sold' };

    return Object.assign({}, item, {
      isVerified: item.isStudentVerified || false,
      typeLabel: isWant ? '求购' : (isExchange ? '易物' : (isSkill ? '技能' : '闲置')),
      // 技能服务：报价文案
      priceText: isSkill ? formatSkillPrice(item.price_unit, item.price) : '',
      statusText: st.text,
      statusClass: st.cls,
      // 交易状态：已预定 / 已完成
      tradeStatusText: item.tradeStatus === 'matched'
        ? '已预定'
        : (item.tradeStatus === 'completed' ? '已完成' : '')
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
      // 三类分别拉取，供三个 Tab 即时切换
      const results = await Promise.all(TAB_TYPES.map(type =>
        API.getCommodityList({
          sellerId: openid,
          page: 1,
          pageSize: 20,
          includeDeleted: true,
          type
        })
      ));

      const patch = { loading: false };
      TAB_TYPES.forEach((type, index) => {
        const split = this.splitByStatus((results[index] && results[index].data) || []);
        patch[type + 'List'] = split.active;
        patch[type + 'DeletedList'] = split.deleted;
        patch[type + 'Count'] = split.active.length;
      });
      this.setData(patch);
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
    const { tab } = this.data;
    this.setData({
      list: this.data[tab + 'List'] || [],
      deletedList: this.data[tab + 'DeletedList'] || []
    });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (this.data.tab === tab) return;
    this.setData({ tab });
    this.syncTabView();
  },

  goPublish() {
    const tab = this.data.tab;
    const type = TAB_TYPES.indexOf(tab) > -1 ? tab : 'sell';
    wx.navigateTo({ url: `/pages/commodity_release/commodity_release?type=${type}` });
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
