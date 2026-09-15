// pages/home_user_info/home_user_info.js
const app = getApp();
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');
const { validateStudentId, validateContact } = require('../../utils/userValidate.js');

Page({
  data: {
    userInfo: {},
    avatarChanged: false,
    contactError: '',
    canSave: true,

    universityList: [],
    selectedUniversity: null,
    verifyRealName: '',
    verifyStudentId: '',
    studentIdError: '',
    verifyImage: '',
    canSubmitVerify: false,
    isSubmitting: false
  },

  async onLoad() {
    try {
      const res = await API.getUniversityList();
      if (res.code === 0) {
        const list = res.data || [];
        this.setData({ universityList: list });
        this.syncUniversitySelection(wx.getStorageSync('userInfo') || {});
      }
    } catch (err) {
      console.error('获取学校列表失败:', err);
    }
  },

  async onShow() {
    // 先用本地缓存快速渲染，保证首屏流畅
    const cached = wx.getStorageSync('userInfo') || {};
    this.applyUserInfo(cached);
    // 从云端拉取最新用户信息（含认证状态），保证认证状态全局一致
    const fresh = await app.refreshUserInfo();
    if (fresh) {
      this.applyUserInfo(fresh);
      this.syncUniversitySelection(fresh);
    }
  },

  // 统一应用用户信息到页面数据
  applyUserInfo(userInfo) {
    const contact = (userInfo && userInfo.contact) || '';
    this.setData({
      userInfo: userInfo || {},
      canSave: contact.trim().length >= 4
    });
  },

  // 根据用户已选学校定位选择器
  syncUniversitySelection(userInfo) {
    const { universityList } = this.data;
    if (!userInfo || !userInfo.universityId || !universityList.length) return;
    const selectedUniversity = universityList.find(u => u._id === userInfo.universityId) || null;
    this.setData({ selectedUniversity });
  },

  // 微信官方头像选择能力（open-type="chooseAvatar"）
  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (!url) {
      showToast('未获取到头像，请重试');
      return;
    }
    this.setData({
      'userInfo.avatarUrl': url,
      avatarChanged: true
    });
    showToast('头像已选好，请点下方“保存”生效');
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
    const { userInfo, avatarChanged, contactError } = this.data;
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

      const res = await API.updateUser(updateData);
      if (res.code === 0) {
        // 全局同步最新用户信息（storage + globalData）
        app.syncUserInfo(res.data);
        showToast('保存成功');
        wx.navigateBack();
      }
    } catch (err) {
      showToast(err.message || '保存失败');
    }
  },

  onUniversityChange(e) {
    const index = e.detail.value;
    const selectedUniversity = this.data.universityList[index];
    this.setData({ selectedUniversity });
    this.checkCanSubmitVerify();
  },

  onVerifyRealName(e) {
    this.setData({ verifyRealName: e.detail.value });
    this.checkCanSubmitVerify();
  },

  onVerifyStudentId(e) {
    // 只过滤非数字并截断；输入过程中不实时报错，保证随时可自由编辑、重填
    const value = e.detail.value.replace(/\D/g, '').slice(0, 10);
    this.setData({ verifyStudentId: value, studentIdError: '' });
    this.checkCanSubmitVerify();
  },

  checkCanSubmitVerify() {
    const { selectedUniversity, verifyRealName, verifyStudentId, verifyImage } = this.data;
    // 学号填满 10 位数字即可点亮提交按钮；年份等格式细节在提交时统一校验提示，
    // 避免输入中途误报错导致用户以为无法修改/重填
    const sidLengthOk = /^\d{10}$/.test(verifyStudentId);
    const canSubmitVerify = !!(selectedUniversity && verifyRealName.trim() && sidLengthOk && verifyImage);
    this.setData({ canSubmitVerify });
  },

  chooseVerifyImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath;
        this.setData({ verifyImage: path });
        this.checkCanSubmitVerify();
      }
    });
  },

  previewVerifyImage() {
    if (!this.data.verifyImage) return;
    wx.previewImage({ urls: [this.data.verifyImage] });
  },

  deleteVerifyImage() {
    this.setData({ verifyImage: '' });
    this.checkCanSubmitVerify();
  },

  async submitVerify() {
    const { userInfo } = this.data;
    // 已认证或审核中无需重复操作，认证状态全平台生效
    if (userInfo.isStudentVerified) {
      showToast('已认证，无需重复认证');
      return;
    }
    if (userInfo.studentVerifyStatus === 'pending') {
      showToast('认证审核中，请勿重复提交');
      return;
    }
    if (!this.data.canSubmitVerify || this.data.isSubmitting) return;
    const { selectedUniversity, verifyRealName, verifyStudentId, verifyImage } = this.data;

    // 提交前统一做格式校验（如入学年份不在 2000-2099 等），错误实时显示在输入框下方
    const sidCheck = validateStudentId(verifyStudentId);
    if (!sidCheck.valid) {
      this.setData({ studentIdError: sidCheck.error });
      showToast(sidCheck.error);
      return;
    }

    this.setData({ isSubmitting: true });
    showLoading('提交中...');

    try {
      let imageUrl = verifyImage;
      if (imageUrl && !imageUrl.startsWith('cloud://')) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `verify/${Date.now()}.jpg`,
          filePath: imageUrl
        });
        imageUrl = uploadRes.fileID;
      }

      const res = await API.verifyStudent({
        universityId: selectedUniversity._id || selectedUniversity.uid,
        universityName: selectedUniversity.name,
        realName: verifyRealName.trim(),
        studentId: verifyStudentId.trim(),
        studentVerifyImage: imageUrl
      });

      if (res.code !== 0) {
        throw new Error(res.msg || '提交失败');
      }

      // 兜底：即使云端返回数据不完整，也确保前端立即切换为"审核中"状态，按钮随之消失
      const fresh = res.data || {};
      const pendingUserInfo = {
        ...(fresh._openid ? fresh : this.data.userInfo),
        isStudentVerified: false,
        studentVerifyStatus: 'pending',
        universityId: fresh.universityId || selectedUniversity._id || selectedUniversity.uid,
        universityName: fresh.universityName || selectedUniversity.name,
        realName: fresh.realName || verifyRealName.trim(),
        studentId: fresh.studentId || verifyStudentId.trim(),
        studentVerifyTime: fresh.studentVerifyTime || new Date()
      };
      // 全局同步最新认证状态（storage + globalData），一次认证全平台生效
      app.syncUserInfo(pendingUserInfo);
      // 清空临时表单，提交按钮随状态切换消失
      this.setData({
        userInfo: pendingUserInfo,
        selectedUniversity: null,
        verifyRealName: '',
        verifyStudentId: '',
        studentIdError: '',
        verifyImage: '',
        canSubmitVerify: false,
        isSubmitting: false
      });
      // 注意顺序：先关闭 loading 再弹 toast，避免 toast 被 hideLoading 一起关闭
      hideLoading();
      showToast('认证提交成功，等待审核');
    } catch (err) {
      // 注意顺序：先关闭 loading 再弹 toast
      hideLoading();
      showToast(err.message || '提交失败，请重试');
      this.setData({ isSubmitting: false });
    }
  }
});
