const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

// ===================== 内容安全检查 =====================

/**
 * 文本安全检查 msgSecCheck
 * @param {string} text - 待检测文本
 * @returns {Promise<{ok: boolean, msg: string}>}
 */
async function checkTextSecurity(text) {
  if (!text || !text.trim()) return { ok: true, msg: '' };
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: text
    });
    if (res.errCode === 0) {
      return { ok: true, msg: '' };
    }
    return { ok: false, msg: `文本「${text.substring(0, 20)}...」涉嫌违规` };
  } catch (err) {
    console.error('msgSecCheck 异常，降级放行:', err.errCode, err.errMsg);
    // 接口调用异常时降级放行，避免安全检查服务异常导致用户流程卡死
    return { ok: true, msg: '' };
  }
}

/**
 * 图片安全检查 imgSecCheck
 * @param {string} fileID - 云存储 fileID
 * @returns {Promise<{ok: boolean, msg: string}>}
 */
async function checkImageSecurity(fileID) {
  if (!fileID) return { ok: true, msg: '' };
  if (!fileID.startsWith('cloud://')) return { ok: true, msg: '' };

  try {
    // 先下载图片获取 buffer
    const downloadRes = await cloud.downloadFile({ fileID });
    const buffer = downloadRes.fileContent;

    const res = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: 'image/jpeg',
        value: buffer
      }
    });
    if (res.errCode === 0) {
      return { ok: true, msg: '' };
    }
    return { ok: false, msg: '图片涉嫌违规' };
  } catch (err) {
    console.error('imgSecCheck 异常，降级放行:', err.errCode, err.errMsg);
    // 接口调用异常时降级放行，避免安全检查服务异常导致用户流程卡死
    return { ok: true, msg: '' };
  }
}

/**
 * 批量检查所有文本字段
 */
async function checkAllText(data) {
  const textFields = [
    { field: 'title', label: '标题', value: data.title },
    { field: 'description', label: '描述', value: data.description },
    { field: 'sellerContact', label: '联系方式', value: data.sellerContact },
    { field: 'tradeLocation', label: '交易地点', value: data.tradeLocation }
  ];

  for (const item of textFields) {
    if (item.value && item.value.trim()) {
      const result = await checkTextSecurity(item.value);
      if (!result.ok) {
        return { ok: false, msg: `${item.label}安全检查未通过: ${result.msg}` };
      }
    }
  }
  return { ok: true };
}

/**
 * 批量检查所有图片
 */
async function checkAllImages(images) {
  if (!images || images.length === 0) return { ok: true };

  for (let i = 0; i < images.length; i++) {
    const result = await checkImageSecurity(images[i]);
    if (!result.ok) {
      return { ok: false, msg: `第${i + 1}张图片安全检查未通过: ${result.msg}` };
    }
  }
  return { ok: true };
}

/**
 * 判断 openid 是否为管理员
 */
async function isAdminUser(openid) {
  try {
    const res = await db.collection('user').where({ _openid: openid, isAdmin: true }).count();
    return res.total > 0;
  } catch (err) {
    console.error('[commodity] 管理员校验异常:', err.message);
    return false;
  }
}

/**
 * 判断 openid 是否被封禁
 */
async function isUserBanned(openid) {
  try {
    const res = await db.collection('user').where({ _openid: openid, banned: true }).count();
    return res.total > 0;
  } catch (err) {
    return false;
  }
}

exports.main = async (event, context) => {
  const { action, id, data, keyword, categoryId, page = 1, pageSize = 10, sellerId, includeDeleted, type } = event;
  const wxContext = cloud.getWXContext();

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
        // 卖家可以看到自己所有非删除的商品（含待审核、已驳回）
        where.status = _.neq('deleted');
      }
    } else {
      // 公开列表只展示已上架（审核通过）的商品
      where.status = 'onSale';
    }
    if (categoryId) where.categoryId = categoryId;
    if (type) where.type = type;

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
    const requestId = data.requestId;

    if (requestId) {
      const existRes = await db.collection('commodity').where({ requestId }).limit(1).get();
      if (existRes.data && existRes.data.length > 0) {
        return { code: 0, data: { _id: existRes.data[0]._id }, msg: '发布成功' };
      }
    }

    // 封禁用户不允许发布
    if (await isUserBanned(wxContext.OPENID)) {
      return { code: -1, msg: '账号已被封禁，无法发布信息' };
    }

    // ===== 内容安全检查（UGC 合规要求） =====
    console.log('[commodity] 开始内容安全检查, requestId:', requestId);

    // 1. 文本安全检查
    const textCheck = await checkAllText(data);
    if (!textCheck.ok) {
      console.warn('[commodity] 文本安全检查未通过:', textCheck.msg);
      return { code: -1, msg: textCheck.msg };
    }

    // 2. 图片安全检查
    const imageCheck = await checkAllImages(data.images);
    if (!imageCheck.ok) {
      console.warn('[commodity] 图片安全检查未通过:', imageCheck.msg);
      return { code: -1, msg: imageCheck.msg };
    }

    console.log('[commodity] 内容安全检查通过');

    const newData = {
      ...data,
      _openid: wxContext.OPENID,
      status: 'pendingReview', // 待管理员审核，审核通过后才变为 onSale
      viewCount: 0,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    const res = await db.collection('commodity').add({ data: newData });
    return { code: 0, data: { _id: res._id }, msg: '发布成功，等待管理员审核' };
  }

  if (action === 'update') {
    // 封禁用户不允许编辑重发
    if (await isUserBanned(wxContext.OPENID)) {
      return { code: -1, msg: '账号已被封禁，无法操作' };
    }

    // 编辑后重新进入待审核状态
    // 提取可编辑字段，不直接信任前端传入的 status
    const updateData = { ...data };
    delete updateData._openid;
    delete updateData._id;

    // 编辑时重新进行内容安全检查
    if (updateData.title || updateData.description || updateData.sellerContact || updateData.tradeLocation) {
      const textCheck = await checkAllText(updateData);
      if (!textCheck.ok) {
        return { code: -1, msg: textCheck.msg };
      }
    }
    if (updateData.images && updateData.images.length > 0) {
      const imageCheck = await checkAllImages(updateData.images);
      if (!imageCheck.ok) {
        return { code: -1, msg: imageCheck.msg };
      }
    }

    updateData.status = 'pendingReview'; // 编辑后重新审核
    updateData.updateTime = db.serverDate();
    await db.collection('commodity').doc(id).update({ data: updateData });
    return { code: 0, msg: '修改成功，等待管理员审核' };
  }

  // ===== 管理员审核：通过 =====
  if (action === 'approve') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    if (!id) return { code: -1, msg: '缺少商品ID' };
    try {
      await db.collection('commodity').doc(id).update({
        data: {
          status: 'onSale',
          rejectReason: '',
          reviewTime: db.serverDate(),
          reviewer: cloud.getWXContext().OPENID,
          updateTime: db.serverDate()
        }
      });
      console.log('[commodity] 商品审核通过:', id);
      return { code: 0, msg: '审核通过，商品已上架' };
    } catch (err) {
      console.error('[commodity] 审核通过失败:', err.message);
      return { code: -1, msg: '审核操作失败' };
    }
  }

  // ===== 管理员审核：驳回 =====
  if (action === 'reject') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    if (!id) return { code: -1, msg: '缺少商品ID' };
    const reason = event.reason || '内容不合规';
    try {
      await db.collection('commodity').doc(id).update({
        data: {
          status: 'rejected',
          rejectReason: reason,
          reviewTime: db.serverDate(),
          reviewer: cloud.getWXContext().OPENID,
          updateTime: db.serverDate()
        }
      });
      console.log('[commodity] 商品审核驳回:', id, '原因:', reason);
      return { code: 0, msg: '已驳回' };
    } catch (err) {
      console.error('[commodity] 审核驳回失败:', err.message);
      return { code: -1, msg: '审核操作失败' };
    }
  }

  // ===== 管理员获取待审核商品列表 =====
  if (action === 'pendingList') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    const adminPage = page || 1;
    const adminPageSize = pageSize || 20;
    try {
      const totalRes = await db.collection('commodity')
        .where({ status: 'pendingReview' })
        .count();
      const listRes = await db.collection('commodity')
        .where({ status: 'pendingReview' })
        .orderBy('createTime', 'desc')
        .skip((adminPage - 1) * adminPageSize)
        .limit(adminPageSize)
        .get();
      const convertedData = await convertFileIDs(listRes.data);
      return { code: 0, data: convertedData, total: totalRes.total };
    } catch (err) {
      console.error('[commodity] 获取待审核列表失败:', err.message);
      return { code: -1, msg: '获取待审核列表失败' };
    }
  }

  if (action === 'delete') {
    await db.collection('commodity').doc(id).update({
      data: { status: 'deleted', updateTime: db.serverDate() }
    });
    return { code: 0, msg: '删除成功' };
  }

  if (action === 'restore') {
    await db.collection('commodity').doc(id).update({
      data: { status: 'pendingReview', rejectReason: '', updateTime: db.serverDate() }
    });
    return { code: 0, msg: '已恢复，等待管理员审核后重新上架' };
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

    const sellerOpenids = [...new Set(convertedData.map(i => i._openid).filter(Boolean))];
    if (sellerOpenids.length > 0) {
      const usersRes = await db.collection('user').where({ _openid: _.in(sellerOpenids) }).get();
      const userMap = {};
      usersRes.data.forEach(u => { userMap[u._openid] = u; });
      convertedData.forEach(item => {
        const seller = userMap[item._openid];
        if (seller) {
          item.sellerName = seller.nickName || item.sellerName;
          item.sellerAvatar = seller.avatarUrl || item.sellerAvatar;
          item.sellerContact = seller.contact || item.sellerContact;
          item.isStudentVerified = seller.isStudentVerified || false;
        }
      });
    }

    return { code: 0, data: convertedData };
  }

  // ===== 管理员数据管理：查询全部商品（需管理员身份） =====
  if (action === 'adminList') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    const adminStatus = event.status || '';    // '' 全部 | 具体状态
    const adminType = event.type || '';        // '' 全部 | 'sell' | 'want'
    const adminKeyword = (event.keyword || '').trim();
    const adminPage = Math.max(1, parseInt(page, 10) || 1);
    const adminPageSize = Math.min(50, parseInt(pageSize, 10) || 20);

    const where = {};
    if (adminStatus) where.status = adminStatus;
    if (adminType) where.type = adminType;
    if (adminKeyword) {
      where.title = db.RegExp({ regexp: adminKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' });
    }

    const totalRes = await db.collection('commodity').where(where).count();
    const listRes = await db.collection('commodity')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((adminPage - 1) * adminPageSize)
      .limit(adminPageSize)
      .get();
    const data = await convertFileIDs(listRes.data.map(item => ({ ...item, images: item.images || [] })));
    return { code: 0, data, total: totalRes.total };
  }

  // ===== 管理员数据管理：直接变更商品状态（上架/下架/转待审/删除等） =====
  if (action === 'adminSetStatus') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    if (!id) return { code: -1, msg: '缺少商品ID' };
    const allowed = ['pendingReview', 'onSale', 'rejected', 'deleted'];
    const targetStatus = event.status;
    if (!allowed.includes(targetStatus)) return { code: -1, msg: '状态值不合法' };

    const update = { status: targetStatus, updateTime: db.serverDate() };
    if (targetStatus === 'onSale') {
      update.rejectReason = '';
      update.reviewTime = db.serverDate();
      update.reviewer = wxContext.OPENID;
    }
    if (targetStatus === 'rejected') {
      update.rejectReason = (event.reason || '').toString().trim();
    }
    if (targetStatus === 'deleted') {
      update.rejectReason = '';
    }
    await db.collection('commodity').doc(id).update({ data: update });
    return { code: 0, msg: '状态已更新' };
  }

  // ===== 管理员数据管理：永久删除商品（文档 + 云存储图片） =====
  if (action === 'adminDelete') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    if (!id) return { code: -1, msg: '缺少商品ID' };
    let existRes = null;
    try {
      existRes = await db.collection('commodity').doc(id).get();
    } catch (err) {
      return { code: -1, msg: '商品不存在' };
    }
    const images = ((existRes.data && existRes.data.images) || [])
      .filter(img => img && img.indexOf('cloud://') === 0);
    await db.collection('commodity').doc(id).remove();
    if (images.length) {
      try { await cloud.deleteFile({ fileList: images.slice(0, 50) }); } catch (err) {
        console.error('[commodity] 删除商品图片失败:', err.message);
      }
    }
    return { code: 0, msg: '商品已永久删除' };
  }

  return { code: -1, msg: '未知操作' };
};