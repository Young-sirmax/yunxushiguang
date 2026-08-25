// pages/home_message/home_message.js
const app = getApp();
const API = require('../../api/api.js');

function formatTime(timestamp) {
  if (!timestamp) return '';
  const now = new Date();
  const date = new Date(timestamp);
  const pad = n => n < 10 ? '0' + n : '' + n;
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const hhmm = hh + ':' + mm;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

  if (date.getTime() >= todayStart) {
    return hhmm;
  } else if (date.getTime() >= yesterdayStart) {
    return '昨天';
  } else if (date.getFullYear() === now.getFullYear()) {
    return (date.getMonth() + 1) + '/' + date.getDate();
  } else {
    return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
  }
}

Page({
  data: {
    conversations: [],
    loading: false
  },

  onShow() {
    this.loadAllConversations();
  },

  async loadAllConversations() {
    this.setData({ loading: true });

    try {
      const convRes = await API.chatGetConversationList();
      const serverConversations = convRes.code === 0 ? (convRes.data || []) : [];

      const openid = wx.getStorageSync('openid');
      let myProducts = [];
      try {
        if (openid) {
          const productRes = await API.getCommodityList({ sellerId: openid, page: 1, pageSize: 100 });
          myProducts = (productRes.data || []).filter(p => p.status !== 'deleted');
        }
      } catch (e) {
        console.error('加载商品失败:', e);
      }

      const existingProductIds = new Set(serverConversations.map(c => c.commodityId));
      const userInfo = wx.getStorageSync('userInfo') || {};

      const productEntries = myProducts
        .filter(p => !existingProductIds.has(p._id))
        .map(p => ({
          _id: 'product_' + p._id,
          key: 'product_' + p._id,
          commodityId: p._id,
          commodityTitle: p.title || '未命名商品',
          commodityImage: (p.images && p.images[0]) || '',
          commodityPrice: p.price || '',
          otherName: userInfo.nickName || '我',
          otherAvatar: userInfo.avatarUrl || '',
          otherOpenid: openid || '',
          lastMessage: '',
          lastMessageType: '',
          lastMessageTime: p.updateTime || p.createTime || Date.now(),
          unreadCount: 0,
          isBuyer: false,
          isProductEntry: true
        }));

      const allConversations = [...serverConversations, ...productEntries];

      const getTime = (t) => {
        if (!t) return 0;
        if (typeof t === 'object' && t._seconds) return t._seconds * 1000;
        if (typeof t === 'object' && t.seconds) return t.seconds * 1000;
        if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
        if (t instanceof Date) return t.getTime();
        return 0;
      };

      const sorted = allConversations
        .sort((a, b) => getTime(b.lastMessageTime) - getTime(a.lastMessageTime))
        .map(c => ({
          ...c,
          lastTimeText: formatTime(getTime(c.lastMessageTime)),
          displayPreview: c.lastMessage || (c.isProductEntry ? '[等待买家咨询]' : '暂无消息')
        }));

      this.setData({ conversations: sorted });
    } catch (err) {
      console.error('加载会话列表失败:', err);
      wx.showToast('加载消息失败');
    }

    this.setData({ loading: false });
  },

  async openChat(e) {
    const key = e.currentTarget.dataset.key;
    const commodityId = e.currentTarget.dataset.commodityId;
    const isProductEntry = e.currentTarget.dataset.isProductEntry;

    const conversations = this.data.conversations;
    const conv = conversations.find(c => c.key === key || c._id === key);

    if (!conv) return;

    let conversationId = null;
    let sellerOpenid = '';

    if (conv.isProductEntry) {
      conversationId = null;
      sellerOpenid = conv.otherOpenid || '';
    } else {
      conversationId = conv._id;
    }

    const userInfo = wx.getStorageSync('userInfo') || {};
    const isOwner = !conv.isBuyer || conv.isProductEntry;

    const chatData = {
      conversationId: conversationId,
      commodityId: conv.commodityId || commodityId,
      sellerName: conv.otherName || '卖家',
      sellerAvatar: conv.otherAvatar || '',
      sellerContact: isOwner ? (userInfo.contact || '') : '',
      sellerPayCode: isOwner ? (userInfo.payCodeUrl || '') : '',
      productTitle: conv.commodityTitle || '',
      productPrice: conv.commodityPrice || '',
      productImage: conv.commodityImage || '',
      sellerOpenid: sellerOpenid,
      isOwner: isOwner,
      myPayCode: userInfo.payCodeUrl || ''
    };

    wx.setStorageSync('chatData', chatData);
    wx.navigateTo({ url: '/pages/chat/chat' });
  },

  onPullDownRefresh() {
    this.loadAllConversations().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  goHome() {
    wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
  }
});