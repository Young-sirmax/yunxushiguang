// pages/home_user_info/home_user_info.js
const API = require('../../api/api.js');
const { showToast } = require('../../utils/util.js');

Page({
  data: {
    userInfo: {},
    avatarChanged: false,
    payCodeChanged: false,
    contactError: '',
    canSave: true
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    const contact = userInfo.contact || '';
    this.setData({
      userInfo,
      canSave: contact.trim().length >= 4
    });
  },

  chooseAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({
          'userInfo.avatarUrl': res.tempFilePaths[0],
          avatarChanged: true
        });
      },
      fail: () => {
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      }
    });
  },

  choosePayCode() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({
          'userInfo.payCodeUrl': res.tempFiles[0].tempFilePath,
          payCodeChanged: true
        });
      },
      fail: () => {
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      }
    });
  },

  previewPayCode() {
    const url = this.data.userInfo.payCodeUrl;
    if (!url) return;
    wx.previewImage({
      current: url,
      urls: [url]
    });
  },

  removePayCode() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除收款码吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            'userInfo.payCodeUrl': '',
            payCodeChanged: true
          });
        }
      }
    });
  },

  onNickName(e) {
    this.setData({ 'userInfo.nickName': e.detail.value });
  },

  onContact(e) {
    const value = e.detail.value.slice(0, 30);
    let contactError = '';
    if (value.length > 0 && value.trim().length < 4) {
      contactError = '请输入完整的微信号或手机号';
    }
    this.setData({
      'userInfo.contact': value,
      contactError,
      canSave: !contactError && value.trim().length >= 4
    });
  },

  async save() {
    const { userInfo, avatarChanged, payCodeChanged, contactError } = this.data;
    const contact = (userInfo.contact || '').trim();
    if (contactError || contact.length < 4) {
      showToast('请填写正确的微信号或手机号');
      return;
    }
    if (!userInfo.nickName || !userInfo.nickName.trim()) {
      showToast('请填写昵称');
      return;
    }

    try {
      const updateData = {
        nickName: userInfo.nickName.trim(),
        contact: contact
      };

      if (avatarChanged && userInfo.avatarUrl && userInfo.avatarUrl.indexOf('cloud://') !== 0) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`,
          filePath: userInfo.avatarUrl
        });
        updateData.avatarUrl = uploadRes.fileID;
      }

      if (payCodeChanged) {
        if (userInfo.payCodeUrl && userInfo.payCodeUrl.indexOf('cloud://') !== 0) {
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath: `paycodes/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`,
            filePath: userInfo.payCodeUrl
          });
          updateData.payCodeUrl = uploadRes.fileID;
        } else {
          updateData.payCodeUrl = userInfo.payCodeUrl || '';
        }
      }

      const res = await API.updateUser(updateData);
      if (res.code === 0) {
        wx.setStorageSync('userInfo', res.data);
        showToast('保存成功');
        wx.navigateBack();
      }
    } catch (err) {
      showToast(err.message || '保存失败');
    }
  }
});