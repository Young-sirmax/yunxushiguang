// pages/home_user_info/home_user_info.js
const app = getApp();
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');
const { avatarView, uploadAvatar } = require('../../utils/avatar.js');
const { validateStudentId, validatePhone, validateWechatId } = require('../../utils/userValidate.js');

Page({
  data: {
    userInfo: {},
    avatar: { useImage: false, src: '', letter: '👤', color: '' },
    avatarUploading: false,
    phoneError: '',
    wechatIdError: '',
    wechatConfirm: '',
    wechatConfirmError: '',
    wechatDirty: false, // 是否正在修改微信号（改动后才要求二次确认）
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

  // 统一应用用户信息到页面数据（头像同时算出展示态：fileID 或字母兜底）
  applyUserInfo(userInfo) {
    const u = userInfo || {};
    // 上传中的本地预览优先级更高，避免云端旧数据把刚选的头像冲掉
    const patch = {
      userInfo: u,
      canSave: this.canSaveWith(u)
    };
    if (!this.data.avatarUploading) patch.avatar = avatarView(u);
    this.setData(patch);
  },

  // 保存按钮可用性：微信号必填且合法；手机号选填但填了必须合法
  canSaveWith(userInfo) {
    if (!validateWechatId(userInfo.wechat_id).valid) return false;
    const phone = (userInfo.phone || '').trim();
    if (phone && !validatePhone(phone).valid) return false;
    const { wechatDirty, wechatConfirm } = this.data;
    if (wechatDirty && wechatConfirm !== (userInfo.wechat_id || '').trim()) return false;
    return true;
  },

  // 微信号改动后要求二次确认
  refreshWechatConfirmState() {
    const wechatId = (this.data.userInfo.wechat_id || '').trim();
    const confirm = (this.data.wechatConfirm || '').trim();
    let wechatConfirmError = '';
    if (this.data.wechatDirty && confirm && confirm !== wechatId) {
      wechatConfirmError = '两次输入的微信号不一致';
    }
    this.setData({
      wechatConfirmError,
      canSave: this.canSaveWith(this.data.userInfo)
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
  // 选完立即上传云存储并落库，不再依赖下方“保存”按钮（该按钮受微信号必填约束，常常是灰的）
  async onChooseAvatar(e) {
    // 防并发：上传中重复触发直接忽略（按钮同时被 disabled，双保险）
    if (this.data.avatarUploading) return;

    const tempPath = e.detail && e.detail.avatarUrl;
    // 用户取消选择时回调不带 avatarUrl，静默返回，不打断操作
    if (!tempPath) return;

    // 先本地预览，交互零延迟
    this.setData({
      avatarUploading: true,
      avatar: { useImage: true, src: tempPath, letter: '', color: '' }
    });
    showLoading('头像上传中...');

    try {
      const fileID = await uploadAvatar(tempPath);
      const res = await API.updateUser({ avatarUrl: fileID });
      if (!res || res.code !== 0) {
        throw new Error((res && res.msg) || '头像保存失败');
      }
      // 全局同步（storage + globalData），“我的”页与其他页面立即一致
      app.syncUserInfo(res.data);
      hideLoading();
      this.setData({ userInfo: res.data, avatar: avatarView(res.data), avatarUploading: false });
      showToast('头像已更新');
    } catch (err) {
      console.error('头像更新失败:', err);
      hideLoading();
      // 失败保持原头像，不阻塞其他功能
      const original = wx.getStorageSync('userInfo') || {};
      this.setData({ userInfo: original, avatar: avatarView(original), avatarUploading: false });
      showToast(err.message || '头像上传失败，请重试');
    }
  },

  // fileID 失效时回退字母头像，避免一直空白
  onAvatarError() {
    this.setData({
      avatar: avatarView(Object.assign({}, this.data.userInfo, { avatarUrl: '' }))
    });
  },

  onNickName(e) {
    this.setData({ 'userInfo.nickName': e.detail.value });
  },

  // 手机号：选填，仅用于账号找回，不对外展示
  onPhone(e) {
    const value = e.detail.value.replace(/\D/g, '').slice(0, 11);
    let phoneError = '';
    if (value.length > 0 && !validatePhone(value).valid) {
      phoneError = validatePhone(value).error;
    }
    this.setData({ 'userInfo.phone': value, phoneError });
    this.setData({ canSave: this.canSaveWith(Object.assign({}, this.data.userInfo, { phone: value })) });
  },

  // 微信号：对外展示，供交易对方复制
  onWechatId(e) {
    const value = (e.detail.value || '').trim();
    let wechatIdError = '';
    if (value.length > 0 && !validateWechatId(value).valid) {
      wechatIdError = validateWechatId(value).error;
    }
    this.setData({
      'userInfo.wechat_id': value,
      wechatIdError,
      wechatDirty: true
    });
    this.refreshWechatConfirmState();
  },

  onWechatConfirm(e) {
    this.setData({ wechatConfirm: (e.detail.value || '').trim() });
    this.refreshWechatConfirmState();
  },

  async save() {
    const { userInfo, phoneError, wechatDirty, wechatConfirm } = this.data;

    // 微信号：必填 + 格式校验 + 改动后二次确认
    const wechatId = (userInfo.wechat_id || '').trim();
    const wechatCheck = validateWechatId(wechatId);
    if (!wechatCheck.valid) {
      showToast(wechatCheck.error);
      return;
    }
    if (wechatDirty && wechatConfirm !== wechatId) {
      showToast('两次输入的微信号不一致');
      return;
    }

    // 手机号：选填，填了必须合法
    const phone = (userInfo.phone || '').trim();
    if (phoneError || (phone && !validatePhone(phone).valid)) {
      showToast('手机号格式不正确');
      return;
    }

    if (!userInfo.nickName || !userInfo.nickName.trim()) {
      showToast('请填写昵称');
      return;
    }

    try {
      const updateData = {
        nickName: userInfo.nickName.trim(),
        wechat_id: wechatId
      };
      if (phone) updateData.phone = phone;

      // 头像不由“保存”提交：选择时已即时上传并落库，此处不带 avatarUrl，避免覆盖
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
