const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action, questionId, data } = event;
  const wxContext = cloud.getWXContext();

  if (action === 'list') {
    const res = await db.collection('commodity_answer')
      .where({ questionId })
      .orderBy('createTime', 'asc')
      .get();
    return { code: 0, data: res.data };
  }

  if (action === 'create') {
    // 获取提问者信息
    const question = await db.collection('commodity_question').doc(data.questionId).get();
    const user = await db.collection('user').where({ _openid: wxContext.OPENID }).get();

    const newData = {
      ...data,
      _openid: wxContext.OPENID,
      answererName: user.data[0] ? user.data[0].nickName : '匿名',
      createTime: db.serverDate()
    };
    const res = await db.collection('commodity_answer').add({ data: newData });
    return { code: 0, data: { _id: res._id }, msg: '回复成功' };
  }

  return { code: -1, msg: '未知操作' };
};
