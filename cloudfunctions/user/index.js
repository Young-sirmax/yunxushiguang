const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

const validateStudentId = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed || !/^\d{10}$/.test(trimmed)) return false;
  const year = parseInt(trimmed.substring(0, 4), 10);
  return year >= 2000 && year <= 2099;
};

const validatePhone = (value) => /^1\d{10}$/.test((value || '').trim());

const validateContact = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return false;
  if (trimmed.length < 4 || trimmed.length > 30) return false;
  if (/^1\d{10}$/.test(trimmed)) return true;
  return true;
};

const sanitizePublicUser = (user) => {
  if (!user) return null;
  const { realName, studentId, contact, studentVerifyImage, ...publicInfo } = user;
  return publicInfo;
};

// ===================== 内容安全检查 =====================

async function checkTextSecurity(text, fieldLabel) {
  if (!text || !text.trim()) return { ok: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: text });
    if (res.errCode === 0) return { ok: true };
    return { ok: false, msg: `${fieldLabel || '文本'}内容违规` };
  } catch (err) {
    // 接口调用异常时降级放行，记录日志，避免安全检查服务异常导致用户流程卡死
    // 审核要求：检测结果仅需提示用户所发布内容含违规信息即可
    console.error('[user] msgSecCheck 调用异常，降级放行:', err.errCode, err.errMsg);
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
    return { ok: false, msg: `${fieldLabel || '图片'}内容违规` };
  } catch (err) {
    // 接口调用异常时降级放行，避免安全检查服务异常导致用户流程卡死
    console.error('[user] imgSecCheck 调用异常，降级放行:', err.errCode, err.errMsg);
    return { ok: true };
  }
}

// 需要进行文本检查的字段
const TEXT_FIELDS = [
  { key: 'nickName', label: '昵称' },
  { key: 'contact', label: '手机号' },
  { key: 'realName', label: '姓名' },
  { key: 'studentId', label: '学号' },
  { key: 'universityName', label: '学校' }
];

// 需要进行图片检查的字段
const IMAGE_FIELDS = [
  { key: 'avatarUrl', label: '头像' },
  { key: 'studentVerifyImage', label: '学生证照片' }
];

exports.main = async (event, context) => {
  const { action, data, openid } = event;
  const wxContext = cloud.getWXContext();
  const userOpenid = wxContext.OPENID;

  if (action === 'login') {
    let user = await db.collection('user').where({ _openid: userOpenid }).get();
    if (user.data.length === 0) {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const newUser = {
        _openid: userOpenid,
        nickName: '',
        avatarUrl: '',
        realName: '',
        studentId: '',
        contact: '',
        universityId: '',
        universityName: '',
        auctionCount: 0,
        auctionMonth: currentMonth,
        isStudentVerified: false,
        studentVerifyImage: '',
        studentVerifyStatus: '',
        studentVerifyTime: null,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      };
      const addRes = await db.collection('user').add({ data: newUser });
      newUser._id = addRes._id;
      return { code: 0, data: newUser, msg: '注册成功' };
    }
    if (user.data[0].banned) {
      return { code: -1, msg: '该账号已被封禁，如有疑问请联系管理员' };
    }
    return { code: 0, data: user.data[0], msg: '登录成功' };
  }

  if (action === 'update') {
    const existing = await db.collection('user').where({ _openid: userOpenid }).get();
    if (existing.data.length === 0) {
      return { code: -1, msg: '用户不存在' };
    }
    const currentUser = existing.data[0];
    if (currentUser.banned) {
      return { code: -1, msg: '该账号已被封禁，无法操作' };
    }
    const updateData = { ...data };

    // 姓名、学号注册后不可修改
    if (currentUser.realName && updateData.realName && updateData.realName !== currentUser.realName) {
      return { code: -1, msg: '姓名不可修改' };
    }
    if (currentUser.studentId && updateData.studentId && updateData.studentId !== currentUser.studentId) {
      return { code: -1, msg: '学号不可修改' };
    }

    if (updateData.studentId !== undefined && !validateStudentId(updateData.studentId)) {
      return { code: -1, msg: '学号格式不正确，需为10位数字且前4位为入学年份' };
    }
    if (updateData.contact !== undefined && updateData.contact && !validateContact(updateData.contact)) {
      return { code: -1, msg: '联系方式格式不正确' };
    }

    // ===== 内容安全检查 =====
    // 文本字段检查
    for (const field of TEXT_FIELDS) {
      if (updateData[field.key] !== undefined && updateData[field.key] !== null) {
        const textCheck = await checkTextSecurity(String(updateData[field.key]), field.label);
        if (!textCheck.ok) {
          console.warn('[user] 文本安全检查未通过:', field.key, textCheck.msg);
          return { code: -1, msg: textCheck.msg };
        }
      }
    }

    // 图片字段检查
    for (const field of IMAGE_FIELDS) {
      if (updateData[field.key] && typeof updateData[field.key] === 'string') {
        const imageCheck = await checkImageSecurity(updateData[field.key], field.label);
        if (!imageCheck.ok) {
          console.warn('[user] 图片安全检查未通过:', field.key, imageCheck.msg);
          return { code: -1, msg: imageCheck.msg };
        }
      }
    }

    console.log('[user] 内容安全检查通过');

    // 完成注册时校验必填项（仅联系方式）
    const merged = { ...currentUser, ...updateData };
    if (merged.contact && !validateContact(merged.contact)) {
      return { code: -1, msg: '请填写正确的微信号或手机号' };
    }

    await db.collection('user').where({ _openid: userOpenid }).update({
      data: { ...updateData, updateTime: db.serverDate() }
    });
    const user = await db.collection('user').where({ _openid: userOpenid }).get();
    return { code: 0, data: user.data[0], msg: '更新成功' };
  }

  if (action === 'verifyStudent') {
    const existing = await db.collection('user').where({ _openid: userOpenid }).get();
    if (existing.data.length === 0) {
      return { code: -1, msg: '用户不存在' };
    }
    const currentUser = existing.data[0];
    if (currentUser.banned) {
      return { code: -1, msg: '该账号已被封禁，无法操作' };
    }

    if (currentUser.isStudentVerified) {
      return { code: 0, data: currentUser, msg: '已认证，无需重复认证' };
    }

    // 审核中不允许重复提交，避免覆盖审核信息
    if (currentUser.studentVerifyStatus === 'pending') {
      return { code: 0, data: currentUser, msg: '认证审核中，请勿重复提交' };
    }
    
    if (!data.studentVerifyImage) {
      return { code: -1, msg: '请上传学生证照片' };
    }
    if (!data.universityId || !data.universityName) {
      return { code: -1, msg: '请选择学校' };
    }
    if (!data.realName || !data.realName.trim()) {
      return { code: -1, msg: '请填写姓名' };
    }
    if (!data.studentId || !validateStudentId(data.studentId)) {
      return { code: -1, msg: '学号格式不正确' };
    }

    const textCheck = await checkTextSecurity(String(data.realName), '姓名');
    if (!textCheck.ok) {
      return { code: -1, msg: textCheck.msg };
    }
    
    const imgCheck = await checkImageSecurity(data.studentVerifyImage, '学生证照片');
    if (!imgCheck.ok) {
      return { code: -1, msg: imgCheck.msg };
    }
    
    const updateData = {
      universityId: data.universityId,
      universityName: data.universityName,
      realName: data.realName.trim(),
      studentId: data.studentId.trim(),
      studentVerifyImage: data.studentVerifyImage,
      studentVerifyStatus: 'pending',
      isStudentVerified: false,
      studentVerifyTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    
    await db.collection('user').where({ _openid: userOpenid }).update({ data: updateData });
    const updatedUser = await db.collection('user').where({ _openid: userOpenid }).get();
    
    return { code: 0, data: updatedUser.data[0], msg: '认证提交成功，审核中' };
  }
  
  if (action === 'cancelVerifyStudent') {
    const existing = await db.collection('user').where({ _openid: userOpenid }).get();
    if (existing.data.length === 0) {
      return { code: -1, msg: '用户不存在' };
    }
    if (existing.data[0].banned) {
      return { code: -1, msg: '该账号已被封禁，无法操作' };
    }

    const updateData = {
      isStudentVerified: false,
      studentVerifyStatus: '',
      studentVerifyImage: '',
      studentVerifyTime: null,
      updateTime: db.serverDate()
    };
    
    await db.collection('user').where({ _openid: userOpenid }).update({ data: updateData });
    
    return { code: 0, msg: '已取消认证' };
  }

  if (action === 'getInfo') {
    const targetOpenid = openid || userOpenid;
    const user = await db.collection('user').where({ _openid: targetOpenid }).get();
    const userData = user.data[0] || null;
    if (!userData) return { code: 0, data: null };

    if (targetOpenid !== userOpenid) {
      return { code: 0, data: sanitizePublicUser(userData) };
    }
    return { code: 0, data: userData };
  }

  return { code: -1, msg: '未知操作' };
};