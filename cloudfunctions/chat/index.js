const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

const BUYER_MSG_LIMIT = 20;

exports.main = async (event, context) => {
  const { action, data, id } = event;
  const wxContext = cloud.getWXContext();
  const currentOpenid = wxContext.OPENID;

  if (action === 'createConversation') {
    const { commodityId, commodityTitle, commodityImage, commodityPrice, sellerOpenid, sellerName, sellerAvatar, sellerContact, sellerPayCode } = data;

    console.log('[Chat] createConversation params:', { commodityId, sellerOpenid, currentOpenid });

    if (!commodityId || !sellerOpenid) {
      return { code: -1, msg: '参数不完整' };
    }
    if (currentOpenid === sellerOpenid) {
      return { code: -1, msg: '不能与自己聊天' };
    }

    try {
      const existRes = await db.collection('conversations')
        .where({
          commodityId,
          buyerOpenid: currentOpenid,
          sellerOpenid
        })
        .limit(1)
        .get();

      if (existRes.data.length > 0) {
        console.log('[Chat] 会话已存在:', existRes.data[0]._id);
        return { code: 0, data: existRes.data[0], msg: '会话已存在' };
      }

      const newConv = {
        commodityId,
        commodityTitle: commodityTitle || '',
        commodityImage: commodityImage || '',
        commodityPrice: commodityPrice || 0,
        buyerOpenid: currentOpenid,
        sellerOpenid,
        sellerName: sellerName || '',
        sellerAvatar: sellerAvatar || '',
        sellerContact: sellerContact || '',
        sellerPayCode: sellerPayCode || '',
        buyerName: '',
        buyerAvatar: '',
        lastMessage: '',
        lastMessageType: 'text',
        lastMessageTime: db.serverDate(),
        unreadBuyer: 0,
        unreadSeller: 0,
        status: 'active',
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      };

      const res = await db.collection('conversations').add({ data: newConv });
      console.log('[Chat] 创建会话成功:', res._id);

      return { code: 0, data: { _id: res._id, ...newConv }, msg: '创建成功' };
    } catch (err) {
      console.error('[Chat] createConversation error:', err);
      if (err.errCode === -502003) {
        return { code: -1, msg: '聊天功能未初始化，请联系管理员' };
      }
      return { code: -1, msg: '创建会话失败：' + (err.errMsg || err.message || '未知错误') };
    }
  }

  if (action === 'getConversationList') {
    const res = await db.collection('conversations')
      .where(_.or([
        { buyerOpenid: currentOpenid },
        { sellerOpenid: currentOpenid }
      ]))
      .orderBy('lastMessageTime', 'desc')
      .get();

    // 收集所有 cloud:// fileID
    const fileIDs = [];
    res.data.forEach(conv => {
      if (conv.commodityImage && typeof conv.commodityImage === 'string' && conv.commodityImage.startsWith('cloud://')) {
        fileIDs.push(conv.commodityImage);
      }
      const isBuyer = conv.buyerOpenid === currentOpenid;
      const avatar = isBuyer ? conv.sellerAvatar : conv.buyerAvatar;
      if (avatar && typeof avatar === 'string' && avatar.startsWith('cloud://')) {
        fileIDs.push(avatar);
      }
    });

    let urlMap = {};
    if (fileIDs.length > 0) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: fileIDs });
        (tempRes.fileList || []).forEach(f => {
          if (f.status === 0 || f.fileID) {
            urlMap[f.fileID] = f.tempFileURL || f.fileID;
          }
        });
      } catch (err) {
        console.error('getTempFileURL error:', err);
      }
    }

    const list = res.data.map(conv => {
      const isBuyer = conv.buyerOpenid === currentOpenid;
      const otherName = isBuyer ? (conv.sellerName || '卖家') : (conv.buyerName || '买家');
      const otherAvatar = urlMap[isBuyer ? conv.sellerAvatar : conv.buyerAvatar] || (isBuyer ? conv.sellerAvatar : conv.buyerAvatar);
      const unreadCount = isBuyer ? (conv.unreadBuyer || 0) : (conv.unreadSeller || 0);

      return {
        _id: conv._id,
        commodityId: conv.commodityId,
        commodityTitle: conv.commodityTitle,
        commodityImage: urlMap[conv.commodityImage] || conv.commodityImage,
        commodityPrice: conv.commodityPrice,
        otherName,
        otherAvatar,
        lastMessage: conv.lastMessage,
        lastMessageType: conv.lastMessageType,
        lastMessageTime: conv.lastMessageTime,
        unreadCount,
        isBuyer
      };
    });

    return { code: 0, data: list };
  }

  if (action === 'getConversationDetail') {
    if (!id) return { code: -1, msg: '缺少会话ID' };

    const convRes = await db.collection('conversations').doc(id).get();
    const conv = convRes.data;

    if (!conv) return { code: -1, msg: '会话不存在' };
    if (conv.buyerOpenid !== currentOpenid && conv.sellerOpenid !== currentOpenid) {
      return { code: -1, msg: '无权查看' };
    }

    const messagesRes = await db.collection('messages')
      .where({ conversationId: id })
      .orderBy('createTime', 'asc')
      .limit(100)
      .get();

    const isBuyer = conv.buyerOpenid === currentOpenid;

    const rawMessages = messagesRes.data.map(m => ({
      _id: m._id,
      senderOpenid: m.senderOpenid,
      senderName: m.senderName || '',
      senderAvatar: m.senderAvatar || '',
      type: m.type,
      content: m.content,
      isSelf: m.senderOpenid === currentOpenid,
      createTime: m.createTime
    }));

    const fileIDs = [];
    rawMessages.forEach(m => {
      if (typeof m.content === 'string' && m.content.startsWith('cloud://')) {
        fileIDs.push(m.content);
      }
    });
    const conversationImage = conv.commodityImage;
    if (conversationImage && typeof conversationImage === 'string' && conversationImage.startsWith('cloud://')) {
      fileIDs.push(conversationImage);
    }
    const otherAvatar = isBuyer ? conv.sellerAvatar : conv.buyerAvatar;
    if (otherAvatar && typeof otherAvatar === 'string' && otherAvatar.startsWith('cloud://')) {
      fileIDs.push(otherAvatar);
    }
    if (isBuyer && conv.sellerPayCode && typeof conv.sellerPayCode === 'string' && conv.sellerPayCode.startsWith('cloud://')) {
      fileIDs.push(conv.sellerPayCode);
    }

    let urlMap = {};
    if (fileIDs.length > 0) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: fileIDs });
        (tempRes.fileList || []).forEach(f => {
          if (f.status === 0 || f.fileID) {
            urlMap[f.fileID] = f.tempFileURL || f.fileID;
          }
        });
      } catch (err) {
        console.error('getTempFileURL error:', err);
      }
    }

    const convertedMessages = rawMessages.map(m => {
      if (urlMap[m.content]) {
        return { ...m, content: urlMap[m.content] };
      }
      return m;
    });

    const convertedCommodityImage = urlMap[conversationImage] || conversationImage;
    const convertedOtherAvatar = urlMap[otherAvatar] || otherAvatar;

    const conversationData = {
      _id: conv._id,
      commodityId: conv.commodityId,
      commodityTitle: conv.commodityTitle,
      commodityImage: convertedCommodityImage,
      commodityPrice: conv.commodityPrice,
      otherName: isBuyer ? (conv.sellerName || '卖家') : (conv.buyerName || '买家'),
      otherAvatar: convertedOtherAvatar,
      isBuyer,
      unreadCount: isBuyer ? (conv.unreadBuyer || 0) : (conv.unreadSeller || 0)
    };

    if (isBuyer) {
      conversationData.sellerContact = conv.sellerContact || '';
      conversationData.sellerPayCode = conv.sellerPayCode || '';
      conversationData.sellerPayCodeUrl = urlMap[conv.sellerPayCode] || conv.sellerPayCode || '';
    }

    return {
      code: 0,
      data: {
        conversation: conversationData,
        messages: convertedMessages
      }
    };
  }

  if (action === 'sendMessage') {
    const { conversationId, type, content } = data;

    if (!conversationId || !type || !content) {
      return { code: -1, msg: '参数不完整' };
    }
    if (!['text', 'image', 'video', 'paycode'].includes(type)) {
      return { code: -1, msg: '不支持的消息类型' };
    }

    const convRes = await db.collection('conversations').doc(conversationId).get();
    const conv = convRes.data;

    if (!conv) return { code: -1, msg: '会话不存在' };
    if (conv.buyerOpenid !== currentOpenid && conv.sellerOpenid !== currentOpenid) {
      return { code: -1, msg: '无权发送' };
    }

    const isBuyer = conv.buyerOpenid === currentOpenid;
    const otherOpenid = isBuyer ? conv.sellerOpenid : conv.buyerOpenid;

    if (isBuyer) {
      const sellerReplyRes = await db.collection('messages')
        .where({
          conversationId,
          senderOpenid: conv.sellerOpenid
        })
        .limit(1)
        .get();

      if (sellerReplyRes.data.length === 0) {
        const buyerMsgCount = await db.collection('messages')
          .where({
            conversationId,
            senderOpenid: currentOpenid
          })
          .count();

        if (buyerMsgCount.total >= BUYER_MSG_LIMIT) {
          return { code: -1, msg: `您已发送${BUYER_MSG_LIMIT}条消息，请等待卖家回复` };
        }
      }
    }

    const userRes = await db.collection('user')
      .where({ _openid: currentOpenid })
      .get();
    const userInfo = userRes.data[0] || {};

    const newMessage = {
      conversationId,
      senderOpenid: currentOpenid,
      senderName: userInfo.nickName || '',
      senderAvatar: userInfo.avatarUrl || '',
      type,
      content,
      createTime: db.serverDate()
    };

    const msgRes = await db.collection('messages').add({ data: newMessage });

    const lastMessagePreview = type === 'text'
      ? (content.length > 50 ? content.substring(0, 50) + '...' : content)
      : type === 'image' ? '[图片]' : type === 'paycode' ? '[收款码]' : '[视频]';

    const updateData = {
      lastMessage: lastMessagePreview,
      lastMessageType: type,
      lastMessageTime: db.serverDate(),
      updateTime: db.serverDate()
    };

    if (isBuyer) {
      updateData.unreadSeller = _.inc(1);
      if (!conv.buyerName) updateData.buyerName = userInfo.nickName || '';
      if (!conv.buyerAvatar) updateData.buyerAvatar = userInfo.avatarUrl || '';
    } else {
      updateData.unreadBuyer = _.inc(1);
      if (!conv.sellerName) updateData.sellerName = userInfo.nickName || '';
      if (!conv.sellerAvatar) updateData.sellerAvatar = userInfo.avatarUrl || '';
    }

    await db.collection('conversations').doc(conversationId).update({ data: updateData });

    let returnContent = content;
    if (typeof content === 'string' && content.startsWith('cloud://')) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: [content] });
        if (tempRes.fileList && tempRes.fileList.length > 0 && tempRes.fileList[0].status === 0) {
          returnContent = tempRes.fileList[0].tempFileURL || content;
        }
      } catch (err) {
        console.error('getTempFileURL error:', err);
      }
    }

    return {
      code: 0,
      data: {
        _id: msgRes._id,
        ...newMessage,
        content: returnContent,
        isSelf: true
      },
      msg: '发送成功'
    };
  }

  if (action === 'markAsRead') {
    if (!id) return { code: -1, msg: '缺少会话ID' };

    const convRes = await db.collection('conversations').doc(id).get();
    const conv = convRes.data;

    if (!conv) return { code: -1, msg: '会话不存在' };

    const isBuyer = conv.buyerOpenid === currentOpenid;

    if (isBuyer) {
      await db.collection('conversations').doc(id).update({
        data: { unreadBuyer: 0 }
      });
    } else {
      await db.collection('conversations').doc(id).update({
        data: { unreadSeller: 0 }
      });
    }

    return { code: 0, msg: '已标记为已读' };
  }

  if (action === 'deleteConversation') {
    if (!id) return { code: -1, msg: '缺少会话ID' };

    const convRes = await db.collection('conversations').doc(id).get();
    const conv = convRes.data;

    if (!conv) return { code: -1, msg: '会话不存在' };
    if (conv.buyerOpenid !== currentOpenid && conv.sellerOpenid !== currentOpenid) {
      return { code: -1, msg: '无权删除' };
    }

    await db.collection('messages').where({ conversationId: id }).remove();
    await db.collection('conversations').doc(id).remove();

    return { code: 0, msg: '删除成功' };
  }

  if (action === 'init') {
    try {
      await db.collection('conversations').limit(1).get();
      await db.collection('messages').limit(1).get();
      return { code: 0, msg: '聊天服务正常' };
    } catch (err) {
      if (err.errCode === -502003) {
        return {
          code: -1,
          msg: '聊天集合不存在，请在云开发控制台创建 conversations 和 messages 集合',
          detail: err.errMsg
        };
      }
      return { code: -1, msg: '初始化失败：' + (err.errMsg || err.message) };
    }
  }

  return { code: -1, msg: '未知操作' };
};