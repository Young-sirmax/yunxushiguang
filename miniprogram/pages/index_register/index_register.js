// pages/index_register/index_register.js
const app = getApp();
const API = require('../../api/api.js');
const { validateStudentId, validateContact } = require('../../utils/userValidate.js');

Page({
  data: {
    universityList: [],
    selectedUniversity: null,
    avatarUrl: '',
    realName: '',
    studentId: '',
    studentIdError: '',
    nickName: '',
    contact: '',
    contactError: '',
    agreed: false,
    canSubmit: false,
    isSubmitting: false
  },

  async onLoad() {
    try {
      const res = await API.getUniversityList();
      if (res.code === 0) {
        this.setData({ universityList: res.data || [] });
      }
    } catch (err) {
      console.error('获取学校列表失败:', err);
    }
  },

  chooseAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ avatarUrl: res.tempFilePaths[0] });
        this.checkCanSubmit();
      },
      fail: () => {
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      }
    });
  },

  onUniversityChange(e) {
    const index = e.detail.value;
    this.setData({ selectedUniversity: this.data.universityList[index] });
    this.checkCanSubmit();
  },

  onRealNameInput(e) {
    this.setData({ realName: e.detail.value });
    this.checkCanSubmit();
  },

  onStudentIdInput(e) {
    const value = e.detail.value.replace(/\D/g, '').slice(0, 10);
    const { error } = validateStudentId(value);
    let studentIdError = '';
    if (value.length > 0 && !validateStudentId(value).valid) {
      studentIdError = error;
    }
    this.setData({ studentId: value, studentIdError });
    this.checkCanSubmit();
  },

  onNickNameInput(e) {
    this.setData({ nickName: e.detail.value });
    this.checkCanSubmit();
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
    const { selectedUniversity, realName, studentId, contact, agreed, studentIdError, contactError } = this.data;
    const canSubmit = selectedUniversity &&
                      realName.trim() &&
                      validateStudentId(studentId).valid &&
                      validateContact(contact).valid &&
                      agreed &&
                      !studentIdError &&
                      !contactError;
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
        universityId: this.data.selectedUniversity._id || this.data.selectedUniversity.uid,
        universityName: this.data.selectedUniversity.name,
        realName: this.data.realName.trim(),
        studentId: this.data.studentId.trim(),
        nickName: this.data.nickName.trim() || this.data.realName.trim(),
        contact: this.data.contact.trim()
      });

      if (res.code === 0) {
        wx.setStorageSync('userInfo', res.data);
        app.globalData.userInfo = res.data;
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
