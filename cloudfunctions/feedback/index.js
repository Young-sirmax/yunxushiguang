const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

async function checkTextSecurity(text, fieldLabel) {
  if (!text || !text.trim()) return { ok: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: text });
    if (res.errCode === 0) return { ok: true };
    return { ok: false, msg: `${fieldLabel || '文本'}包含违规内容，请修改后重试` };
  } catch (err) {
    console.error('[feedback] msgSecCheck 异常，降级放行:', err.errCode, err.errMsg);
    return { ok: true };
  }
}

async function checkImageSecurity(fileID, fieldLabel) {
  if (!fileID || !fileID.startsWith('cloud://')) return { ok: true };
  try {
    const downloadRes = await cloud.downloadFile({ fileID });
    const buffer = downloadRes.fileContent;
    const res = await cloud.openapi.security.imgSecCheck({
      media: { contentType: 'image/jpeg', value: buffer }
    });
    if (res.errCode === 0) return { ok: true };
    return { ok: false, msg: `${fieldLabel || '图片'}包含违规内容，请更换后重试` };
  } catch (err) {
    console.error('[feedback] imgSecCheck 异常，降级放行:', err.errCode, err.errMsg);
    return { ok: true };
  }
}

async function checkAllText(data) {
  const textFields = [
    { field: 'content', label: '反馈内容', value: data.content },
    { field: 'contact', label: '联系方式', value: data.contact }
  ];
  for (const item of textFields) {
    if (item.value && item.value.trim()) {
      const result = await checkTextSecurity(item.value, item.label);
      if (!result.ok) return { ok: false, msg: result.msg };
    }
  }
  return { ok: true };
}

async function checkAllImages(images) {
  if (!images || images.length === 0) return { ok: true };
  for (let i = 0; i < images.length; i++) {
    const result = await checkImageSecurity(images[i], `第${i + 1}张图片`);
    if (!result.ok) return { ok: false, msg: result.msg };
  }
  return { ok: true };
}

exports.main = async (event, context) => {
  const { action, id, data, page = 1, pageSize = 20 } = event;
  const wxContext = cloud.getWXContext();
  const currentOpenid = wxContext.OPENID;

  if (action === 'create') {
    try {
      if (!data || !data.content) {
        return { code: -1, msg: '反馈内容不能为空' };
      }

      const textCheck = await checkAllText(data);
      if (!textCheck.ok) {
        return { code: -1, msg: textCheck.msg };
      }
      const imageCheck = await checkAllImages(data.images);
      if (!imageCheck.ok) {
        return { code: -1, msg: imageCheck.msg };
      }

      const newData = {
        type: data.type || 'other',
        content: data.content,
        contact: data.contact || '',
        images: data.images || [],
        userName: data.userName || '',
        _openid: currentOpenid,
        status: 'pending',
        urgeCount: 0,
        lastUrgeTime: null,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      };

      const res = await db.collection('feedback').add({ data: newData });
      return { code: 0, data: { _id: res._id }, msg: '提交成功' };
    } catch (err) {
      console.error('创建反馈失败:', err);
      const errCode = err && err.errCode;
      if (errCode === -502003 || (err && err.errMsg && err.errMsg.includes('collection'))) {
        return { code: -1, msg: '反馈集合不存在，请在云开发控制台创建 feedback 集合' };
      }
      return { code: -1, msg: '提交失败: ' + (err.message || err.errMsg || '未知错误') };
    }
  }

  if (action === 'list') {
    try {
      const where = {};
      where._openid = currentOpenid;

      const totalRes = await db.collection('feedback').where(where).count();
      const listRes = await db.collection('feedback')
        .where(where)
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();

      return { code: 0, data: listRes.data, total: totalRes.total };
    } catch (err) {
      console.error('获取反馈列表失败:', err);
      return { code: 0, data: [], total: 0 };
    }
  }

  if (action === 'detail') {
    const res = await db.collection('feedback').doc(id).get();
    if (!res.data) {
      return { code: -1, msg: '反馈不存在' };
    }
    if (res.data._openid !== currentOpenid) {
      return { code: -1, msg: '无权查看' };
    }
    return { code: 0, data: res.data };
  }

  if (action === 'urge') {
    try {
      const existRes = await db.collection('feedback').doc(id).get();
      if (!existRes.data) {
        return { code: -1, msg: '反馈不存在' };
      }
      if (existRes.data._openid !== currentOpenid) {
        return { code: -1, msg: '无权操作' };
      }

      const feedback = existRes.data;
      if (feedback.status === 'resolved' || feedback.status === 'rejected') {
        return { code: -1, msg: '反馈已处理，无需催促' };
      }

      const now = Date.now();
      const lastUrge = feedback.lastUrgeTime ? new Date(feedback.lastUrgeTime).getTime() : 0;
      const cooldownMs = 60 * 60 * 1000;

      if (now - lastUrge < cooldownMs) {
        const remainMin = Math.ceil((cooldownMs - (now - lastUrge)) / 60000);
        return { code: -1, msg: '催一催过于频繁，请' + remainMin + '分钟后再试' };
      }

      const newCount = (feedback.urgeCount || 0) + 1;
      await db.collection('feedback').doc(id).update({
        data: {
          urgeCount: newCount,
          lastUrgeTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });

      return { code: 0, data: { urgeCount: newCount }, msg: '已催，请耐心等待处理' };
    } catch (err) {
      console.error('催一催失败:', err);
      return { code: -1, msg: '催一催失败: ' + (err.message || '未知错误') };
    }
  }

  if (action === 'update') {
    const existRes = await db.collection('feedback').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '反馈不存在' };
    }
    if (existRes.data._openid !== currentOpenid) {
      return { code: -1, msg: '无权操作' };
    }

    const allowedFields = ['type', 'content', 'contact', 'images'];
    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    if (updateData.content || updateData.contact) {
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

    updateData.updateTime = db.serverDate();

    await db.collection('feedback').doc(id).update({ data: updateData });
    return { code: 0, msg: '更新成功' };
  }

  if (action === 'delete') {
    const existRes = await db.collection('feedback').doc(id).get();
    if (!existRes.data) {
      return { code: -1, msg: '反馈不存在' };
    }
    if (existRes.data._openid !== currentOpenid) {
      return { code: -1, msg: '无权操作' };
    }

    await db.collection('feedback').doc(id).remove();
    return { code: 0, msg: '删除成功' };
  }

  return { code: -1, msg: '未知操作' };
};
