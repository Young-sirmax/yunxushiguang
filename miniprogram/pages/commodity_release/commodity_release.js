// pages/commodity_release/commodity_release.js
const app = getApp();
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');

const conditionOptions = ['全新', '99新', '9成新', '8成新', '7成新及以下'];

Page({
  data: {
    isEdit: false,
    commodityId: '',
    mode: 'sell',
    images: [],
    title: '',
    categoryList: [],
    selectedCategory: null,
    conditionOptions,
    condition: '',
    price: '',
    originalPrice: '',
    suggestedPrice: '',
    discountText: '',
    quantity: 1,
    tradeLocation: '',
    contact: '',
    description: '',
    canSubmit: false,
    isSubmitting: false
  },

  async onLoad(options) {
    // 打开右上角“转发给朋友 / 分享到朋友圈”
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    await this.loadCategoryList();
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({ contact: userInfo.contact || '' });

    // 支持通过 type=want / type=sell 直接定位发布模式（如从「我的求购」快速发布）
    if (options && options.type === 'want') {
      this.setData({ mode: 'want' });
    } else if (options && options.type === 'sell') {
      this.setData({ mode: 'sell' });
    }

    if (options && options.mode === 'edit' && options.id) {
      this.setData({ isEdit: true, commodityId: options.id });
      this.loadCommodityData(options.id);
    }
    this.checkCanSubmit();
  },

  onUnload() {
  },

  async loadCategoryList() {
    try {
      const res = await API.getCategoryList();
      if (res.code === 0) {
        this.setData({ categoryList: res.data || [] });
      }
    } catch (err) {
      console.error('获取分类失败:', err);
    }
  },

  async loadCommodityData(id) {
    showLoading('加载中...');
    try {
      const res = await API.getCommodityDetail(id);
      if (res.code === 0) {
        const c = res.data;
        this.setData({
          images: c.images || [],
          title: c.title,
          selectedCategory: this.data.categoryList.find(cat => cat._id === c.categoryId) || null,
          condition: c.condition,
          price: String(c.price),
          originalPrice: c.originalPrice ? String(c.originalPrice) : '',
          quantity: c.quantity || 1,
          tradeLocation: c.tradeLocation,
          contact: c.sellerContact || (wx.getStorageSync('userInfo') || {}).contact || '',
          description: c.description || '',
          mode: c.type === 'want' ? 'want' : 'sell'
        });
        this.calcSmartPrice();
        this.checkCanSubmit();
      }
    } catch (err) {
      showToast('加载失败');
    } finally {
      hideLoading();
    }
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ mode });
    this.checkCanSubmit();
  },

  chooseImage() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFiles = res.tempFiles.map(f => f.tempFilePath);
        this.setData({ images: this.data.images.concat(tempFiles) });
        this.checkCanSubmit();
      }
    });
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.filter((_, i) => i !== index);
    this.setData({ images });
    this.checkCanSubmit();
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index;
    wx.previewImage({
      current: this.data.images[index],
      urls: this.data.images
    });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
    this.checkCanSubmit();
  },

  onCategoryChange(e) {
    const index = e.detail.value;
    this.setData({ selectedCategory: this.data.categoryList[index] });
    this.checkCanSubmit();
    this.calcSmartPrice();
  },

  onConditionTap(e) {
    this.setData({ condition: e.currentTarget.dataset.value });
    this.checkCanSubmit();
    this.calcSmartPrice();
  },

  onPriceInput(e) {
    const price = e.detail.value;
    this.setData({ price });
    this.calcDiscount();
    this.checkCanSubmit();
  },

  onOriginalPriceInput(e) {
    const originalPrice = e.detail.value;
    this.setData({ originalPrice });
    this.calcSmartPrice();
    this.calcDiscount();
  },

  onQuantityInput(e) {
    let val = parseInt(e.detail.value) || 1;
    if (val < 1) val = 1;
    this.setData({ quantity: val });
  },

  increaseQty() {
    this.setData({ quantity: this.data.quantity + 1 });
  },

  decreaseQty() {
    if (this.data.quantity > 1) {
      this.setData({ quantity: this.data.quantity - 1 });
    }
  },

  onLocationInput(e) {
    this.setData({ tradeLocation: e.detail.value });
    this.checkCanSubmit();
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value });
    this.checkCanSubmit();
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value });
  },

  appendDesc(e) {
    const text = e.currentTarget.dataset.text;
    const current = this.data.description;
    const separator = current && !current.endsWith('\n') && current.length > 0 ? '\n' : '';
    this.setData({ description: current + separator + text });
  },

  calcDiscount() {
    const { price, originalPrice } = this.data;
    if (!price || !originalPrice) {
      this.setData({ discountText: '' });
      return;
    }
    const p = parseFloat(price);
    const op = parseFloat(originalPrice);
    if (!p || !op || p <= 0 || op <= 0) {
      this.setData({ discountText: '' });
      return;
    }
    const discount = (p / op * 10).toFixed(1);
    this.setData({ discountText: discount });
  },

  calcSmartPrice() {
    const { originalPrice, condition } = this.data;
    if (!originalPrice || !condition) {
      this.setData({ suggestedPrice: '' });
      return;
    }
    const op = parseFloat(originalPrice);
    if (isNaN(op) || op <= 0) return;

    const rates = { '全新': 0.85, '99新': 0.75, '9成新': 0.6, '8成新': 0.45, '7成新及以下': 0.35 };
    const rate = rates[condition] || 0.5;
    const suggested = Math.round(op * rate);
    this.setData({ suggestedPrice: suggested > 0 ? String(suggested) : '' });
  },

  checkCanSubmit() {
    const { mode, images, title, selectedCategory, condition, price, tradeLocation, contact, description } = this.data;
    const hasAny = images.length > 0
      || title.trim()
      || (selectedCategory && selectedCategory.name)
      || condition
      || (mode === 'sell' && parseFloat(price) > 0)
      || tradeLocation.trim()
      || contact.trim()
      || description.trim();
    this.setData({ canSubmit: hasAny });
  },

  async uploadImages() {
    const { images } = this.data;
    const uploadedUrls = [];

    for (let i = 0; i < images.length; i++) {
      const path = images[i];
      if (path.startsWith('cloud://') || path.startsWith('http')) {
        uploadedUrls.push(path);
        continue;
      }
      try {
        const res = await wx.cloud.uploadFile({
          cloudPath: `commodity/${Date.now()}_${i}.jpg`,
          filePath: path
        });
        uploadedUrls.push(res.fileID);
      } catch (err) {
        console.error('上传图片失败:', err);
      }
    }
    return uploadedUrls;
  },

  async submitForm() {
    if (!this.data.canSubmit || this.data.isSubmitting || this._submitLock) return;

    this._submitLock = true;
    this.setData({ isSubmitting: true });
    showLoading(this.data.isEdit ? '保存中...' : '发布中...');

    try {
      const imageUrls = await this.uploadImages();
      const userInfo = wx.getStorageSync('userInfo');
      const { mode } = this.data;

      const data = {
        title: this.data.title.trim(),
        categoryId: this.data.selectedCategory ? this.data.selectedCategory._id : '',
        categoryName: this.data.selectedCategory ? this.data.selectedCategory.name : '',
        condition: this.data.condition,
        price: mode === 'sell' ? parseFloat(this.data.price) || 0 : 0,
        originalPrice: this.data.originalPrice ? parseFloat(this.data.originalPrice) : 0,
        quantity: parseInt(this.data.quantity) || 1,
        tradeLocation: this.data.tradeLocation,
        description: this.data.description.trim(),
        images: imageUrls,
        sellerName: userInfo.nickName,
        sellerAvatar: userInfo.avatarUrl,
        sellerContact: this.data.contact.trim(),
        universityId: userInfo.universityId,
        universityName: userInfo.universityName,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: mode
      };

      let res;
      if (this.data.isEdit) {
        res = await API.updateCommodity(this.data.commodityId, data);
      } else {
        res = await API.createCommodity(data);
      }

      hideLoading();
      this.setData({ isSubmitting: false });

      if (res.code === 0) {
        const successMsg = this.data.isEdit
          ? '修改成功，等待管理员审核'
          : '发布成功，等待管理员审核';
        showToast(successMsg);
        setTimeout(() => {
          this._submitLock = false;
          wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
        }, 1500);
      } else {
        this._submitLock = false;
        showToast(res.msg || '操作失败');
      }
    } catch (err) {
      hideLoading();
      this.setData({ isSubmitting: false });
      this._submitLock = false;
      showToast('操作失败，请重试');
      console.error(err);
    }
  },

  onShareAppMessage() {
    return {
      title: '云叙石光 · 免费发布闲置 / 求购，快到校园圈子里看看吧',
      path: '/pages/commodity_list/commodity_list'
    };
  },

  onShareTimeline() {
    return { title: '云叙石光 · 校园物品信息服务平台', query: '' };
  }
});