// pages/index_register/index_register.js
const app = getApp();
const API = require('../../api/api.js');
const { validateContact } = require('../../utils/userValidate.js');

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    contact: '',
    contactError: '',
    agreed: false,
    canSubmit: false,
    isSubmitting: false
  },

  // 微信官方头像选择能力（open-type="chooseAvatar"）
  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (!url) {
      wx.showToast({ title: '未获取到头像，请重试', icon: 'none' });
      return;
    }
    this.setData({ avatarUrl: url });
    wx.showToast({ title: '头像已选择', icon: 'none' });
  },

  onNickNameInput(e) {
    this.setData({ nickName: e.detail.value });
  },

  onContactInput(e) {
    const value = e.detail.value.slice(0, 30);
    let contactError = '';
    if (value.length > 0 && !validateContact(value).valid) {
      contactError = validateContact(value).error;
    }
    this.setData({ contact: value, contactError });
    this.checkCanSubmit();
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
    this.checkCanSubmit();
  },

  checkCanSubmit() {
    const { contact, agreed, contactError } = this.data;
    const canSubmit = validateContact(contact).valid && agreed && !contactError;
    this.setData({ canSubmit });
  },

  async handleRegister() {
    if (!this.data.canSubmit || this.data.isSubmitting) return;

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '注册中...', mask: true });

    try {
      let avatarUrl = this.data.avatarUrl;

      if (avatarUrl) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`,
          filePath: avatarUrl
        });
        avatarUrl = uploadRes.fileID;
      }

      const res = await API.updateUser({
        avatarUrl,
        nickName: this.data.nickName.trim(),
        contact: this.data.contact.trim()
      });

      if (res.code === 0) {
        // 通过全局同步写入，保证 userInfo/openid 全局一致
        app.syncUserInfo(res.data);
        wx.hideLoading();
        wx.showToast({ title: '注册成功', icon: 'success' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
        }, 1500);
      } else {
        throw new Error(res.msg || '注册失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '注册失败', icon: 'none' });
    } finally {
      this.setData({ isSubmitting: false });
    }
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  }
});