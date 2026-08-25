// pages/chat/chat.js
const app = getApp();
const API = require('../../api/api.js');
const { showToast } = require('../../utils/util.js');

const EMOJI_LIST = [
  '😀', '😁', '😄', '😆', '😊', '😍', '😘', '😜',
  '🤗', '🤔', '😴', '😷', '😎', '🤓', '😕', '😟',
  '🙁', '☹', '😮', '😯', '😲', '😳', '😱', '😨',
  '😰', '😥', '😢', '😭', '😤', '😡', '😠', '😈',
  '👿', '💀', '☠', '💩', '🤡', '👹', '👺', '👻',
  '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼',
  '😽', '🙀', '😿', '😾', '👍', '👎', '👌', '✌',
  '🤞', '🤟', '🤘', '👏', '🙌', '👐', '🤲', '🙏'
];

const TIME_GAP = 5 * 60 * 1000;
const POLL_INTERVAL = 5000;

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
  const dayAfterYesterdayStart = todayStart - 2 * 24 * 60 * 60 * 1000;

  if (date.getTime() >= todayStart) {
    return hhmm;
  } else if (date.getTime() >= yesterdayStart) {
    return '昨天 ' + hhmm;
  } else if (date.getTime() >= dayAfterYesterdayStart) {
    const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return weekDays[date.getDay()] + ' ' + hhmm;
  } else if (date.getFullYear() === now.getFullYear()) {
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + hhmm;
  } else {
    return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + hhmm;
  }
}

function buildDisplayMessages(rawMessages) {
  const result = [];
  let lastTime = 0;

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];
    const createTime = msg.createTime || 0;

    if (i === 0 || createTime - lastTime > TIME_GAP) {
      result.push({
        id: 'time-' + (createTime || Date.now()) + '-' + i,
        isTimeDivider: true,
        text: formatTime(createTime || Date.now())
      });
    }

    result.push({
      ...msg,
      isTimeDivider: false
    });

    lastTime = createTime;
  }

  return result;
}

function mapServerMessage(serverMsg) {
  const base = {
    id: serverMsg._id || serverMsg.id,
    isSelf: serverMsg.isSelf,
    type: serverMsg.type,
    createTime: serverMsg.createTime ? new Date(serverMsg.createTime).getTime() : Date.now()
  };

  if (serverMsg.type === 'text') {
    base.text = serverMsg.content || '';
  } else if (serverMsg.type === 'paycode') {
    base.payCodeUrl = serverMsg.content || '';
    base.text = '收款码';
  } else if (serverMsg.type === 'image') {
    base.imageUrl = serverMsg.content || '';
    base.text = '[图片]';
  } else {
    base.text = serverMsg.content || '';
  }

  return base;
}

Page({
  data: {
    sellerName: '',
    sellerAvatar: '',
    sellerContact: '',
    sellerPayCode: '',
    productInfo: {},
    userAvatar: '',
    isOwner: false,
    myPayCode: '',
    inputText: '',
    isVoiceMode: false,
    showMore: false,
    showEmoji: false,
    emojiList: EMOJI_LIST,
    messages: [],
    scrollToId: '',
    loading: false
  },

  onLoad(options) {
    const chatData = wx.getStorageSync('chatData') || {};

    this.conversationId = chatData.conversationId || null;
    this.sellerOpenid = chatData.sellerOpenid || '';
    this.commodityId = chatData.commodityId || '';

    const sellerName = chatData.sellerName || '卖家';
    const sellerAvatar = chatData.sellerAvatar || '';
    const sellerContact = chatData.sellerContact || '';
    const sellerPayCode = chatData.sellerPayCode || '';
    const productTitle = chatData.productTitle || '商品';
    const productPrice = chatData.productPrice || '';
    const productImage = chatData.productImage || '';
    const isOwner = chatData.isOwner || false;
    const myPayCode = chatData.myPayCode || '';

    const userInfo = wx.getStorageSync('userInfo') || {};
    const finalMyPayCode = myPayCode || userInfo.payCodeUrl || '';

    this.setData({
      sellerName,
      sellerAvatar,
      sellerContact,
      sellerPayCode: sellerPayCode || (userInfo.payCodeUrl || ''),
      userAvatar: userInfo.avatarUrl || '/images/default-avatar.png',
      isOwner,
      myPayCode: finalMyPayCode,
      productInfo: {
        title: productTitle,
        price: productPrice,
        image: productImage,
        commodityId: this.commodityId
      }
    });

    wx.setNavigationBarTitle({ title: sellerName });

    this.initChat();
  },

  async initChat() {
    this.setData({ loading: true });

    try {
      if (!this.conversationId) {
        const userInfo = wx.getStorageSync('userInfo') || {};
        const currentOpenid = wx.getStorageSync('openid');

        if (this.sellerOpenid && this.sellerOpenid !== currentOpenid) {
          const res = await API.chatCreateConversation({
            commodityId: this.commodityId,
            commodityTitle: this.data.productInfo.title,
            commodityImage: this.data.productInfo.image,
            commodityPrice: this.data.productInfo.price,
            sellerOpenid: this.sellerOpenid,
            sellerName: this.data.sellerName,
            sellerAvatar: this.data.sellerAvatar,
            sellerContact: this.data.sellerContact,
            sellerPayCode: this.data.sellerPayCode
          });

          if (res.code === 0) {
            this.conversationId = res.data._id;
          } else {
            showToast(res.msg || '创建会话失败');
            this.setData({ loading: false });
            return;
          }
        } else {
          this.startSellerPolling();
          this.setData({ loading: false });
          return;
        }
      }

      await this.loadConversationDetail();
      this.startPolling();
    } catch (err) {
      console.error('初始化聊天失败:', err);
      showToast('加载失败');
    }

    this.setData({ loading: false });
  },

  startSellerPolling() {
    this._sellerPollTimer = setInterval(async () => {
      try {
        const res = await API.chatGetConversationList();
        if (res.code === 0) {
          const found = (res.data || []).find(c => c.commodityId === this.commodityId);
          if (found) {
            this.conversationId = found._id;
            const updateData = {
              sellerName: found.otherName || this.data.sellerName,
              sellerAvatar: found.otherAvatar || this.data.sellerAvatar
            };
            if (found.commodityTitle) {
              updateData['productInfo.title'] = found.commodityTitle;
            }
            if (found.commodityPrice) {
              updateData['productInfo.price'] = found.commodityPrice;
            }
            if (found.commodityImage) {
              updateData['productInfo.image'] = found.commodityImage;
            }
            this.setData(updateData);
            wx.setNavigationBarTitle({ title: found.otherName || this.data.sellerName });
            this.stopSellerPolling();
            await this.loadConversationDetail();
            this.startPolling();
          }
        }
      } catch (err) {
        console.error('检查新会话失败:', err);
      }
    }, POLL_INTERVAL);
  },

  stopSellerPolling() {
    if (this._sellerPollTimer) {
      clearInterval(this._sellerPollTimer);
      this._sellerPollTimer = null;
    }
  },

  async loadConversationDetail() {
    if (!this.conversationId) return;

    try {
      const res = await API.chatGetConversationDetail(this.conversationId);
      if (res.code === 0) {
        const { conversation, messages } = res.data;

        const updateData = {};

        if (conversation.otherName) {
          updateData.sellerName = conversation.otherName;
          updateData.sellerAvatar = conversation.otherAvatar || this.data.sellerAvatar;
          wx.setNavigationBarTitle({ title: conversation.otherName });
        }

        if (conversation.sellerContact) {
          updateData.sellerContact = conversation.sellerContact;
        }
        if (conversation.sellerPayCodeUrl) {
          updateData.sellerPayCode = conversation.sellerPayCodeUrl;
        } else if (conversation.sellerPayCode) {
          updateData.sellerPayCode = conversation.sellerPayCode;
        }

        if (Object.keys(updateData).length > 0) {
          this.setData(updateData);
        }

        const mappedMessages = (messages || []).map(mapServerMessage);
        const displayMessages = buildDisplayMessages(mappedMessages);

        this.setData({
          messages: displayMessages,
          scrollToId: displayMessages.length > 0 ? displayMessages[displayMessages.length - 1].id : ''
        });

        if (conversation.unreadCount > 0) {
          API.chatMarkAsRead(this.conversationId).catch(() => {});
        }
      }
    } catch (err) {
      console.error('加载会话详情失败:', err);
    }
  },

  startPolling() {
    this._pollTimer = setInterval(() => {
      this.loadConversationDetail();
    }, POLL_INTERVAL);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  onShow() {
    const userInfo = wx.getStorageSync('userInfo') || {};
    if (userInfo.payCodeUrl && userInfo.payCodeUrl !== this.data.myPayCode) {
      this.setData({ myPayCode: userInfo.payCodeUrl });
    }
    if (this.conversationId) {
      API.chatMarkAsRead(this.conversationId).catch(() => {});
      this.loadConversationDetail();
    }
  },

  onHide() {
    this.stopPolling();
    this.stopSellerPolling();
  },

  onUnload() {
    this.stopPolling();
    this.stopSellerPolling();
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async sendMessage() {
    const text = this.data.inputText.trim();
    if (!text) return;
    if (!this.conversationId) {
      showToast('会话未就绪，请稍候');
      return;
    }

    const tempMsg = {
      id: 'temp-' + Date.now(),
      isSelf: true,
      type: 'text',
      text: text,
      createTime: Date.now()
    };

    const rawMessages = this.getRawMessages();
    rawMessages.push(tempMsg);
    this.setData({
      messages: buildDisplayMessages(rawMessages),
      scrollToId: tempMsg.id,
      inputText: '',
      showMore: false,
      showEmoji: false
    });

    try {
      const res = await API.chatSendMessage({
        conversationId: this.conversationId,
        type: 'text',
        content: text
      });

      if (res.code === 0) {
        this.loadConversationDetail();
      } else {
        showToast(res.msg || '发送失败');
        this.loadConversationDetail();
      }
    } catch (err) {
      console.error('发送消息失败:', err);
      showToast('发送失败，请重试');
      this.loadConversationDetail();
    }
  },

  async sendPayCodeMessage() {
    let payCode = this.data.myPayCode;

    if (!payCode) {
      const userInfo = wx.getStorageSync('userInfo') || {};
      payCode = userInfo.payCodeUrl || '';
      if (payCode) {
        this.setData({ myPayCode: payCode });
      }
    }

    if (!payCode) {
      wx.showModal({
        title: '还未上传收款码',
        content: '请先在"我的"页面上传收款码',
        confirmText: '去上传',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/home_user_info/home_user_info' });
          }
        }
      });
      return;
    }

    if (!this.conversationId) {
      showToast('会话未就绪');
      return;
    }

    wx.showLoading({ title: '发送中...', mask: true });

    try {
      let finalPayCode = payCode;

      if (typeof payCode === 'string' && !payCode.startsWith('cloud://')) {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `paycodes/chat_${this.conversationId}_${Date.now()}.png`,
          filePath: payCode
        });
        finalPayCode = uploadRes.fileID;
        this.setData({ myPayCode: finalPayCode });
        const userInfo = wx.getStorageSync('userInfo') || {};
        userInfo.payCodeUrl = finalPayCode;
        wx.setStorageSync('userInfo', userInfo);
      }

      const res = await API.chatSendMessage({
        conversationId: this.conversationId,
        type: 'paycode',
        content: finalPayCode
      });

      wx.hideLoading();

      if (res.code === 0) {
        wx.showToast({ title: '收款码已发送', icon: 'success' });
        await this.loadConversationDetail();
      } else {
        wx.showToast({ title: res.msg || '发送失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('发送收款码失败:', err);
      wx.showToast({ title: err.message || '发送失败', icon: 'none' });
    }
  },

  async sendTextMessage(text) {
    if (!this.conversationId) {
      showToast('会话未就绪');
      return;
    }
    try {
      const res = await API.chatSendMessage({
        conversationId: this.conversationId,
        type: 'text',
        content: text
      });
      if (res.code === 0) {
        await this.loadConversationDetail();
      } else {
        showToast(res.msg || '发送失败');
      }
    } catch (err) {
      console.error('发送消息失败:', err);
      showToast(err.message || '发送失败');
    }
  },

  getRawMessages() {
    const messages = this.data.messages;
    return messages.filter(m => !m.isTimeDivider);
  },

  toggleVoice() {
    this.setData({
      isVoiceMode: !this.data.isVoiceMode,
      showEmoji: false,
      showMore: false
    });
  },

  onVoiceTap() {
    showToast('语音功能开发中');
  },

  toggleEmoji() {
    this.setData({
      showEmoji: !this.data.showEmoji,
      showMore: false
    });
  },

  toggleMore() {
    this.setData({
      showMore: !this.data.showMore,
      showEmoji: false
    });
  },

  insertEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji;
    this.setData({
      inputText: this.data.inputText + emoji
    });
  },

  viewProduct() {
    const id = this.data.productInfo.commodityId;
    if (id) {
      wx.navigateTo({ url: '/pages/commodity_detail/commodity_detail?id=' + id });
    }
  },

  sendImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.uploadAndSendImage(tempFilePath);
      },
      fail: () => {}
    });
  },

  takePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.uploadAndSendImage(tempFilePath);
      },
      fail: () => {}
    });
  },

  uploadAndSendImage(tempFilePath) {
    if (!this.conversationId) {
      showToast('会话未就绪');
      return;
    }

    const ext = tempFilePath.split('.').pop() || 'jpg';
    const cloudPath = `chat_${this.conversationId}_${Date.now()}.${ext}`;

    wx.showLoading({ title: '上传中...', mask: true });

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: (res) => {
        wx.hideLoading();
        this.sendImageMessage(res.fileID);
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('上传图片失败:', err);
        showToast('上传失败');
      }
    });
  },

  async sendImageMessage(fileID) {
    try {
      const res = await API.chatSendMessage({
        conversationId: this.conversationId,
        type: 'image',
        content: fileID
      });

      if (res.code === 0) {
        this.setData({ showMore: false });
        this.loadConversationDetail();
      } else {
        showToast(res.msg || '发送失败');
      }
    } catch (err) {
      console.error('发送图片失败:', err);
      showToast('发送失败');
    }
  },

  sendContact() {
    showToast('位置功能开发中');
  },

  copyContact() {
    let contact = this.data.sellerContact;
    if (!contact && this.data.isOwner) {
      const userInfo = wx.getStorageSync('userInfo') || {};
      contact = userInfo.contact || '';
    }
    if (!contact) {
      showToast('暂无联系方式');
      return;
    }
    wx.setClipboardData({
      data: String(contact),
      success: () => {
        showToast('联系方式已复制');
      }
    });
  },

  showPayCode() {
    if (!this.conversationId) {
      showToast('暂无买家咨询，无法出示收款码');
      return;
    }
    this.sendPayCodeMessage();
  },

  requestPayCode() {
    if (!this.conversationId) {
      showToast('会话未就绪');
      return;
    }
    this.sendTextMessage('请发一下收款码~');
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    const allUrls = this.data.messages
      .filter(m => !m.isTimeDivider && m.type === 'image' && m.imageUrl)
      .map(m => m.imageUrl);
    const urls = allUrls.length > 0 ? allUrls : [url];
    wx.previewImage({
      current: url,
      urls: urls
    });
  },

  previewPayCode(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({
      current: url,
      urls: [url]
    });
  },

  onShareAppMessage() {
    return {
      title: `与${this.data.sellerName}的聊天`,
      path: '/pages/commodity_list/commodity_list'
    };
  }
});