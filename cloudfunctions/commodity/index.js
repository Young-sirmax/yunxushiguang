const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action, id, data, keyword, categoryId, page = 1, pageSize = 10, sellerId, includeDeleted } = event;

  const convertFileIDs = async (items) => {
    if (!items || items.length === 0) return items;
    const allFileIDs = [];
    items.forEach(it => {
      if (it.images && Array.isArray(it.images)) {
        it.images.forEach(img => {
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
        if (it.images && Array.isArray(it.images)) {
          it.images = it.images.map(img => (typeof img === 'string' && urlMap[img]) || img);
        }
      });
    } catch (err) {
      console.error('convertFileIDs error:', err);
    }
    return items;
  };

  const convertSingleFileIDs = async (item) => {
    if (!item) return item;
    const list = await convertFileIDs([item]);
    return list[0];
  };

  if (action === 'list') {
    let where = {};
    if (sellerId) {
      where._openid = sellerId;
      if (!includeDeleted) {
        where.status = _.neq('deleted');
      }
    } else {
      where.status = 'onSale';
    }
    if (categoryId) where.categoryId = categoryId;

    const totalRes = await db.collection('commodity').where(where).count();
    const listRes = await db.collection('commodity')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    const listData = listRes.data.map(item => ({
      ...item,
      images: item.images || [],
      status: item.status || 'onSale'
    }));

    const convertedData = await convertFileIDs(listData);

    const sellerOpenids = [...new Set(convertedData.map(item => item._openid).filter(Boolean))];
    if (sellerOpenids.length > 0) {
      const usersRes = await db.collection('user').where({
        _openid: _.in(sellerOpenids)
      }).get();
      const userMap = {};
      usersRes.data.forEach(u => {
        userMap[u._openid] = u;
      });
      convertedData.forEach(item => {
        const seller = userMap[item._openid];
        if (seller) {
          item.sellerName = seller.nickName || item.sellerName;
          item.sellerAvatar = seller.avatarUrl || item.sellerAvatar;
          item.sellerContact = seller.contact || item.sellerContact;
          item.isStudentVerified = seller.isStudentVerified || false;
          item.studentVerifyStatus = seller.studentVerifyStatus || '';
        }
      });
    }

    return { code: 0, data: convertedData, total: totalRes.total };
  }

  if (action === 'detail') {
    const res = await db.collection('commodity').doc(id).get();
    if (!res.data) return { code: -1, msg: '商品不存在' };

    let data = res.data;
    data.images = data.images || [];
    data = await convertSingleFileIDs(data);

    const seller = await db.collection('user').where({ _openid: res.data._openid }).get();
    if (seller.data.length > 0) {
      data.sellerName = seller.data[0].nickName;
      data.sellerAvatar = seller.data[0].avatarUrl;
      data.sellerContact = seller.data[0].contact;
      data.sellerIsStudentVerified = seller.data[0].isStudentVerified || false;
      data.sellerStudentVerifyStatus = seller.data[0].studentVerifyStatus || '';
    }
    return { code: 0, data };
  }

  if (action === 'create') {
    const wxContext = cloud.getWXContext();
    const requestId = data.requestId;

    if (requestId) {
      const existRes = await db.collection('commodity').where({ requestId }).limit(1).get();
      if (existRes.data && existRes.data.length > 0) {
        return { code: 0, data: { _id: existRes.data[0]._id }, msg: '发布成功' };
      }
    }

    const newData = {
      ...data,
      _openid: wxContext.OPENID,
      status: 'onSale',
      viewCount: 0,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    const res = await db.collection('commodity').add({ data: newData });
    return { code: 0, data: { _id: res._id }, msg: '发布成功' };
  }

  if (action === 'update') {
    await db.collection('commodity').doc(id).update({
      data: { ...data, status: 'onSale', updateTime: db.serverDate() }
    });
    return { code: 0, msg: '更新成功' };
  }

  if (action === 'delete') {
    await db.collection('commodity').doc(id).update({
      data: { status: 'deleted', updateTime: db.serverDate() }
    });
    return { code: 0, msg: '删除成功' };
  }

  if (action === 'restore') {
    await db.collection('commodity').doc(id).update({
      data: { status: 'onSale', updateTime: db.serverDate() }
    });
    return { code: 0, msg: '恢复成功' };
  }

  if (action === 'search') {
    const where = {
      status: 'onSale',
      title: db.RegExp({ regexp: keyword, options: 'i' })
    };
    if (categoryId) where.categoryId = categoryId;

    const res = await db.collection('commodity').where(where).orderBy('createTime', 'desc').get();
    const listData = res.data.map(item => ({
      ...item,
      images: item.images || []
    }));
    const convertedData = await convertFileIDs(listData);
    return { code: 0, data: convertedData };
  }

  return { code: -1, msg: '未知操作' };
};