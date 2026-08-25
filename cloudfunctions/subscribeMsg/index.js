const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });

exports.main = async (event, context) => {
  const { action, templateId, openid, data, page } = event;

  if (action === 'send') {
    try {
      const res = await cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId: templateId || 'YOUR_SUBSCRIBE_MSG_TEMPLATE_ID',
        page: page || '/pages/home_transaction/home_transaction',
        data: data || {}
      });
      return { code: 0, data: res, msg: '发送成功' };
    } catch (err) {
      console.error('发送订阅消息失败:', err);
      return { code: -1, msg: '发送失败', error: err.message };
    }
  }

  return { code: -1, msg: '未知操作' };
};
