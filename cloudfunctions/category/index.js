const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action } = event;

  if (action === 'list') {
    const res = await db.collection('category').orderBy('sort', 'asc').get();
    return { code: 0, data: res.data };
  }

  return { code: -1, msg: '未知操作' };
};
