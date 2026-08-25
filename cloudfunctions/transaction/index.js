const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action, id, data, page = 1, pageSize = 10, buyerId, sellerId, userId } = event;
  const wxContext = cloud.getWXContext();

  if (action === 'create') {
    const newData = {
      ...data,
      buyerId: wxContext.OPENID,
      status: 'pending',
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    const res = await db.collection('transaction').add({ data: newData });
    return { code: 0, data: { _id: res._id }, msg: '交易发起成功' };
  }

  if (action === 'list') {
    let where = {};
    if (buyerId) where.buyerId = buyerId;
    if (sellerId) where.sellerId = sellerId;
    if (userId) where = _.or([{ buyerId: userId }, { sellerId: userId }]);

    const totalRes = await db.collection('transaction').where(where).count();
    const res = await db.collection('transaction')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();
    return { code: 0, data: res.data, total: totalRes.total };
  }

  if (action === 'detail') {
    const res = await db.collection('transaction').doc(id).get();
    if (!res.data) return { code: -1, msg: '交易不存在' };
    return { code: 0, data: res.data };
  }

  if (action === 'update') {
    await db.collection('transaction').doc(id).update({
      data: { ...data, updateTime: db.serverDate() }
    });

    // 如果确认交易，标记商品为已售出
    if (data.status === 'confirmed') {
      const trans = await db.collection('transaction').doc(id).get();
      await db.collection('commodity').doc(trans.data.commodityId).update({
        data: { status: 'sold', updateTime: db.serverDate() }
      });
    }

    return { code: 0, msg: '更新成功' };
  }

  // === 买方对卖方评分 ===
  if (action === 'rateSeller') {
    const { rating, comment } = data;
    if (!rating || rating < 1 || rating > 5) {
      return { code: -1, msg: '评分需在1-5星之间' };
    }

    const existRes = await db.collection('transaction').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '交易不存在' };
    }
    const trans = existRes.data;

    // 只有买方可以评分
    if (trans.buyerId !== wxContext.OPENID) {
      return { code: -1, msg: '只有买方可以评分' };
    }
    // 只有已完成的交易可以评分
    if (trans.status !== 'completed') {
      return { code: -1, msg: '交易完成后才能评分' };
    }
    // 不能重复评分
    if (trans.hasRated) {
      return { code: -1, msg: '已评分过，不能重复评分' };
    }

    // 写入评分记录
    await db.collection('seller_ratings').add({
      data: {
        transactionId: id,
        sellerId: trans.sellerId,
        buyerId: wxContext.OPENID,
        rating: parseInt(rating),
        comment: comment || '',
        commodityTitle: trans.commodityTitle || '',
        createTime: db.serverDate()
      }
    });

    // 标记交易已评分
    await db.collection('transaction').doc(id).update({
      data: {
        hasRated: true,
        sellerRating: parseInt(rating),
        updateTime: db.serverDate()
      }
    });

    return { code: 0, msg: '评分成功' };
  }

  // === 查询卖方信用评级（合并交易+仓储信用） ===
  if (action === 'getSellerCredit') {
    const targetId = event.sellerId || wxContext.OPENID;

    // 并行查询：交易评分 + 仓储评分
    const [sellerRes, warehouseRes] = await Promise.all([
      db.collection('seller_ratings')
        .where({ sellerId: targetId })
        .orderBy('createTime', 'desc')
        .limit(100)
        .get()
        .catch(() => ({ data: [] })),
      db.collection('warehouse_ratings')
        .where({ providerId: targetId })
        .orderBy('createTime', 'desc')
        .limit(100)
        .get()
        .catch(() => ({ data: [] }))
    ]);

    const sellerRatings = (sellerRes.data || []).map(r => ({
      ...r,
      source: 'seller',
      sourceLabel: '交易业务'
    }));
    const warehouseRatings = (warehouseRes.data || []).map(r => ({
      ...r,
      source: 'warehouse',
      sourceLabel: '仓储业务'
    }));

    const allRatings = [...sellerRatings, ...warehouseRatings];

    if (allRatings.length === 0) {
      return {
        code: 0,
        data: {
          totalRatings: 0,
          warehouseRatingsCount: 0,
          sellerRatingsCount: 0,
          avgRating: 0,
          creditLevel: 0,
          creditLabel: '暂无评级',
          stars: 0,
          hasNoHistory: true,
          ratingList: []
        }
      };
    }

    // 按时间倒序
    allRatings.sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
      return tb - ta;
    });

    const totalScore = allRatings.reduce((sum, r) => sum + r.rating, 0);
    const avgRating = totalScore / allRatings.length;

    let creditLevel = 1;
    let creditLabel = '一星';
    if (avgRating >= 4.5) {
      creditLevel = 5; creditLabel = '五星';
    } else if (avgRating >= 3.5) {
      creditLevel = 4; creditLabel = '四星';
    } else if (avgRating >= 2.5) {
      creditLevel = 3; creditLabel = '三星';
    } else if (avgRating >= 1.5) {
      creditLevel = 2; creditLabel = '二星';
    }

    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    allRatings.forEach(r => {
      const s = Math.round(r.rating);
      if (distribution[s] !== undefined) distribution[s]++;
    });

    return {
      code: 0,
      data: {
        totalRatings: allRatings.length,
        warehouseRatingsCount: warehouseRatings.length,
        sellerRatingsCount: sellerRatings.length,
        avgRating: Math.round(avgRating * 10) / 10,
        creditLevel,
        creditLabel: creditLabel + '信用',
        stars: creditLevel,
        hasNoHistory: false,
        distribution,
        ratingList: allRatings.slice(0, 10).map(r => ({
          rating: r.rating,
          ratingStars: '★★★★★'.substring(0, r.rating),
          comment: r.comment,
          commodityTitle: r.commodityTitle || r.commodityName || '',
          source: r.source,
          sourceLabel: r.sourceLabel,
          createTime: r.createTime
        }))
      }
    };
  }

  return { code: -1, msg: '未知操作' };
};
