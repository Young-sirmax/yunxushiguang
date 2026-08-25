const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action, id, data, status, page = 1, pageSize = 20 } = event;
  const wxContext = cloud.getWXContext();
  const currentOpenid = wxContext.OPENID;

  const convertFileIDs = async (items, imageKey = 'commodityImages') => {
    if (!items || items.length === 0) return items;
    const allFileIDs = [];
    items.forEach(it => {
      const imgs = it[imageKey];
      if (imgs && Array.isArray(imgs)) {
        imgs.forEach(img => {
          if (typeof img === 'string' && img.startsWith('cloud://')) {
            allFileIDs.push(img);
          }
        });
      }
    });
    if (allFileIDs.length === 0) return items;
    try {
      const tempRes = await cloud.getTempFileURL({ fileList: allFileIDs });
      const urlMap = {};
      (tempRes.fileList || []).forEach(f => {
        if (f.status === 0 || f.fileID) {
          urlMap[f.fileID] = f.tempFileURL || f.fileID;
        }
      });
      items.forEach(it => {
        const imgs = it[imageKey];
        if (imgs && Array.isArray(imgs)) {
          it[imageKey] = imgs.map(img => (typeof img === 'string' && urlMap[img]) || img);
        }
      });
    } catch (err) {
      console.error('convertFileIDs error:', err);
    }
    return items;
  };

  if (action === 'create') {
    const requestId = data.requestId;

    if (requestId) {
      const existRes = await db.collection('warehouse_items').where({ requestId }).limit(1).get();
      if (existRes.data && existRes.data.length > 0) {
        return { code: 0, data: { _id: existRes.data[0]._id }, msg: '创建成功' };
      }
    }

    let commodityImages = data.commodityImages || [];

    if (data.commodityId) {
      try {
        const commodityRes = await db.collection('commodity').doc(data.commodityId).get();
        if (commodityRes.data && commodityRes.data.images) {
          commodityImages = commodityRes.data.images.filter(img =>
            typeof img === 'string' && img.startsWith('cloud://')
          );
          if (commodityImages.length === 0) {
            commodityImages = commodityRes.data.images || [];
          }
        }
      } catch (err) {
        console.warn('获取商品原图失败，使用客户端提供的图片:', err.message);
      }
    }

    const newData = {
      commodityId: data.commodityId,
      commodityTitle: data.commodityTitle,
      commodityImages,
      commodityPrice: data.commodityPrice || 0,
      storageType: data.storageType || 'fixed',
      storageFee: data.storageFee || 0,
      compensationAmount: data.compensationAmount || 0,
      storageNotes: data.storageNotes || '',
      _openid: currentOpenid,
      sellerId: currentOpenid,
      status: 'available',
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };

    const res = await db.collection('warehouse_items').add({ data: newData });
    return { code: 0, data: { _id: res._id }, msg: '创建成功' };
  }

  const backfillImages = async (items) => {
    if (!items || items.length === 0) return items;
    for (const item of items) {
      const needsBackfill = !item.commodityImages ||
        item.commodityImages.length === 0 ||
        (item.commodityImages.length === 1 && !item.commodityImages[0]);
      if (needsBackfill && item.commodityId) {
        try {
          const commodityRes = await db.collection('commodity').doc(item.commodityId).get();
          if (commodityRes.data && commodityRes.data.images) {
            item.commodityImages = commodityRes.data.images || [];
          }
        } catch (err) {
          // commodity may have been deleted, skip
        }
      }
    }
    return items;
  };

  if (action === 'list') {
    const where = {};

    if (status) {
      where.status = status;
    }

    if (event.userId) {
      where._openid = event.userId;
    }

    const totalRes = await db.collection('warehouse_items').where(where).count();
    const listRes = await db.collection('warehouse_items')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    let listData = listRes.data.map(item => ({
      ...item,
      commodityImages: item.commodityImages || []
    }));
    listData = await backfillImages(listData);
    const convertedData = await convertFileIDs(listData);

    return { code: 0, data: convertedData, total: totalRes.total };
  }

  if (action === 'mine') {
    const where = { _openid: currentOpenid };
    if (status) {
      where.status = status;
    }

    const totalRes = await db.collection('warehouse_items').where(where).count();
    const listRes = await db.collection('warehouse_items')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    let listData = listRes.data.map(item => ({
      ...item,
      commodityImages: item.commodityImages || []
    }));
    listData = await backfillImages(listData);
    const convertedData = await convertFileIDs(listData);

    return { code: 0, data: convertedData, total: totalRes.total };
  }

  // 查询我作为保管方（provider）的仓储记录
  if (action === 'mineAsProvider') {
    const where = { providerId: currentOpenid };
    if (status) {
      where.status = status;
    }

    const totalRes = await db.collection('warehouse_items').where(where).count();
    const listRes = await db.collection('warehouse_items')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    let listData = listRes.data.map(item => ({
      ...item,
      commodityImages: item.commodityImages || []
    }));
    listData = await backfillImages(listData);
    const convertedData = await convertFileIDs(listData);

    return { code: 0, data: convertedData, total: totalRes.total };
  }

  if (action === 'detail') {
    const res = await db.collection('warehouse_items').doc(id).get();
    if (!res.data) {
      return { code: -1, msg: '仓储记录不存在' };
    }
    let data = res.data;
    data.commodityImages = data.commodityImages || [];
    data = (await backfillImages([data]))[0];
    const converted = await convertFileIDs([data]);
    return { code: 0, data: converted[0] };
  }

  if (action === 'accept') {
    const existRes = await db.collection('warehouse_items').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '仓储记录不存在' };
    }
    if (existRes.data.status !== 'available') {
      return { code: -1, msg: '该仓储委托已被接受或已取消' };
    }
    if (existRes.data._openid === currentOpenid) {
      return { code: -1, msg: '不能接受自己发布的仓储委托' };
    }

    const updateData = {
      status: 'storing',
      providerId: currentOpenid,
      providerName: data ? data.providerName : '',
      providerContact: data ? data.providerContact : '',
      acceptTime: db.serverDate(),
      updateTime: db.serverDate()
    };

    await db.collection('warehouse_items').doc(id).update({ data: updateData });
    return { code: 0, msg: '接受成功' };
  }

  if (action === 'cancel') {
    const existRes = await db.collection('warehouse_items').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '仓储记录不存在' };
    }
    if (existRes.data._openid !== currentOpenid) {
      return { code: -1, msg: '无权操作' };
    }
    if (existRes.data.status !== 'available') {
      return { code: -1, msg: '当前状态无法取消' };
    }

    await db.collection('warehouse_items').doc(id).update({
      data: { status: 'cancelled', updateTime: db.serverDate() }
    });
    return { code: 0, msg: '取消成功' };
  }

  if (action === 'markSold') {
    const existRes = await db.collection('warehouse_items').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '仓储记录不存在' };
    }
    const wh = existRes.data;
    // 委托方或保管方均可标记售出
    if (wh._openid !== currentOpenid && wh.providerId !== currentOpenid) {
      return { code: -1, msg: '无权操作' };
    }
    if (wh.status !== 'storing') {
      return { code: -1, msg: '当前状态无法标记售出' };
    }

    await db.collection('warehouse_items').doc(id).update({
      data: {
        status: 'sold',
        soldTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    return { code: 0, msg: '标记成功' };
  }

  if (action === 'return') {
    const existRes = await db.collection('warehouse_items').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '仓储记录不存在' };
    }
    const wh = existRes.data;
    if (wh._openid !== currentOpenid && wh.providerId !== currentOpenid) {
      return { code: -1, msg: '无权操作' };
    }
    if (wh.status !== 'storing') {
      return { code: -1, msg: '当前状态无法取回' };
    }

    await db.collection('warehouse_items').doc(id).update({
      data: {
        status: 'returned',
        returnTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    return { code: 0, msg: '取回成功' };
  }

  if (action === 'reportDamaged') {
    const existRes = await db.collection('warehouse_items').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '仓储记录不存在' };
    }
    const wh = existRes.data;
    if (wh._openid !== currentOpenid && wh.providerId !== currentOpenid) {
      return { code: -1, msg: '无权操作' };
    }
    if (wh.status !== 'storing') {
      return { code: -1, msg: '当前状态无法上报损坏' };
    }

    await db.collection('warehouse_items').doc(id).update({
      data: {
        status: 'damaged',
        damagedTime: db.serverDate(),
        damageNote: data ? data.damageNote : '',
        updateTime: db.serverDate()
      }
    });
    return { code: 0, msg: '上报成功' };
  }

  if (action === 'update') {
    const existRes = await db.collection('warehouse_items').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '仓储记录不存在' };
    }
    if (existRes.data._openid !== currentOpenid) {
      return { code: -1, msg: '无权操作' };
    }
    if (existRes.data.status !== 'available') {
      return { code: -1, msg: '已接受保管的委托不可编辑' };
    }

    const allowedFields = ['storageType', 'storageFee', 'compensationAmount', 'storageNotes'];
    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }
    updateData.updateTime = db.serverDate();

    await db.collection('warehouse_items').doc(id).update({ data: updateData });
    return { code: 0, msg: '更新成功' };
  }

  if (action === 'delete') {
    const existRes = await db.collection('warehouse_items').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '仓储记录不存在' };
    }
    if (existRes.data._openid !== currentOpenid) {
      return { code: -1, msg: '无权操作' };
    }

    await db.collection('warehouse_items').doc(id).remove();
    return { code: 0, msg: '删除成功' };
  }

  // === 评分：委托方对保管方打分 ===
  if (action === 'rateProvider') {
    const { rating, comment } = data;
    if (!rating || rating < 1 || rating > 5) {
      return { code: -1, msg: '评分需在1-5星之间' };
    }

    const existRes = await db.collection('warehouse_items').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '仓储记录不存在' };
    }
    const wh = existRes.data;
    // 只有委托方可以评分
    if (wh._openid !== currentOpenid) {
      return { code: -1, msg: '只有委托方可以评分' };
    }
    // 只有已完成的订单可以评分（sold / returned / damaged）
    if (!['sold', 'returned', 'damaged'].includes(wh.status)) {
      return { code: -1, msg: '仓储业务结束后才能评分' };
    }
    // 必须有保管方
    if (!wh.providerId) {
      return { code: -1, msg: '该委托无保管方' };
    }
    // 不能重复评分
    if (wh.hasRated) {
      return { code: -1, msg: '已评分过，不能重复评分' };
    }

    // 写入评分记录
    await db.collection('warehouse_ratings').add({
      data: {
        warehouseId: id,
        providerId: wh.providerId,
        raterId: currentOpenid,
        rating: parseInt(rating),
        comment: comment || '',
        commodityTitle: wh.commodityTitle || '',
        createTime: db.serverDate()
      }
    });

    // 标记已评分
    await db.collection('warehouse_items').doc(id).update({
      data: {
        hasRated: true,
        rating: parseInt(rating),
        updateTime: db.serverDate()
      }
    });

    return { code: 0, msg: '评分成功' };
  }

  // === 信用评级：查询某个用户的综合信用 ===
  if (action === 'getCreditRating') {
    const targetId = event.userId || currentOpenid;

    // 并行查询：仓储评分 + 交易评分
    const [warehouseRes, sellerRes] = await Promise.all([
      db.collection('warehouse_ratings')
        .where({ providerId: targetId })
        .orderBy('createTime', 'desc')
        .limit(100)
        .get()
        .catch(() => ({ data: [] })),
      db.collection('seller_ratings')
        .where({ sellerId: targetId })
        .orderBy('createTime', 'desc')
        .limit(100)
        .get()
        .catch(() => ({ data: [] }))
    ]);

    // 合并两类评分，添加 source 标记
    const warehouseRatings = (warehouseRes.data || []).map(r => ({
      ...r,
      source: 'warehouse',
      sourceLabel: '仓储业务'
    }));
    const sellerRatings = (sellerRes.data || []).map(r => ({
      ...r,
      source: 'seller',
      sourceLabel: '交易业务'
    }));

    const allRatings = [...warehouseRatings, ...sellerRatings];

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

    // 按时间倒序排列
    allRatings.sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
      return tb - ta;
    });

    // 计算平均分
    const totalScore = allRatings.reduce((sum, r) => sum + r.rating, 0);
    const avgRating = totalScore / allRatings.length;

    // 信用评级换算（一星到五星）
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

    // 星级分布统计
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
