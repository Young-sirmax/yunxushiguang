const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

exports.main = async (event, context) => {
  // 定时清理：删除30天前的已取消交易和已删除商品
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 清理已取消的交易
  const cancelledTrans = await db.collection('transaction')
    .where({ status: 'cancelled', updateTime: db.command.lt(thirtyDaysAgo) })
    .get();

  for (let t of cancelledTrans.data) {
    await db.collection('transaction').doc(t._id).remove();
  }

  return { code: 0, msg: `清理完成，共删除 ${cancelledTrans.data.length} 条记录` };
};
