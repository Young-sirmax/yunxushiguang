// pages/index_register/index_register.js
const app = getApp();
const API = require('../../api/api.js');
const { validatePhone, validateWechatId } = require('../../utils/userValidate.js');
const { uploadAvatar } = require('../../utils/avatar.js');

Page({
  data: {
    avatarUrl: '',
    nickName: '',
    // 手机号：仅用于账号找回，不对外展示
    phone: '',
    phoneError: '',
    // 微信号：对外展示、供交易对方复制
    wechatId: '',
    wechatIdError: '',
    wechatConfirm: '',
    wechatConfirmError: '',
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

  onPhoneInput(e) {
    const value = e.detail.value.replace(/\D/g, '').slice(0, 11);
    let phoneError = '';
    if (value.length > 0 && !validatePhone(value).valid) {
      phoneError = validatePhone(value).error;
    }
    this.setData({ phone: value, phoneError });
    this.checkCanSubmit();
  },

  onWechatInput(e) {
    const value = (e.detail.value || '').trim();
    let wechatIdError = '';
    if (value.length > 0 && !validateWechatId(value).valid) {
      wechatIdError = validateWechatId(value).error;
    }
    this.setData({ wechatId: value, wechatIdError });
    this.checkWechatConfirm(value, this.data.wechatConfirm);
    this.checkCanSubmit();
  },

  onWechatConfirmInput(e) {
    const value = (e.detail.value || '').trim();
    this.setData({ wechatConfirm: value });
    this.checkWechatConfirm(this.data.wechatId, value);
    this.checkCanSubmit();
  },

  // 两次输入不一致则提示
  checkWechatConfirm(wechatId, confirm) {
    let wechatConfirmError = '';
    if (confirm && wechatId !== confirm) {
      wechatConfirmError = '两次输入的微信号不一致';
    }
    this.setData({ wechatConfirmError });
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
    this.checkCanSubmit();
  },

  checkCanSubmit() {
    const { phone, wechatId, wechatConfirm, agreed, phoneError, wechatIdError } = this.data;
    const canSubmit = !!(
      validatePhone(phone).valid
      && validateWechatId(wechatId).valid
      && wechatId === wechatConfirm
      && agreed
      && !phoneError
      && !wechatIdError
    );
    this.setData({ canSubmit });
  },

  async handleRegister() {
    if (!this.data.canSubmit || this.data.isSubmitting) return;

    const wechatId = this.data.wechatId.trim();
    if (wechatId !== this.data.wechatConfirm.trim()) {
      wx.showToast({ title: '两次输入的微信号不一致', icon: 'none' });
      return;
    }

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '注册中...', mask: true });

    try {
      const payload = {
        nickName: this.data.nickName.trim(),
        phone: this.data.phone.trim(),
        wechat_id: wechatId
      };

      // 仅在用户确实选择了头像时才上传并写入 avatarUrl。
      // 未选头像时不提交该字段，避免用空值覆盖掉云端已存在的头像。
      // 上传走 utils/avatar.js 的统一链路，与个人信息页/我的页保持一致
      const localAvatar = this.data.avatarUrl;
      if (localAvatar && localAvatar.indexOf('cloud://') !== 0) {
        try {
          payload.avatarUrl = await uploadAvatar(localAvatar);
        } catch (uploadErr) {
          console.error('头像上传失败:', uploadErr);
          wx.hideLoading();
          wx.showToast({ title: '头像上传失败，请重试或先不选头像', icon: 'none' });
          return;
        }
      }

      const res = await API.updateUser(payload);

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
