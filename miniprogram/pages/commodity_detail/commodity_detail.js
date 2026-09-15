// pages/commodity_detail/commodity_detail.js
const app = getApp();
const API = require('../../api/api.js');
const { formatDate, showToast } = require('../../utils/util.js');

Page({
  data: {
    commodity: null,
    timeText: '',
    isOwner: false,
    isFavorited: false
  },

  async onLoad(options) {
    const id = options.id;
    if (!id) {
      showToast('商品ID不存在');
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
          wx.navigateBack();
        } else {
          wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
        }
      }, 1500);
      return;
    }
    this.commodityId = id;
    this._isFirstLoad = true;

    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    });
  },

  async onShow() {
    if (this._isFirstLoad) {
      this._isFirstLoad = false;
      await this.loadDetail();
    } else if (this.commodityId) {
      await this.loadDetail();
    }
  },

  async loadDetail() {
    try {
      const res = await API.getCommodityDetail(this.commodityId);
      if (res.code === 0) {
        const commodity = res.data;
        commodity.isVerified = commodity.sellerIsStudentVerified || false;
        const openid = wx.getStorageSync('openid');
        this.setData({
          commodity,
          timeText: formatDate(commodity.createTime),
          isOwner: commodity._openid === openid
        });
        wx.setNavigationBarTitle({ title: commodity.title });
        await this.checkFavoriteStatus();
      } else {
        showToast(res.msg || '商品不存在或已下架');
        setTimeout(() => {
          const pages = getCurrentPages();
          if (pages.length > 1) {
            wx.navigateBack();
          } else {
            wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
          }
        }, 1500);
      }
    } catch (err) {
      console.error('[详情页] loadDetail 异常:', err);
      showToast('加载失败，请重试');
    }
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    const images = (this.data.commodity && this.data.commodity.images) || [];
    if (images.length === 0) return;
    wx.previewImage({
      current: url,
      urls: images
    });
  },

  goHome() {
    wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
  },

  editCommodity() {
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release?mode=edit&id=' + this.commodityId });
  },

  copyContact() {
    const contact = this.data.commodity && this.data.commodity.sellerContact;
    if (!contact) {
      showToast('卖家未填写联系方式');
      return;
    }
    wx.setClipboardData({
      data: String(contact),
      success: () => {
        showToast('联系方式已复制');
      }
    });
  },

  shareTitle(c) {
    if (!c) return '校园闲置好物分享';
    if (c.type === 'want') {
      return `【求购】${c.title}，有闲置快联系我吧`;
    }
    const price = c.price > 0 ? `¥${c.price}` : '免费';
    return `【${c.condition || '闲置'}】${c.title} ${price}`;
  },

  onShareAppMessage() {
    const c = this.data.commodity;
    if (!c) {
      return { title: '校园闲置好物分享', path: '/pages/commodity_list/commodity_list' };
    }
    return {
      title: this.shareTitle(c),
      path: `/pages/commodity_detail/commodity_detail?id=${this.commodityId}`,
      imageUrl: c.images && c.images[0] ? c.images[0] : ''
    };
  },

  onShareTimeline() {
    const c = this.data.commodity;
    if (!c) {
      return { title: '校园闲置好物分享', query: '' };
    }
    return {
      title: this.shareTitle(c),
      query: `id=${this.commodityId}`,
      imageUrl: c.images && c.images[0] ? c.images[0] : ''
    };
  },

  async checkFavoriteStatus() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;
    try {
      const res = await API.checkFavorite(this.commodityId);
      if (res.code === 0) {
        this.setData({ isFavorited: res.data.isFavorited });
      }
    } catch (err) {
      console.error('检查收藏状态失败:', err);
    }
  },

  async toggleFavorite() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      wx.showModal({
        title: '提示',
        content: '请先登录后再收藏',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/index/index' });
          }
        }
      });
      return;
    }

    try {
      const res = await API.toggleFavorite(this.commodityId);
      if (res.code === 0) {
        this.setData({ isFavorited: res.data.isFavorited });
        showToast(res.msg);
      } else {
        showToast(res.msg || '操作失败');
      }
    } catch (err) {
      console.error('收藏操作失败:', err);
      showToast(err.message || '操作失败，请重试');
    }
  }
});