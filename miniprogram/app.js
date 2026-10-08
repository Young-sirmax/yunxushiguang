// app.js
App({
  globalData: {
    userInfo: null,
    openid: null,
    university: null,
    editParams: null,
    // 全局配置缓存（维护模式开关 + 批量上架权限），60 秒有效。
    // 指令 4.3：授权/回收要"即时生效"，故从 5 分钟降到 60 秒，
    // 并在授权/回收成功后由调用方 app.clearAppConfigCache() 主动失效。
    appConfig: null,
    // 技能分类缓存（来自 config 集合），1 小时有效
    skillCategories: null
  },
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-d0gvvc41c5a9dab3f',
        traceUser: true
      });
    }
    this.checkLoginStatus();
  },
  checkLoginStatus() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      // 后台静默刷新一次最新用户信息，保证认证状态全局同步
      this.refreshUserInfo();
    }
  },
  // 拉取全局配置（维护模式 + 批量上架权限），带 60 秒本地缓存；失败一律按未开启维护处理
  async getAppConfig(force) {
    const now = Date.now();
    const cached = this.globalData.appConfig;
    if (!force && cached && (now - cached.time) < 60 * 1000) {
      return cached.data;
    }
    try {
      const API = require('./api/api.js');
      const res = await API.getAppConfig();
      if (res && res.code === 0) {
        this.globalData.appConfig = { time: now, data: res.data };
        return res.data;
      }
    } catch (err) {
      console.error('获取全局配置失败:', err);
    }
    return cached ? cached.data : { maintenance: false, notice: '', canBatch: false, isSuper: false };
  },

  // 主动作废全局配置缓存（授权/回收成功后调用，让权限变更即时生效）
  clearAppConfigCache() {
    this.globalData.appConfig = null;
  },

  // 技能分类列表：来源是 config 集合（app.skill_categories），本地缓存 1 小时。
  // 这样后台改配置即可增删技能分类，不需要重新提审发版。
  // 读取顺序：内存缓存 → 本地存储缓存 → 云配置 → 兜底常量。
  async getSkillCategories(force) {
    const { FALLBACK_SKILL_CATEGORIES } = require('./utils/expert.js');
    const KEY = 'skillCategoriesCache';
    const TTL = 60 * 60 * 1000; // 1 小时
    const now = Date.now();

    if (!force) {
      const mem = this.globalData.skillCategories;
      if (mem && (now - mem.time) < TTL && mem.list && mem.list.length) return mem.list;
      const stored = wx.getStorageSync(KEY);
      if (stored && stored.list && stored.list.length && (now - (stored.time || 0)) < TTL) {
        this.globalData.skillCategories = { time: stored.time, list: stored.list };
        return stored.list;
      }
    }

    try {
      const API = require('./api/api.js');
      const res = await API.getAppConfig();
      const list = res && res.code === 0 && res.data && res.data.skillCategories;
      if (Array.isArray(list) && list.length) {
        this.globalData.skillCategories = { time: now, list };
        wx.setStorageSync(KEY, { time: now, list });
        return list;
      }
    } catch (err) {
      console.error('获取技能分类配置失败:', err);
    }

    // 拉取失败：优先用过期缓存，其次用兜底常量
    const stored = wx.getStorageSync(KEY);
    if (stored && stored.list && stored.list.length) return stored.list;
    return FALLBACK_SKILL_CATEGORIES;
  },

  // 全局同步用户信息（storage + globalData），保证认证状态等数据全局一致、一次认证全平台生效
  syncUserInfo(userInfo) {
    if (!userInfo) return;
    wx.setStorageSync('userInfo', userInfo);
    this.globalData.userInfo = userInfo;
    const openid = userInfo._openid || userInfo.openid;
    if (openid) {
      wx.setStorageSync('openid', openid);
      this.globalData.openid = openid;
    }
  },
  // 从云端拉取最新用户信息（含认证状态），并全局同步
  async refreshUserInfo() {
    // 延迟加载 api.js，确保 wx.cloud.init 已完成
    const API = require('./api/api.js');
    const local = wx.getStorageSync('userInfo');
    if (!local || !local._openid) return null;
    try {
      const res = await API.getUserInfo();
      if (res && res.code === 0 && res.data) {
        this.syncUserInfo(res.data);
        return res.data;
      }
    } catch (err) {
      console.error('刷新用户信息失败:', err);
    }
    return null;
  }
});
