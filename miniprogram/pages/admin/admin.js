// pages/admin/admin.js - 管理后台（学生认证审核 + 商品审核）
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading, formatDate } = require('../../utils/util.js');

const timeText = (t) => {
  if (!t) return '';
  const ts = new Date(t).getTime();
  if (!ts) return '';
  return formatDate(ts);
};

// 公益图书角默认空间（首个茶咖空间）。将来有多个图书角时，这里改成空间下拉选择即可。
const DEFAULT_SPACE_ID = 'space_stnh_001';

Page({
  data: {
    isAdmin: false,
    password: '',
    module: 'verify', // verify 学生认证 | commodity 商品审核 | data 数据管理
    tab: 'pending', // pending | approved | rejected
    list: [],
    loading: false,
    noMore: false,
    // 数据管理
    myOpenid: '',
    dataSub: 'commodity', // commodity 商品 | user 用户
    dataKeyword: '',
    dataStatus: '',       // 商品状态筛选：'' 全部 | pendingReview | onSale | rejected | deleted
    dataType: '',         // 商品类型筛选：'' 全部 | sell | want
    cList: [],
    cTotal: 0,
    uList: [],
    uTotal: 0,
    dataPage: 1,
    dataNoMore: false,
    dataLoading: false,
    // 留言审核（公益图书角）
    spaceId: DEFAULT_SPACE_ID,
    cmtTab: 'pending',      // pending | approved | rejected
    cmtList: [],
    cmtTotal: 0,
    cmtPage: 1,
    cmtNoMore: false,
    cmtLoading: false,
    commentPendingCount: 0  // 导航角标：待审留言数
  },

  onLoad() {
    this.checkAdmin();
    this.setData({ myOpenid: wx.getStorageSync('openid') || '' });
  },

  async checkAdmin() {
    try {
      const res = await API.adminCheck();
      if (res.code === 0 && res.data && res.data.isAdmin) {
        this.setData({ isAdmin: true });
        this.loadList();
        this.refreshCommentBadge();
      }
    } catch (err) {
      console.error('管理员校验失败:', err);
    }
  },

  onPassword(e) {
    this.setData({ password: e.detail.value });
  },

  async doLogin() {
    const password = this.data.password.trim();
    if (!password) {
      showToast('请输入管理密码');
      return;
    }
    showLoading('登录中...');
    try {
      const res = await API.adminLogin(password);
      hideLoading();
      if (res.code === 0) {
        showToast('管理员登录成功');
        this.setData({ isAdmin: true, password: '' });
        this.loadList();
        this.refreshCommentBadge();
      } else {
        showToast(res.msg || '登录失败');
      }
    } catch (err) {
      hideLoading();
      showToast(err.message || '登录失败');
    }
  },

  async loadList() {
    const { tab } = this.data;
    this.setData({ loading: true });
    try {
      const res = await API.adminListVerify(tab);
      if (res.code === 0) {
        const list = (res.data || []).map((item) => ({
          ...item,
          timeText: timeText(item.studentVerifyTime)
        }));
        this.setData({ list });
      } else {
        showToast(res.msg || '加载失败');
      }
    } catch (err) {
      showToast(err.message || '加载失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab, list: [] });
    this.loadList();
  },

  switchModule(e) {
    const module = e.currentTarget.dataset.module;
    if (module === this.data.module) return;
    this.setData({ module, list: [] });
    if (module === 'data') {
      this.loadData(true);
    } else if (module === 'verify') {
      this.loadList();
    } else if (module === 'comment') {
      this.refreshCommentBadge();
      this.loadCommentList(true);
    } else {
      this.loadCommodityList();
    }
  },

  // ===================== 数据管理：商品 / 用户 =====================
  mapCommodity(c) {
    const statusMap = { draft: '待上架', pendingReview: '待审核', onSale: '已上架', rejected: '已驳回', deleted: '已删除', sold: '已结束' };
    const price = Number(c.price) || 0;
    return Object.assign({}, c, {
      cover: (c.images && c.images[0]) || '',
      timeText: timeText(c.createTime),
      statusText: statusMap[c.status] || c.status || '',
      priceText: c.type === 'want'
        ? '求购中'
        : (c.type === 'exchange' ? ('🔁 换：' + (c.exchange_want || '面议')) : (price > 0 ? '¥' + price : '面议'))
    });
  },

  switchDataSub(e) {
    const sub = e.currentTarget.dataset.sub;
    if (sub === this.data.dataSub) return;
    this.setData({
      dataSub: sub,
      dataKeyword: '',
      dataStatus: '',
      dataType: '',
      cList: [],
      cTotal: 0,
      uList: [],
      uTotal: 0,
      dataPage: 1,
      dataNoMore: false
    });
    this.loadData(true);
  },

  onDataKeyword(e) {
    this.setData({ dataKeyword: e.detail.value });
  },

  searchData() {
    this.loadData(true);
  },

  switchDataStatus(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.dataStatus) return;
    this.setData({ dataStatus: status });
    this.loadData(true);
  },

  switchDataType(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.dataType) return;
    this.setData({ dataType: type });
    this.loadData(true);
  },

  async loadData(reset = true) {
    const sub = this.data.dataSub;
    const keyword = (this.data.dataKeyword || '').trim();
    const page = reset ? 1 : (this.data.dataPage + 1);
    const pageSize = 20;
    this.setData({ dataLoading: true });
    try {
      let res;
      if (sub === 'user') {
        res = await API.adminListUsers({ keyword, page, pageSize });
      } else {
        res = await API.adminListCommodity({
          keyword,
          status: this.data.dataStatus,
          type: this.data.dataType,
          page,
          pageSize
        });
      }
      if (!res || res.code !== 0) {
        showToast((res && res.msg) || '加载失败');
        return;
      }
      const raw = res.data || [];
      const mapped = sub === 'user'
        ? raw.map(u => Object.assign({}, u, { timeText: timeText(u.createTime) }))
        : raw.map(c => this.mapCommodity(c));
      const total = res.total || 0;
      const listKey = sub === 'user' ? 'uList' : 'cList';
      const totalKey = sub === 'user' ? 'uTotal' : 'cTotal';
      const nextList = reset ? mapped : this.data[listKey].concat(mapped);
      const patch = {
        [listKey]: nextList,
        [totalKey]: total,
        dataPage: page,
        dataNoMore: nextList.length >= total
      };
      this.setData(patch);
    } catch (err) {
      showToast(err.message || '加载失败');
    } finally {
      this.setData({ dataLoading: false });
    }
  },

  loadMoreData() {
    if (this.data.dataLoading || this.data.dataNoMore) return;
    this.loadData(false);
  },

  // 商品：改状态
  changeCommodityStatus(e) {
    const id = e.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ['上架展示', '驳回（填写原因）', '转为待审核', '下架（标记删除）'],
      success: (res) => {
        const target = ['onSale', 'rejected', 'pendingReview', 'deleted'][res.tapIndex];
        if (!target) return;
        if (target === 'rejected') {
          this.promptRejectCommodity(id);
        } else {
          this.confirmSetCommodityStatus(id, target);
        }
      }
    });
  },

  promptRejectCommodity(id) {
    wx.showModal({
      title: '驳回商品',
      content: '请填写驳回原因（将展示给发布者）：',
      editable: true,
      placeholderText: '例如：图片与描述不符、内容违规',
      confirmText: '驳回',
      confirmColor: '#f43f5e',
      success: async (res) => {
        if (!res.confirm) return;
        this.doSetCommodityStatus(id, 'rejected', (res.content || '').trim());
      }
    });
  },

  confirmSetCommodityStatus(id, target) {
    const tips = {
      onSale: '确认将该信息审核通过并上架展示？',
      pendingReview: '确认将该信息转为“待审核”状态？',
      deleted: '确认下架该信息？（发布者可在“我发布的信息”中删除或恢复）'
    };
    wx.showModal({
      title: '变更状态',
      content: tips[target] || '确认变更该信息状态？',
      confirmText: '确定',
      success: async (res) => {
        if (!res.confirm) return;
        this.doSetCommodityStatus(id, target, '');
      }
    });
  },

  async doSetCommodityStatus(id, status, reason) {
    showLoading('处理中...');
    try {
      const res = await API.adminSetCommodityStatus(id, status, reason);
      hideLoading();
      if (res.code === 0) {
        showToast(res.msg || '状态已更新');
        this.loadData(true);
      } else {
        showToast(res.msg || '操作失败');
      }
    } catch (err) {
      hideLoading();
      showToast(err.message || '操作失败');
    }
  },

  deleteCommodity(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '永久删除商品',
      content: '将删除该信息文档及其云存储图片，且不可恢复。确定删除？',
      confirmText: '永久删除',
      confirmColor: '#f43f5e',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('删除中...');
        try {
          const apiRes = await API.adminDeleteCommodity(id);
          hideLoading();
          if (apiRes.code === 0) {
            showToast('已永久删除');
            this.loadData(true);
          } else {
            showToast(apiRes.msg || '删除失败');
          }
        } catch (err) {
          hideLoading();
          showToast(err.message || '删除失败');
        }
      }
    });
  },

  toggleUserAdmin(e) {
    const id = e.currentTarget.dataset.id;
    const user = this.data.uList.find(u => u._id === id);
    if (!user) return;
    const toAdmin = !user.isAdmin;
    wx.showModal({
      title: toAdmin ? '设为管理员' : '取消管理员',
      content: toAdmin
        ? '确认授予该用户管理员权限？管理员可进入审核与数据管理后台。'
        : '确认取消该用户的管理员权限？',
      confirmText: '确定',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('处理中...');
        try {
          const apiRes = await API.adminSetAdmin(id, toAdmin);
          hideLoading();
          if (apiRes.code === 0) {
            showToast(apiRes.msg || '操作成功');
            this.loadData(true);
          } else {
            showToast(apiRes.msg || '操作失败');
          }
        } catch (err) {
          hideLoading();
          showToast(err.message || '操作失败');
        }
      }
    });
  },

  toggleUserBan(e) {
    const id = e.currentTarget.dataset.id;
    const user = this.data.uList.find(u => u._id === id);
    if (!user) return;
    const toBan = !user.banned;
    wx.showModal({
      title: toBan ? '封禁账号' : '解封账号',
      content: toBan
        ? '封禁后该账号将无法登录及发布信息（不影响浏览）。确定封禁？'
        : '确认解除该账号的封禁状态？',
      confirmText: '确定',
      confirmColor: toBan ? '#f43f5e' : '#00c17e',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('处理中...');
        try {
          const apiRes = await API.adminSetBan(id, toBan);
          hideLoading();
          if (apiRes.code === 0) {
            showToast(apiRes.msg || '操作成功');
            this.loadData(true);
          } else {
            showToast(apiRes.msg || '操作失败');
          }
        } catch (err) {
          hideLoading();
          showToast(err.message || '操作失败');
        }
      }
    });
  },

  // 技能达人：设为 / 撤销（小程序内的人工审核与撤销入口）
  toggleExpert(e) {
    const id = e.currentTarget.dataset.id;
    const user = this.data.uList.find(u => u._id === id);
    if (!user) return;
    const toExpert = user.expert_status !== 'approved';

    wx.showModal({
      title: toExpert ? '设为技能达人' : '撤销技能达人',
      content: toExpert
        ? '确认将该用户设为技能达人？对方即可发布技能服务。'
        : '确认撤销该用户的技能达人身份？其技能服务将无法继续发布。',
      confirmText: '确定',
      confirmColor: toExpert ? '#ffb020' : '#f43f5e',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('处理中...');
        try {
          const apiRes = await API.expertAudit(id, toExpert ? 'approved' : 'none');
          hideLoading();
          if (apiRes.code === 0) {
            showToast(apiRes.msg || '操作成功');
            this.loadData(true);
          } else {
            showToast(apiRes.msg || '操作失败');
          }
        } catch (err) {
          hideLoading();
          showToast(err.message || '操作失败');
        }
      }
    });
  },

  deleteUser(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除用户',
      content: '将永久删除该用户及其发布的所有信息与图片，且不可恢复。确定删除？',
      confirmText: '永久删除',
      confirmColor: '#f43f5e',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('删除中...');
        try {
          const apiRes = await API.adminDeleteUser(id);
          hideLoading();
          if (apiRes.code === 0) {
            showToast(apiRes.msg || '已删除');
            this.loadData(true);
          } else {
            showToast(apiRes.msg || '删除失败');
          }
        } catch (err) {
          hideLoading();
          showToast(err.message || '删除失败');
        }
      }
    });
  },

  // ===================== 留言审核（公益图书角） =====================

  // 角标：进入管理页 / 切到本模块时刷新待审总数
  async refreshCommentBadge() {
    try {
      const res = await API.adminCommentPending({ spaceId: this.data.spaceId, page: 1, pageSize: 1 });
      if (res && res.code === 0) {
        this.setData({ commentPendingCount: res.pendingCount || 0 });
      }
    } catch (err) {
      console.error('留言角标加载失败:', err);
    }
  },

  switchCommentTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.cmtTab) return;
    this.setData({ cmtTab: tab, cmtList: [], cmtTotal: 0, cmtPage: 1, cmtNoMore: false });
    this.loadCommentList(true);
  },

  async loadCommentList(reset = true) {
    const tab = this.data.cmtTab;
    const page = reset ? 1 : (this.data.cmtPage + 1);
    this.setData({ cmtLoading: true });
    try {
      const params = { spaceId: this.data.spaceId, page, pageSize: 20 };
      const res = tab === 'pending'
        ? await API.adminCommentPending(params)
        : await API.adminCommentApproved(Object.assign({ status: tab }, params));
      if (!res || res.code !== 0) {
        showToast((res && res.msg) || '加载失败');
        return;
      }
      const mapped = (res.data || []).map(item => Object.assign({}, item, {
        timeText: timeText(item.createdAt)
      }));
      const nextList = reset ? mapped : this.data.cmtList.concat(mapped);
      const total = res.total || 0;
      this.setData({
        cmtList: nextList,
        cmtTotal: total,
        cmtPage: page,
        cmtNoMore: nextList.length >= total,
        commentPendingCount: res.pendingCount === undefined ? this.data.commentPendingCount : res.pendingCount
      });
    } catch (err) {
      showToast(err.message || '加载失败');
    } finally {
      this.setData({ cmtLoading: false });
    }
  },

  loadMoreComment() {
    if (this.data.cmtLoading || this.data.cmtNoMore) return;
    this.loadCommentList(false);
  },

  // 审核动作：通过 / 拒绝 / 加精 / 取消加精 —— 成功后局部更新当前列表项，不整页重载
  async doCommentReview(id, op) {
    showLoading('处理中...');
    try {
      const res = await API.adminCommentReview(id, op);
      hideLoading();
      if (!res || res.code !== 0) {
        showToast((res && res.msg) || '操作失败');
        return;
      }
      showToast(res.msg || '操作成功');

      const patch = res.data || {};
      const list = this.data.cmtList.map(item => (item._id === id ? Object.assign({}, item, patch) : item));
      // 待审 Tab 里「通过 / 拒绝」后该条已不属于本列表，直接移除，保持视图与数据一致
      const stillVisible = !(this.data.cmtTab === 'pending' && (op === 'approve' || op === 'reject'));
      if (stillVisible) {
        this.setData({ cmtList: list });
      } else {
        this.setData({
          cmtList: list.filter(item => item._id !== id),
          cmtTotal: Math.max(0, this.data.cmtTotal - 1)
        });
      }
      this.refreshCommentBadge();
    } catch (err) {
      hideLoading();
      showToast(err.message || '操作失败');
    }
  },

  approveComment(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '通过留言',
      content: '确认通过这条留言？通过后将展示在书详情页的留言长帖里。',
      confirmText: '通过',
      confirmColor: '#00c17e',
      success: (res) => {
        if (res.confirm) this.doCommentReview(id, 'approve');
      }
    });
  },

  rejectComment(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '拒绝留言',
      content: '确认拒绝这条留言？拒绝后不会对读者展示（留言不会删除，仅改状态）。',
      confirmText: '拒绝',
      confirmColor: '#f43f5e',
      success: (res) => {
        if (res.confirm) this.doCommentReview(id, 'reject');
      }
    });
  },

  starComment(e) {
    const { id, starred } = e.currentTarget.dataset;
    const isStarred = String(starred) === 'true';
    this.doCommentReview(id, isStarred ? 'unstar' : 'star');
  },

  // ===== 商品审核 =====
  async loadCommodityList() {
    this.setData({ loading: true });
    try {
      const res = await API.getPendingCommodityList(1, 50);
      if (res.code === 0) {
        const list = (res.data || []).map((item) => ({
          ...item,
          images: item.images || [],
          timeText: timeText(item.createTime),
          statusText: item.type === 'want' ? '求购' : (item.type === 'exchange' ? '易物' : '出售'),
          priceText: item.type === 'want'
            ? '求购中'
            : (item.type === 'exchange' ? ('🔁 换：' + (item.exchange_want || '面议')) : '¥' + (item.price || '0'))
        }));
        this.setData({ list });
      } else {
        showToast(res.msg || '加载失败');
      }
    } catch (err) {
      showToast(err.message || '加载失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  auditCommodity(e) {
    const { id, result } = e.currentTarget.dataset;
    const isApprove = result === 'approved';
    if (isApprove) {
      wx.showModal({
        title: '确认上架',
        content: '确认该商品审核通过并上架展示？',
        confirmText: '通过',
        confirmColor: '#00c17e',
        success: async (res) => {
          if (!res.confirm) return;
          this.doAuditCommodity(id, 'approved', '');
        }
      });
    } else {
      wx.showModal({
        title: '驳回商品',
        content: '请填写驳回原因（将展示给发布者）：',
        editable: true,
        placeholderText: '例如：图片模糊、描述不完整、违规内容',
        confirmText: '驳回',
        confirmColor: '#f43f5e',
        success: async (res) => {
          if (!res.confirm) return;
          this.doAuditCommodity(id, 'rejected', (res.content || '').trim());
        }
      });
    }
  },

  async doAuditCommodity(id, result, reason) {
    if (result === 'rejected' && !reason) {
      showToast('请填写驳回原因');
      return;
    }
    showLoading('处理中...');
    try {
      const apiRes = result === 'approved'
        ? await API.approveCommodity(id)
        : await API.rejectCommodity(id, reason);
      hideLoading();
      if (apiRes.code === 0) {
        showToast(result === 'approved' ? '已通过，商品已上架' : '已驳回');
        this.loadCommodityList();
      } else {
        showToast(apiRes.msg || '操作失败');
      }
    } catch (err) {
      hideLoading();
      showToast(err.message || '操作失败');
    }
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      wx.previewImage({ urls: [url] });
    }
  },

  audit(e) {
    const { id, result } = e.currentTarget.dataset;
    const isApprove = result === 'approved';
    wx.showModal({
      title: isApprove ? '确认通过' : '确认拒绝',
      content: isApprove
        ? '确认该用户学生身份认证通过？通过后其账号将显示"已认证"。'
        : '确认拒绝该用户的认证申请？拒绝后其可修改资料重新提交。',
      confirmText: isApprove ? '通过' : '拒绝',
      confirmColor: isApprove ? '#00c17e' : '#f43f5e',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('处理中...');
        try {
          const apiRes = await API.adminAuditVerify(id, result);
          hideLoading();
          if (apiRes.code === 0) {
            showToast(isApprove ? '已通过认证' : '已拒绝');
            this.loadList();
          } else {
            showToast(apiRes.msg || '操作失败');
          }
        } catch (err) {
          hideLoading();
          showToast(err.message || '操作失败');
        }
      }
    });
  },

  async doLogout() {
    wx.showModal({
      title: '退出管理员',
      content: '退出后本账号将不再显示管理入口，需重新输入管理密码。',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await API.adminLogout();
        } catch (err) {
          console.error('退出管理员失败:', err);
        }
        this.setData({ isAdmin: false, list: [] });
        showToast('已退出管理员');
      }
    });
  }
});
