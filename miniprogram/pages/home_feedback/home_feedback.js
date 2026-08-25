// pages/home_feedback/home_feedback.js
const API = require('../../api/api.js');
const { showToast, formatDate } = require('../../utils/util.js');

Page({
  data: {
    typeOptions: [
      { value: 'bug', icon: '🐛', name: '功能异常' },
      { value: 'suggestion', icon: '💡', name: '建议反馈' },
      { value: 'experience', icon: '✨', name: '体验问题' },
      { value: 'other', icon: '📝', name: '其他' }
    ],
    currentType: 'bug',
    content: '',
    maxLength: 500,
    contact: '',
    images: [],
    canSubmit: false,
    isSubmitting: false,
    historyList: []
  },

  onShow() {
    this.loadHistory();
  },

  async loadHistory() {
    try {
      const res = await API.getFeedbackList({ page: 1, pageSize: 20 });
      if (res.code === 0) {
        const list = (res.data || []).map(item => ({
          ...item,
          typeName: this.getTypeName(item.type),
          statusText: this.getStatusText(item.status),
          timeText: formatDate(item.createTime)
        }));
        this.setData({ historyList: list });
      }
    } catch (err) {
      console.error('加载反馈历史失败:', err);
    }
  },

  getTypeName(type) {
    const map = { bug: '功能异常', suggestion: '建议反馈', experience: '体验问题', other: '其他' };
    return map[type] || '其他';
  },

  getStatusText(status) {
    const map = { pending: '待处理', processing: '处理中', resolved: '已解决', rejected: '已关闭' };
    return map[status] || '待处理';
  },

  onTypeChange(e) {
    this.setData({ currentType: e.currentTarget.dataset.value });
    this.checkCanSubmit();
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
    this.checkCanSubmit();
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value });
  },

  checkCanSubmit() {
    const { content } = this.data;
    this.setData({ canSubmit: content.trim().length >= 5 });
  },

  chooseImage() {
    const remain = 3 - this.data.images.length;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFiles = res.tempFiles.map(f => f.tempFilePath);
        this.setData({ images: this.data.images.concat(tempFiles) });
      }
    });
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.filter((_, i) => i !== index);
    this.setData({ images });
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index;
    wx.previewImage({
      current: this.data.images[index],
      urls: this.data.images
    });
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
          cloudPath: `feedback/${Date.now()}_${i}.jpg`,
          filePath: path
        });
        uploadedUrls.push(res.fileID);
      } catch (err) {
        console.error('上传图片失败:', err);
      }
    }
    return uploadedUrls;
  },

  async submitFeedback() {
    if (!this.data.canSubmit || this.data.isSubmitting || this._submitLock) return;

    this._submitLock = true;
    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '提交中...', mask: true });

    try {
      const imageUrls = await this.uploadImages();
      const userInfo = wx.getStorageSync('userInfo');

      const res = await API.createFeedback({
        type: this.data.currentType,
        content: this.data.content.trim(),
        contact: this.data.contact.trim(),
        images: imageUrls,
        userName: userInfo.nickName || ''
      });

      wx.hideLoading();
      this.setData({ isSubmitting: false });

      if (res.code === 0) {
        showToast('反馈提交成功');
        this.setData({
          content: '',
          contact: '',
          images: [],
          currentType: 'bug'
        });
        this._submitLock = false;
        this.checkCanSubmit();
        this.loadHistory();
      } else {
        this._submitLock = false;
        showToast(res.msg || '提交失败');
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ isSubmitting: false });
      this._submitLock = false;
      const errMsg = (err && err.message) ? err.message : '提交失败，请重试';
      showToast(errMsg);
      console.error('反馈提交失败:', err);
    }
  },

  async onUrge(e) {
    const id = e.currentTarget.dataset.id;
    const index = e.currentTarget.dataset.index;
    
    wx.showLoading({ title: '催促中...', mask: true });
    
    try {
      const res = await API.urgeFeedback(id);
      wx.hideLoading();
      
      if (res.code === 0) {
        showToast('已催，客服会尽快处理');
        const list = this.data.historyList;
        if (list[index]) {
          list[index].urgeCount = res.data.urgeCount;
          this.setData({ historyList: list });
        }
      } else {
        showToast(res.msg || '操作失败');
      }
    } catch (err) {
      wx.hideLoading();
      const errMsg = (err && err.message) ? err.message : '操作失败，请重试';
      showToast(errMsg);
      console.error('催一催失败:', err);
    }
  }
});
