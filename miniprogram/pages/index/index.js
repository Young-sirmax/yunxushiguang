// pages/index/index.js
const app = getApp();
const API = require('../../api/api.js');
const { isRegistrationComplete } = require('../../utils/userValidate.js');

Page({
  data: {
    agreed: false,
    universityName: ''
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo && userInfo.universityName) {
      this.setData({ universityName: userInfo.universityName });
    }
    if (isRegistrationComplete(userInfo)) {
      wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
    } else if (userInfo && userInfo._openid) {
      wx.redirectTo({ url: '/pages/index_register/index_register' });
    }
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  onUniversityInput(e) {
    this.setData({ universityName: e.detail.value });
  },

  async handleLogin() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先同意隐私政策', icon: 'none' });
      return;
    }

    const universityName = this.data.universityName.trim();
    if (!universityName) {
      wx.showToast({ title: '请填写学校名称', icon: 'none' });
      return;
    }

    if (this._logining) return;
    this._logining = true;
    wx.showLoading({ title: '登录中...', mask: true });

    try {
      const loginRes = await wx.login();
      if (!loginRes || !loginRes.code) {
        throw new Error('微信登录失败');
      }

      const res = await API.login();

      if (res.code === 0) {
        let userInfo = res.data;
        // 登录成功后保存自定义填写的学校
        if (universityName && universityName !== userInfo.universityName) {
          const updateRes = await API.updateUser({ universityName });
          if (updateRes.code === 0) {
            userInfo = updateRes.data;
          }
        }

        // 通过全局同步写入，保证 userInfo/openid 全局一致
        app.syncUserInfo(userInfo);

        wx.hideLoading();

        if (!isRegistrationComplete(userInfo)) {
          wx.redirectTo({ url: '/pages/index_register/index_register' });
        } else {
          wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
        }
      } else {
        throw new Error(res.msg || '登录失败');
      }
    } catch (err) {
      wx.hideLoading();
      console.error('登录失败:', err);
      wx.showToast({ title: err.message || '登录失败，请重试', icon: 'none' });
    } finally {
      this._logining = false;
    }
  },

  goBrowse() {
    wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  }
});