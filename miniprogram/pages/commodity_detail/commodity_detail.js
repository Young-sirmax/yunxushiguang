// pages/commodity_detail/commodity_detail.js
const app = getApp();
const API = require('../../api/api.js');
const { formatDate, showToast, showLoading, hideLoading } = require('../../utils/util.js');
const { formatSkillPrice, formatRating } = require('../../utils/expert.js');
const imageView = require('../../utils/imageView.js');

Page({
  data: {
    commodity: null,
    timeText: '',
    isOwner: false,
    isFavorited: false,
    // 展示用图片列表：[{ id: 原始fileID, url: 可展示链接 }]
    images: [],
    // 每张图的加载态：loading | loaded | error（驱动骨架屏/淡入/占位）
    imgStates: [],
    // 技能服务
    skillPriceText: '',
    expertRatingText: '',
    reviewed: false
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
        // 图书专区：适用专业（数组）拼接为可展示文本
        commodity.majorText = Array.isArray(commodity.major)
          ? commodity.major.join('、')
          : (commodity.major || '');
        // 交易状态：可交易 / 已预定 / 已完成
        commodity.tradeStatus = commodity.tradeStatus || 'open';
        commodity.tradeStatusText = commodity.tradeStatus === 'matched'
          ? '已预定'
          : (commodity.tradeStatus === 'completed' ? '已完成' : '');

        const openid = wx.getStorageSync('openid');
        const isOwner = commodity._openid === openid;
        // 联系方式只走"复制"：微信号优先，未填微信号时用手机号兜底；页面不明文展示
        const hasWechat = !!commodity.sellerWechat;
        const hasPhone = !!commodity.sellerPhone;

        const ratingCount = commodity.expertRatingCount || 0;

        // 图片：优先使用本地缓存过的临时链接（命中则无需等云端解析），并初始化加载态
        const imageList = imageView.decorateImages(commodity.images, commodity.imageIds);
        this._imgRetried = {}; // 每张图只自动重试一次

        this.setData({
          commodity,
          images: imageList,
          imgStates: imageList.map(() => 'loading'),
          timeText: formatDate(commodity.createTime),
          isOwner,
          canCopyContact: !isOwner && (hasWechat || hasPhone),
          contactHint: hasWechat
            ? '点击「复制微信号」，打开微信搜索并添加对方'
            : (hasPhone ? '对方未填写微信号，可复制手机号联系' : '对方暂未完善联系方式'),
          // 技能服务：报价文案 + 达人评分
          skillPriceText: formatSkillPrice(commodity.price_unit, commodity.price),
          expertRatingText: formatRating(
            ratingCount > 0 ? (commodity.expertRatingAvg || 0) : 0,
            ratingCount
          )
        });

        if (!isOwner) this.checkReviewed();
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
    const images = (this.data.images || []).map(i => i.url).filter(Boolean);
    if (images.length === 0) return;
    // 预览用同一批链接：已加载过，预览可秒开
    wx.previewImage({
      current: url,
      urls: images
    });
  },

  // 图片加载完成：校验回调对应的确实是"当前该位置的地址"，避免快速切换时旧图回调覆盖新图状态
  onImgLoad(e) {
    const index = e.currentTarget.dataset.index;
    const src = e.currentTarget.dataset.src;
    const current = this.data.images[index];
    if (!current || current.url !== src) return; // 过期回调，丢弃
    if (this.data.imgStates[index] === 'loaded') return;
    this.setData({ ['imgStates[' + index + ']']: 'loaded' });
  },

  // 图片加载失败：多为临时链接过期 —— 按 fileID 重新解析并重试一次，仍失败才显示占位
  async onImgError(e) {
    const index = e.currentTarget.dataset.index;
    const current = this.data.images[index];
    if (!current) return;

    this._imgRetried = this._imgRetried || {};
    if (this._imgRetried[index]) {
      this.setData({ ['imgStates[' + index + ']']: 'error' });
      return;
    }
    this._imgRetried[index] = true;

    // 老数据没有 fileID：换不了新链接，退化成"重挂一次图片"再试一次
    if (!current.id) {
      this.setData({ ['imgStates[' + index + ']']: 'error' });
      setTimeout(() => {
        const latest = this.data.images[index];
        if (latest && latest.url === current.url && this.data.imgStates[index] === 'error') {
          this.setData({ ['imgStates[' + index + ']']: 'loading' });
        }
      }, 300);
      return;
    }

    try {
      const fresh = await imageView.refreshUrl(current.id);
      const latest = this.data.images[index];
      // 仅当该位置仍是同一条目时替换，避免覆盖已切换的图片
      if (fresh && latest && latest.id === current.id) {
        this.setData({
          ['images[' + index + '].url']: fresh,
          ['imgStates[' + index + ']']: 'loading'
        });
        return;
      }
    } catch (err) {
      console.warn('[详情页] 图片链接重新解析失败:', err);
    }
    this.setData({ ['imgStates[' + index + ']']: 'error' });
  },

  // 手动重试（点击占位图）
  async retryImage(e) {
    const index = e.currentTarget.dataset.index;
    const current = this.data.images[index];
    if (!current) return;

    this._imgRetried = this._imgRetried || {};
    this._imgRetried[index] = false;
    this.setData({ ['imgStates[' + index + ']']: 'loading' });

    if (!current.id) return;
    try {
      const fresh = await imageView.refreshUrl(current.id);
      const latest = this.data.images[index];
      if (fresh && latest && latest.id === current.id) {
        this.setData({ ['images[' + index + '].url']: fresh });
      }
    } catch (err) {
      // 失败后由 binderror 兜底显示占位
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
  },

  editCommodity() {
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release?mode=edit&id=' + this.commodityId });
  },

  // 复制联系方式：微信号优先，未填微信号时降级复制手机号；都没有则置灰提示
  async copyContact() {
    const c = this.data.commodity;
    if (!c || this.data.isOwner) return;

    const content = c.sellerWechat || c.sellerPhone || '';
    if (!content) {
      showToast('对方暂未完善联系方式');
      return;
    }

    // 轻量限流：同一用户每分钟最多 20 次（服务端强制，异常时降级放行）
    try {
      await API.checkContactAccess();
    } catch (err) {
      showToast(err.message || '操作过于频繁，请稍后再试');
      return;
    }

    wx.setClipboardData({
      data: String(content),
      success: () => {
        showToast('已复制，请打开微信粘贴搜索添加');
      },
      fail: () => {
        showToast('复制失败，请重试');
      }
    });
  },

  // 发布者标记交易状态：可交易 / 已预定 / 已完成
  changeTradeStatus(e) {
    const status = e.currentTarget.dataset.status;
    const c = this.data.commodity;
    if (!c || !status || c.tradeStatus === status) return;

    const labelMap = { open: '可交易', matched: '已预定', completed: '已完成' };
    wx.showModal({
      title: '变更交易状态',
      content: `确认将该信息标记为「${labelMap[status]}」？`,
      confirmText: '确定',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('处理中...');
        try {
          const apiRes = await API.setTradeStatus(c._id, status);
          hideLoading();
          if (apiRes.code === 0) {
            showToast(apiRes.msg || '已更新');
            await this.loadDetail();
          } else {
            showToast(apiRes.msg || '操作失败');
          }
        } catch (err) {
          hideLoading();
          showToast(err.message || '操作失败');
        }
      }
    });
  },

  shareTitle(c) {
    if (!c) return '校园闲置好物分享';
    if (c.type === 'want') {
      return `【求购】${c.title}，有闲置快联系我吧`;
    }
    if (c.type === 'exchange') {
      return `【以物易物】${c.title}，想换：${c.exchange_want || '面议'}`;
    }
    if (c.type === 'skill') {
      return `【技能服务】${c.title}｜${formatSkillPrice(c.price_unit, c.price)}`;
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
  },

  // ===== 技能：进入达人主页 =====
  goExpertHome() {
    const c = this.data.commodity;
    const openid = c && c.sellerOpenid;
    if (!openid) return;
    wx.navigateTo({ url: `/pages/expert_home/expert_home?openid=${openid}` });
  },

  // ===== 评价：我是否已评价过本条 =====
  async checkReviewed() {
    try {
      const res = await API.checkReviewed(this.commodityId);
      if (res.code === 0) {
        this.setData({ reviewed: !!(res.data && res.data.reviewed) });
      }
    } catch (err) {
      console.error('检查评价状态失败:', err);
    }
  },

  // ===== 评价：选星 + 填写内容 =====
  openReview() {
    const c = this.data.commodity;
    if (!c || this.data.isOwner) return;
    if (this.data.reviewed) {
      showToast('你已经评价过这条信息了');
      return;
    }

    wx.showActionSheet({
      itemList: ['5 星 · 非常满意', '4 星 · 满意', '3 星 · 一般', '2 星 · 不太满意', '1 星 · 差'],
      success: (sheetRes) => {
        const rating = 5 - sheetRes.tapIndex;
        wx.showModal({
          title: `评价（${rating}星）`,
          content: '说说这次合作体验（100字内）',
          editable: true,
          placeholderText: '如：讲解耐心、响应及时…',
          confirmText: '提交',
          success: async (m) => {
            if (!m.confirm) return;
            const comment = (m.content || '').trim();
            if (!comment) {
              showToast('请填写评价内容');
              return;
            }
            this.submitReview(rating, comment);
          }
        });
      }
    });
  },

  async submitReview(rating, comment) {
    const c = this.data.commodity;
    showLoading('提交中...');
    try {
      const res = await API.createReview({
        postId: this.commodityId,
        targetId: c.sellerOpenid || c._openid,
        rating,
        comment
      });
      hideLoading();
      if (res.code === 0) {
        showToast('评价成功');
        this.setData({ reviewed: true });
        await this.loadDetail();
      } else {
        showToast(res.msg || '评价失败');
      }
    } catch (err) {
      hideLoading();
      showToast(err.message || '评价失败，请重试');
    }
  }
});