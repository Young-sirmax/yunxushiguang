// pages/bookcorner/detail.js —— 书详情 + 留言长帖（只展示已通过留言）
const API = require('../../api/api.js');
const { showToast, formatDate } = require('../../utils/util.js');

const PAGE_SIZE = 20;
const COMMENT_MAX = 200;

Page({
  data: {
    bookId: '',
    book: null,
    commentTotal: 0,
    comments: [],
    page: 1,
    noMore: false,
    loading: true,
    loadingMore: false,
    input: '',
    inputLen: 0,
    inputFocus: false,
    canSubmit: false,
    submitting: false,
    commentMax: COMMENT_MAX
  },

  onLoad(options) {
    const bookId = (options && options.id) || '';
    if (!bookId) {
      showToast('缺少图书标识');
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ bookId });
    this.loadDetail();
    this.loadComments(true);
  },

  async loadDetail() {
    try {
      const res = await API.getBookDetail(this.data.bookId);
      if (!res || res.code !== 0) {
        showToast((res && res.msg) || '加载失败');
        return;
      }
      this.setData({
        book: res.data.book || null,
        commentTotal: res.data.commentTotal || 0
      });
      wx.setNavigationBarTitle({ title: (res.data.book && res.data.book.title) || '图书详情' });
    } catch (err) {
      console.error('图书详情加载失败:', err);
      showToast('加载失败，请稍后重试');
    }
  },

  async loadComments(reset) {
    if (!reset && (this.data.noMore || this.data.loadingMore)) return;
    const page = reset ? 1 : (this.data.page + 1);
    this.setData(reset ? { loading: true } : { loadingMore: true });
    try {
      const res = await API.getBookComments({ bookId: this.data.bookId, page, pageSize: PAGE_SIZE });
      if (!res || res.code !== 0) {
        showToast((res && res.msg) || '留言加载失败');
        return;
      }
      const mapped = (res.data || []).map(item => Object.assign({}, item, {
        timeText: item.createdAt ? formatDate(new Date(item.createdAt).getTime()) : ''
      }));
      const comments = reset ? mapped : this.data.comments.concat(mapped);
      this.setData({
        comments,
        page,
        // 加精留言由服务端置顶（starred desc + createdAt asc），前端只负责渲染「精选」小标
        noMore: comments.length >= (res.total || 0)
      });
    } catch (err) {
      console.error('留言加载失败:', err);
      showToast('留言加载失败');
    } finally {
      this.setData({ loading: false, loadingMore: false });
    }
  },

  onReachBottom() {
    this.loadComments(false);
  },

  onPullDownRefresh() {
    this.loadDetail();
    this.loadComments(true).then(() => wx.stopPullDownRefresh());
  },

  onInput(e) {
    const value = e.detail.value || '';
    this.setData({
      input: value,
      inputLen: value.length,
      canSubmit: !!value.trim()
    });
  },

  // 未登录用户点输入栏 → 引导登录（沿用项目既有引导方式）
  requireLogin() {
    wx.showModal({
      title: '需要登录',
      content: '登录后才能留下你的阅读感受',
      confirmText: '去登录',
      confirmColor: '#00c17e',
      success: (res) => {
        if (res.confirm) wx.navigateTo({ url: '/pages/index/index' });
      }
    });
  },

  onInputBarTap() {
    if (!wx.getStorageSync('openid')) {
      this.requireLogin();
      return;
    }
    this.setData({ inputFocus: true });
  },

  async submit() {
    if (this.data.submitting) return;
    const content = (this.data.input || '').trim();
    if (!content) {
      showToast('写下点什么再提交吧');
      return;
    }
    if (!wx.getStorageSync('openid')) {
      this.requireLogin();
      return;
    }

    this.setData({ submitting: true });
    try {
      const res = await API.addBookComment(this.data.bookId, content);
      if (!res || res.code !== 0) {
        showToast((res && res.msg) || '提交失败');
        return;
      }
      // 统一提示，不暴露审核机制（直接通过 / 待审都是同一句话）
      showToast('留言已提交，将在审核后展示');
      this.setData({ input: '', inputLen: 0, canSubmit: false });
      this.loadDetail();
    } catch (err) {
      showToast(err.message || '提交失败');
    } finally {
      this.setData({ submitting: false });
    }
  },

  onShareAppMessage() {
    const book = this.data.book;
    return {
      title: book ? `《${book.title}》的书评留言` : '茶咖公益图书角',
      path: `/pages/bookcorner/detail?id=${this.data.bookId}`
    };
  }
});
