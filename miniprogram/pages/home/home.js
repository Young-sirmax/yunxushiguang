// pages/home/home.js
const app = getApp();
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');
const { avatarView, isValidAvatar, uploadAvatar } = require('../../utils/avatar.js');

Page({
  data: {
    userInfo: {},
    avatar: { useImage: false, src: '', letter: '👤', color: '' },
    avatarUploading: false,
    isLoggedIn: false,
    isAdmin: false,
    stats: { release: 0, favorite: 0 },
    // 技能达人状态（我的页入口展示）
    expertStatus: 'none',
    expertStatusText: '',
    expertStatusClass: '',
    ratingText: '',
    // 维护模式
    maintenance: false,
    maintenanceNotice: '',
    // 批量上架（仅白名单可见）
    canBatch: false
  },

  onShow() {
    this.loadAppConfig();
    const userInfo = wx.getStorageSync('userInfo') || {};
    const isLoggedIn = !!(userInfo && userInfo._openid);
    this.setData({ userInfo, avatar: avatarView(userInfo), isLoggedIn });
    if (isLoggedIn) {
      this.loadStats();
      this.checkAdmin();
      // 两个引导共用一个 showModal 通道，先微信号后头像，避免同屏弹两个窗
      const guided = this.maybeGuideWechat(userInfo);
      if (!guided) this.maybeGuideAvatar(userInfo);
      // 后台刷新最新用户信息（含认证状态），保证全局一致
      app.refreshUserInfo().then((fresh) => {
        if (fresh) {
          // 上传中的本地预览优先级更高，避免云端旧数据把刚选的头像冲掉
          const patch = { userInfo: fresh };
          if (!this.data.avatarUploading) patch.avatar = avatarView(fresh);
          this.setData(patch);
          this.applyExpertState(fresh);
        }
      });
      this.applyExpertState(userInfo);
    }
  },

  // 维护模式横幅
  async loadAppConfig() {
    const cfg = await app.getAppConfig();
    this.setData({
      maintenance: !!(cfg && cfg.maintenance),
      maintenanceNotice: (cfg && cfg.notice) || '',
      canBatch: !!(cfg && cfg.canBatch)
    });
  },

  // 达人状态 / 评分文案
  applyExpertState(userInfo) {
    const u = userInfo || {};
    const status = u.expert_status || 'none';
    const map = {
      none: { text: '', cls: '' },
      pending: { text: '审核中', cls: 'pending' },
      approved: { text: '已入驻', cls: '' },
      rejected: { text: '未通过', cls: 'unverified' }
    };
    const st = map[status] || map.none;
    const count = u.rating_count || 0;
    this.setData({
      expertStatus: status,
      expertStatusText: st.text,
      expertStatusClass: st.cls,
      ratingText: count > 0 ? (Number(((u.rating_sum || 0) / count).toFixed(1)) + '分') : ''
    });
  },

  // 达人入驻 / 我的达人主页
  goExpert() {
    this.requireLogin(() => {
      const status = this.data.expertStatus;
      const openid = wx.getStorageSync('openid') || '';
      if (status === 'approved') {
        wx.navigateTo({ url: `/pages/expert_home/expert_home?openid=${openid}` });
      } else {
        wx.navigateTo({ url: '/pages/expert_apply/expert_apply' });
      }
    });
  },

  goBatchUpload() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/admin_batch/admin_batch' });
    });
  },

  goMyReviews() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/my_reviews/my_reviews' });
    });
  },

  // 存量用户未填微信号：进入首页引导一次（只弹一次，可关闭）
  // @returns {boolean} 本次是否弹了窗（供调用方避免叠弹）
  maybeGuideWechat(userInfo) {
    if (!userInfo || userInfo.wechat_id) return false;
    if (wx.getStorageSync('wechatGuideShown')) return false;
    wx.setStorageSync('wechatGuideShown', true);
    wx.showModal({
      title: '完善资料',
      content: '你还没有填写微信号，交易对方将无法联系到你。现在去完善吗？',
      confirmText: '去完善',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/home_user_info/home_user_info' });
        }
      }
    });
    return true;
  },

  // 头像异常（为空 / fileID 失效 / 历史遗留的默认灰头像）：引导重新选择
  // 只弹一次，可关闭；拒绝后写入标记不再打扰
  maybeGuideAvatar(userInfo) {
    if (isValidAvatar(userInfo && userInfo.avatarUrl)) return false;
    if (wx.getStorageSync('avatarGuideShown')) return false;
    wx.setStorageSync('avatarGuideShown', true);
    wx.showModal({
      title: '设置头像',
      content: '你的头像还是默认的，换个头像更容易被同学记住。现在去设置吗？',
      confirmText: '去设置',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/home_user_info/home_user_info' });
        }
      }
    });
    return true;
  },

  // 官方头像选择器回调：选完立即上传并落库，页面立刻显示新头像
  async onChooseAvatar(e) {
    if (!this.data.isLoggedIn) {
      this.requireLogin();
      return;
    }
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
      // 全局同步（storage + globalData），个人信息页与其他页面立即一致
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

  checkAdmin() {
    if (!this.data.isLoggedIn) return;
    API.adminCheck()
      .then((res) => {
        if (res.code === 0 && res.data && res.data.isAdmin) {
          this.setData({ isAdmin: true });
        }
      })
      .catch((err) => {
        const msg = (err && err.message) || '';
        const isNotFound = msg.includes('504001') || msg.includes('找不到') || msg.includes('not found');
        if (isNotFound) {
          wx.showToast({
            title: '请部署admin云函数',
            icon: 'none',
            duration: 2500
          });
        }
        console.error('管理员校验失败:', err);
      });
  },

  goAdmin() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/admin/admin' });
    });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/index/index' });
  },

  async loadStats() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;

    try {
      const releaseRes = await API.getCommodityList({ sellerId: openid, page: 1, pageSize: 1 });
      let favoriteTotal = 0;
      try {
        const favRes = await API.getFavoriteList({ page: 1, pageSize: 1 });
        favoriteTotal = favRes.total || 0;
      } catch (e) {
        console.error('加载收藏数失败:', e);
      }

      this.setData({
        stats: {
          release: releaseRes.total || 0,
          favorite: favoriteTotal
        }
      });
    } catch (err) {
      console.error('加载统计失败:', err);
    }
  },

  requireLogin(callback) {
    if (!this.data.isLoggedIn) {
      wx.showModal({
        title: '提示',
        content: '请先登录后再使用此功能',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            this.goLogin();
          }
        }
      });
      return;
    }
    if (callback) callback();
  },

  goUserInfo() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/home_user_info/home_user_info' });
    });
  },

  goMyRelease() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/home_release/home_release' });
    });
  },

  goMyWant() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/home_release/home_release?tab=want' });
    });
  },

  goMyFavorite() {
    this.requireLogin(() => {
      wx.navigateTo({ url: '/pages/home_favorite/home_favorite' });
    });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goAbout() {
    wx.navigateTo({ url: '/pages/home_about/home_about' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/home_feedback/home_feedback' });
  },

  logout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          app.globalData.userInfo = null;
          app.globalData.openid = null;
          wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
        }
      }
    });
  }
});