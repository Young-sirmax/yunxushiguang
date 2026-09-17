// 云函数 admin：学生认证管理员审核后台
// 首次使用：部署本云函数后，在管理页输入下方 ADMIN_PASSWORD 密码，
// 当前微信账号即被绑定为管理员（user 集合 isAdmin=true），之后无需重复输入。
// 注意：上线前请务必修改 ADMIN_PASSWORD 为强密码！
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

// ============ 管理员密码（上线前请修改） ============
const ADMIN_PASSWORD = 'kx626564';

async function findUserByOpenid(openid) {
  const res = await db.collection('user').where({ _openid: openid }).limit(1).get();
  return res.data[0] || null;
}

async function isAdmin(openid) {
  const user = await findUserByOpenid(openid);
  return !!(user && user.isAdmin === true);
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const userOpenid = wxContext.OPENID;
  const { action, ...params } = event;

  // 登录：密码验证通过后，将当前 openid 绑定为管理员
  if (action === 'login') {
    const password = (params.password || '').toString();
    if (!password || password !== ADMIN_PASSWORD) {
      return { code: -1, msg: '管理密码错误' };
    }
    const user = await findUserByOpenid(userOpenid);
    if (!user) {
      return { code: -1, msg: '当前账号未登录，请先在小程序内登录' };
    }
    await db.collection('user').doc(user._id).update({
      data: { isAdmin: true, updateTime: db.serverDate() }
    });
    return { code: 0, data: { isAdmin: true }, msg: '管理员登录成功' };
  }

  // 退出：解除当前 openid 的管理员身份
  if (action === 'logout') {
    const user = await findUserByOpenid(userOpenid);
    if (user) {
      await db.collection('user').doc(user._id).update({
        data: { isAdmin: false, updateTime: db.serverDate() }
      });
    }
    return { code: 0, msg: '已退出管理员' };
  }

  // 其余操作均需管理员身份
  if (!(await isAdmin(userOpenid))) {
    return { code: -1, msg: '无管理员权限' };
  }

  if (action === 'checkAdmin') {
    return { code: 0, data: { isAdmin: true }, msg: 'ok' };
  }

  if (action === 'listVerify') {
    const status = params.status || 'pending';
    let where = {};
    if (status === 'approved') {
      where = { isStudentVerified: true };
    } else if (status === 'rejected') {
      where = { studentVerifyStatus: 'rejected' };
    } else {
      where = { studentVerifyStatus: 'pending' };
    }
    const res = await db.collection('user').where(where).limit(50).get();
    const list = (res.data || []).sort((a, b) =>
      new Date(b.studentVerifyTime || 0) - new Date(a.studentVerifyTime || 0)
    );

    // 学生证照片（cloud:// fileID）批量转为临时可访问链接
    const fileIDs = list.filter(u => u.studentVerifyImage).map(u => u.studentVerifyImage);
    const tempMap = {};
    if (fileIDs.length) {
      try {
        const fr = await cloud.getTempFileURL({ fileList: fileIDs });
        (fr.fileList || []).forEach(item => { tempMap[item.fileID] = item.tempFileURL || ''; });
      } catch (err) {
        console.error('[admin] getTempFileURL 失败:', err);
      }
    }

    return {
      code: 0,
      data: list.map(u => ({
        _id: u._id,
        nickName: u.nickName || '',
        avatarUrl: u.avatarUrl || '',
        realName: u.realName || '',
        studentId: u.studentId || '',
        universityName: u.universityName || '',
        studentVerifyImage: u.studentVerifyImage || '',
        verifyImageUrl: tempMap[u.studentVerifyImage] || '',
        studentVerifyTime: u.studentVerifyTime || null,
        auditTime: u.auditTime || null,
        rejectReason: u.rejectReason || ''
      })),
      total: list.length
    };
  }

  if (action === 'auditVerify') {
    const { id, result, reason } = params;
    if (!id || !['approved', 'rejected'].includes(result)) {
      return { code: -1, msg: '参数错误' };
    }
    const res = await db.collection('user').where({ _id: id }).limit(1).get();
    const target = res.data[0];
    if (!target) {
      return { code: -1, msg: '目标用户不存在' };
    }
    const updateData = {
      isStudentVerified: result === 'approved',
      studentVerifyStatus: result,
      auditTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    if (result === 'rejected') {
      updateData.rejectReason = (reason || '').toString().trim();
    }
    await db.collection('user').doc(target._id).update({ data: updateData });
    return { code: 0, msg: result === 'approved' ? '认证已通过' : '认证已拒绝' };
  }

  // ===================== 数据管理：用户 =====================
  if (action === 'listUsers') {
    const keyword = (params.keyword || '').trim();
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const pageSize = Math.min(50, parseInt(params.pageSize, 10) || 20);

    let where = {};
    if (keyword) {
      const re = db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' });
      where = db.command.or([
        { nickName: re },
        { realName: re },
        { studentId: re },
        { universityName: re }
      ]);
    }
    const totalRes = await db.collection('user').where(where).count();
    const listRes = await db.collection('user')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();
    const list = (listRes.data || []).map(u => ({
      _id: u._id,
      _openid: u._openid,
      nickName: u.nickName || '',
      avatarUrl: u.avatarUrl || '',
      realName: u.realName || '',
      studentId: u.studentId || '',
      universityName: u.universityName || '',
      phone: u.phone || '',
      wechat_id: u.wechat_id || '',
      isAdmin: !!u.isAdmin,
      banned: !!u.banned,
      expert_status: u.expert_status || 'none',
      isStudentVerified: !!u.isStudentVerified,
      studentVerifyStatus: u.studentVerifyStatus || '',
      createTime: u.createTime || null
    }));
    return { code: 0, data: list, total: totalRes.total, page, pageSize };
  }

  if (action === 'setAdmin') {
    const userId = params.userId;
    const isAdminVal = !!params.isAdmin;
    if (!userId) return { code: -1, msg: '缺少用户ID' };
    const target = (await db.collection('user').where({ _id: userId }).limit(1).get()).data[0];
    if (!target) return { code: -1, msg: '用户不存在' };
    if (target._openid === userOpenid && !isAdminVal) {
      return { code: -1, msg: '不能取消自己的管理员身份' };
    }
    await db.collection('user').doc(target._id).update({
      data: { isAdmin: isAdminVal, updateTime: db.serverDate() }
    });
    return { code: 0, msg: isAdminVal ? '已设为管理员' : '已取消管理员' };
  }

  if (action === 'setBan') {
    const userId = params.userId;
    const banned = !!params.banned;
    if (!userId) return { code: -1, msg: '缺少用户ID' };
    const target = (await db.collection('user').where({ _id: userId }).limit(1).get()).data[0];
    if (!target) return { code: -1, msg: '用户不存在' };
    if (target._openid === userOpenid && banned) {
      return { code: -1, msg: '不能封禁当前账号' };
    }
    const data = { banned, updateTime: db.serverDate() };
    if (banned) {
      data.isStudentVerified = false;
      data.studentVerifyStatus = '';
    }
    await db.collection('user').doc(target._id).update({ data });
    return { code: 0, msg: banned ? '已封禁该账号' : '已解封该账号' };
  }

  if (action === 'deleteUser') {
    const userId = params.userId;
    if (!userId) return { code: -1, msg: '缺少用户ID' };
    const target = (await db.collection('user').where({ _id: userId }).limit(1).get()).data[0];
    if (!target) return { code: -1, msg: '用户不存在' };
    if (target._openid === userOpenid) {
      return { code: -1, msg: '不能删除当前管理员账号' };
    }
    // 级联清理：该用户发布的商品 + 相关云存储图片
    const commodityRes = await db.collection('commodity').where({ _openid: target._openid }).limit(100).get();
    const docs = commodityRes.data || [];
    const fileIDs = [];
    if (target.avatarUrl && target.avatarUrl.indexOf('cloud://') === 0) fileIDs.push(target.avatarUrl);
    if (target.studentVerifyImage && target.studentVerifyImage.indexOf('cloud://') === 0) fileIDs.push(target.studentVerifyImage);
    docs.forEach(c => {
      (c.images || []).forEach(img => {
        if (img && img.indexOf('cloud://') === 0) fileIDs.push(img);
      });
    });
    for (const c of docs) {
      try { await db.collection('commodity').doc(c._id).remove(); } catch (e) { console.error('删除用户商品失败:', c._id, e.message); }
    }
    if (fileIDs.length) {
      try { await cloud.deleteFile({ fileList: fileIDs.slice(0, 50) }); } catch (e) { console.error('删除用户云文件失败:', e.message); }
    }
    await db.collection('user').doc(target._id).remove();
    return { code: 0, msg: '用户及其发布信息已删除', data: { removedCommodity: docs.length } };
  }

  return { code: -1, msg: '未知操作' };
};
