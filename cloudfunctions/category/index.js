const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

// 分类展示顺序偏好：命中者按此顺序置前，其余保持原有 sort 顺序
// （不改数据库，避免依赖控制台手工调整 sort）
const PREFERRED_ORDER = [/书|教材/, /数码|电子/];

function applyPreferredOrder(list) {
  const rest = (list || []).slice();
  const picked = [];
  PREFERRED_ORDER.forEach(regexp => {
    const index = rest.findIndex(item => regexp.test(item && item.name ? item.name : ''));
    if (index > -1) picked.push(rest.splice(index, 1)[0]);
  });
  return picked.concat(rest);
}

exports.main = async (event, context) => {
  const { action } = event;

  if (action === 'list') {
    const res = await db.collection('category').orderBy('sort', 'asc').get();
    return { code: 0, data: applyPreferredOrder(res.data) };
  }

  return { code: -1, msg: '未知操作' };
};
