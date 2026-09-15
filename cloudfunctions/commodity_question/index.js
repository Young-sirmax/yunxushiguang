const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

async function checkTextSecurity(text, fieldLabel) {
  if (!text || !text.trim()) return { ok: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: text });
    if (res.errCode === 0) return { ok: true };
    return { ok: false, msg: `${fieldLabel || '文本'}包含违规内容，请修改后重试` };
  } catch (err) {
    console.error('[commodity_question] msgSecCheck 异常:', err.errCode, err.errMsg);
    return { ok: false, msg: `${fieldLabel || '文本'}安全检查服务异常，请稍后重试` };
  }
}

exports.main = async (event, context) => {
  const { action, commodityId, data, questionId } = event;
  const wxContext = cloud.getWXContext();

  if (action === 'list') {
    const res = await db.collection('commodity_question')
      .where({ commodityId })
      .orderBy('createTime', 'desc')
      .get();

    // 获取每个问题的回答
    for (let q of res.data) {
      const answers = await db.collection('commodity_answer')
        .where({ questionId: q._id })
        .orderBy('createTime', 'asc')
        .get();
      q.answers = answers.data;
    }

    return { code: 0, data: res.data };
  }

  if (action === 'create') {
    const newData = {
      ...data,
      _openid: wxContext.OPENID,
      createTime: db.serverDate()
    };
    const res = await db.collection('commodity_question').add({ data: newData });
    return { code: 0, data: { _id: res._id }, msg: '提问成功' };
  }

  if (action === 'detail') {
    const res = await db.collection('commodity_question').doc(questionId).get();
    return { code: 0, data: res.data };
  }

  return { code: -1, msg: '未知操作' };
};
