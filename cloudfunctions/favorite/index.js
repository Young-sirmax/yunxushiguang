const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action, id, data, commodityId, page = 1, pageSize = 20 } = event;
  const wxContext = cloud.getWXContext();
  const currentOpenid = wxContext.OPENID;

  if (action === 'toggle') {
    try {
      if (!commodityId) {
        return { code: -1, msg: '商品ID不能为空' };
      }

      const existRes = await db.collection('favorites')
        .where({
          _openid: currentOpenid,
          commodityId
        })
        .get();

      if (existRes.data && existRes.data.length > 0) {
        const favId = existRes.data[0]._id;
        await db.collection('favorites').doc(favId).remove();
        return { code: 0, data: { isFavorited: false }, msg: '已取消收藏' };
      }

      const commodityRes = await db.collection('commodity').doc(commodityId).get();
      if (!commodityRes.data) {
        return { code: -1, msg: '商品不存在' };
      }

      const commodity = commodityRes.data;
      const newData = {
        _openid: currentOpenid,
        commodityId,
        commodityTitle: commodity.title || '',
        commodityPrice: commodity.price || 0,
        commodityOriginalPrice: commodity.originalPrice || 0,
        commodityImage: (commodity.images && commodity.images[0]) || '',
        commodityCondition: commodity.condition || '',
        sellerName: commodity.sellerName || '',
        sellerOpenid: commodity._openid || '',
        createTime: db.serverDate()
      };

      const res = await db.collection('favorites').add({ data: newData });
      return { code: 0, data: { isFavorited: true, _id: res._id }, msg: '收藏成功' };
    } catch (err) {
      console.error('收藏操作失败:', err);
      const errCode = err && err.errCode;
      if (errCode === -502003 || (err && err.errMsg && err.errMsg.includes('collection'))) {
        return { code: -1, msg: '收藏集合不存在，请在云开发控制台创建 favorites 集合' };
      }
      if (err.errCode === -1) {
        return { code: -1, msg: '商品不存在' };
      }
      return { code: -1, msg: '操作失败: ' + (err.message || err.errMsg || '未知错误') };
    }
  }

  if (action === 'check') {
    try {
      if (!commodityId) {
        return { code: -1, msg: '商品ID不能为空' };
      }

      const existRes = await db.collection('favorites')
        .where({
          _openid: currentOpenid,
          commodityId
        })
        .get();

      const isFavorited = existRes.data && existRes.data.length > 0;
      const favId = isFavorited ? existRes.data[0]._id : null;

      return { code: 0, data: { isFavorited, favId } };
    } catch (err) {
      console.error('检查收藏状态失败:', err);
      return { code: 0, data: { isFavorited: false, favId: null } };
    }
  }

  if (action === 'list') {
    try {
      const where = { _openid: currentOpenid };

      const totalRes = await db.collection('favorites').where(where).count();
      const listRes = await db.collection('favorites')
        .where(where)
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();

      return { code: 0, data: listRes.data, total: totalRes.total };
    } catch (err) {
      console.error('获取收藏列表失败:', err);
      return { code: 0, data: [], total: 0 };
    }
  }

  if (action === 'remove') {
    try {
      if (!id) {
        return { code: -1, msg: '收藏ID不能为空' };
      }

      const existRes = await db.collection('favorites').doc(id).get();
      if (!existRes.data) {
        return { code: -1, msg: '收藏不存在' };
      }
      if (existRes.data._openid !== currentOpenid) {
        return { code: -1, msg: '无权操作' };
      }

      await db.collection('favorites').doc(id).remove();
      return { code: 0, msg: '已取消收藏' };
    } catch (err) {
      console.error('删除收藏失败:', err);
      return { code: -1, msg: '删除失败: ' + (err.message || '未知错误') };
    }
  }

  return { code: -1, msg: '未知操作' };
};
