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

const sanitizePublicUser = (user) => {
  if (!user) return null;
  const { realName, studentId, contact, studentVerifyImage, ...publicInfo } = user;
  return publicInfo;
};

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
    return { code: 0, data: user.data[0], msg: '登录成功' };
  }

  if (action === 'update') {
    const existing = await db.collection('user').where({ _openid: userOpenid }).get();
    if (existing.data.length === 0) {
      return { code: -1, msg: '用户不存在' };
    }
    const currentUser = existing.data[0];
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
    if (updateData.contact !== undefined && updateData.contact && !validatePhone(updateData.contact)) {
      return { code: -1, msg: '手机号格式不正确' };
    }

    // 完成注册时校验必填项
    const merged = { ...currentUser, ...updateData };
    const isCompletingRegistration = merged.universityId && merged.realName && merged.studentId && merged.contact;
    if (isCompletingRegistration) {
      if (!validateStudentId(merged.studentId)) {
        return { code: -1, msg: '学号格式不正确' };
      }
      if (!validatePhone(merged.contact)) {
        return { code: -1, msg: '请填写正确的手机号' };
      }
      if (!merged.realName.trim()) {
        return { code: -1, msg: '请填写姓名' };
      }
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
    
    if (currentUser.isStudentVerified) {
      return { code: 0, data: currentUser, msg: '已认证，无需重复认证' };
    }
    
    if (!data.studentVerifyImage) {
      return { code: -1, msg: '请上传学生证照片' };
    }
    
    const updateData = {
      studentVerifyImage: data.studentVerifyImage,
      studentVerifyStatus: 'pending',
      isStudentVerified: false,
      updateTime: db.serverDate()
    };
    
    await db.collection('user').where({ _openid: userOpenid }).update({ data: updateData });
    
    return { code: 0, data: { ...currentUser, ...updateData }, msg: '认证提交成功，审核中' };
  }
  
  if (action === 'cancelVerifyStudent') {
    const existing = await db.collection('user').where({ _openid: userOpenid }).get();
    if (existing.data.length === 0) {
      return { code: -1, msg: '用户不存在' };
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