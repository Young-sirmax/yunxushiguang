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
    isSubmitting: false,

    needVerify: false,
    isVerified: false,
    verifyImage: '',
    verifyStatus: '',

    privilegeOptions: [
      { id: 'multiImg', name: '多图权限', price: 1, desc: '突破3张图限制，可发9张图+1个视频', checked: false },
      { id: 'urgent', name: '急出标签', price: 2, desc: '帖子角标变红，触发一次社群广播', checked: false },
      { id: 'top', name: '置顶展示', price: 3, desc: '固定在分类信息流顶部，24小时', checked: false },
      { id: 'precision', name: '精准推送', price: 5, desc: '手动推送到3个垂直社群', checked: false }
    ],
    selectedPrivileges: [],
    totalPrivilegeCost: 0,

    rewardAmount: 0
  },

  async onLoad(options) {
    await this.loadCategoryList();
    const userInfo = wx.getStorageSync('userInfo') || {};
    this.setData({ contact: userInfo.contact || '' });

    const savedMode = wx.getStorageSync('releaseMode') || 'sell';
    const savedNeedVerify = wx.getStorageSync('needVerify') || false;
    const savedIsVerified = wx.getStorageSync('isVerified') || false;
    this.setData({
      mode: savedMode,
      needVerify: savedNeedVerify,
      isVerified: savedIsVerified
    });

    if (options.mode === 'edit' && options.id) {
      this.setData({ isEdit: true, commodityId: options.id });
      this.loadCommodityData(options.id);
    }
    this.checkCanSubmit();
  },

  onUnload() {
    wx.removeStorageSync('releaseMode');
    wx.removeStorageSync('needVerify');
    wx.removeStorageSync('isVerified');
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

  toggleVerify(e) {
    const needVerify = e.detail.value;
    this.setData({ needVerify });
    wx.setStorageSync('needVerify', needVerify);
    if (!needVerify) {
      this.setData({ verifyImage: '', verifyStatus: '' });
    }
  },

  chooseVerifyImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath;
        this.setData({
          verifyImage: path,
          verifyStatus: 'pending'
        });
        wx.setStorageSync('isVerified', false);
        this.uploadVerifyImage(path);
      }
    });
  },

  async uploadVerifyImage(path) {
    try {
      const res = await wx.cloud.uploadFile({
        cloudPath: `verify/${Date.now()}.jpg`,
        filePath: path
      });
      this.setData({ verifyImage: res.fileID });
      setTimeout(() => {
        this.setData({ verifyStatus: 'approved', isVerified: true });
        wx.setStorageSync('isVerified', true);
      }, 2000);
    } catch (err) {
      console.error('上传证件失败:', err);
      showToast('证件上传失败，请重试');
      this.setData({ verifyImage: '', verifyStatus: '' });
    }
  },

  previewVerifyImage() {
    if (!this.data.verifyImage) return;
    wx.previewImage({
      urls: [this.data.verifyImage]
    });
  },

  deleteVerifyImage() {
    this.setData({ verifyImage: '', verifyStatus: '', isVerified: false });
    wx.setStorageSync('isVerified', false);
  },

  togglePrivilege(e) {
    const id = e.currentTarget.dataset.id;
    const options = this.data.privilegeOptions.map(item => {
      if (item.id === id) {
        return { ...item, checked: !item.checked };
      }
      return item;
    });
    const selectedPrivileges = options.filter(i => i.checked);
    const totalPrivilegeCost = selectedPrivileges.reduce((sum, i) => sum + i.price, 0);
    this.setData({
      privilegeOptions: options,
      selectedPrivileges: selectedPrivileges.map(i => i.id),
      totalPrivilegeCost
    });
  },

  setReward(e) {
    const value = parseInt(e.currentTarget.dataset.value);
    this.setData({ rewardAmount: value });
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

  onConditionChange(e) {
    this.setData({ condition: this.data.conditionOptions[e.detail.value] });
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
      const { mode, rewardAmount, selectedPrivileges, needVerify, isVerified } = this.data;

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
        sellerPayCode: userInfo.payCodeUrl || '',
        universityId: userInfo.universityId,
        universityName: userInfo.universityName,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: mode,
        needVerify,
        isVerified,
        verifyImage: this.data.verifyImage || '',
        privileges: selectedPrivileges,
        privilegeCost: this.data.totalPrivilegeCost,
        rewardAmount: mode === 'want' ? rewardAmount : 0,
        wantFee: mode === 'want' ? (rewardAmount > 0 ? 0 : 1) : 0
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
        const successMsg = mode === 'want'
          ? (rewardAmount > 0 ? '求购悬赏发布成功' : '求购信息发布成功')
          : (this.data.isEdit ? '修改成功' : '发布成功');
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
  }
});