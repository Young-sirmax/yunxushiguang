const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

const validateStudentId = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed || !/^\d{10}$/.test(trimmed)) return false;
  const year = parseInt(trimmed.substring(0, 4), 10);
  return year >= 2000 && year <= 2099;
};

const validatePhone = (value) => /^1\d{10}$/.test((value || '').trim());

/** 微信号：字母开头，6-20 位，仅含字母、数字、下划线、减号 */
const WECHAT_ID_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/;
const validateWechatId = (value) => WECHAT_ID_REGEX.test((value || '').trim());

/**
 * 维护模式：读 config 集合（不存在或读取失败时按未开启处理）
 */
async function isMaintenanceOn() {
  try {
    const res = await db.collection('config').where({ key: 'app' }).limit(1).get();
    return !!(res.data[0] && res.data[0].maintenance);
  } catch (err) {
    return false;
  }
}

/** 对外脱敏：手机号、微信号、真实姓名、学号、证件照一律不下发 */
const sanitizePublicUser = (user) => {
  if (!user) return null;
  const { realName, studentId, phone, wechat_id, studentVerifyImage, ...publicInfo } = user;
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
  { key: 'phone', label: '手机号' },
  { key: 'wechat_id', label: '微信号' },
  { key: 'expert_intro', label: '达人介绍' },
  { key: 'realName', label: '姓名' },
  { key: 'studentId', label: '学号' },
  { key: 'universityName', label: '学校' }
];

// 需要进行图片检查的字段
const IMAGE_FIELDS = [
  { key: 'avatarUrl', label: '头像' },
  { key: 'studentVerifyImage', label: '学生证照片' }
];

// ===================== 技能分类（配置化） =====================
// 默认值兜底；优先读 config 集合，改配置即可增删技能分类，无需改代码。
const DEFAULT_SKILL_CATEGORIES = [
  '项目辅导',
  '科研教学',
  '学科竞赛',
  '论文写作',
  '编程开发',
  '设计剪辑',
  '乐器教学',
  '摄影修图',
  '运动陪练',
  '其他'
];
const SKILL_CATEGORY_CACHE_TTL = 10 * 60 * 1000; // 进程内缓存 10 分钟
let skillCategoryCache = { list: null, expireAt: 0 };

async function getSkillCategories() {
  if (skillCategoryCache.list && skillCategoryCache.expireAt > Date.now()) {
    return skillCategoryCache.list;
  }
  let list = null;
  try {
    const res = await db.collection('config').where({ key: 'app' }).limit(1).get();
    const raw = res.data[0] && res.data[0].skill_categories;
    if (Array.isArray(raw)) {
      const cleaned = [];
      raw.forEach(item => {
        const name = typeof item === 'string' ? item.trim() : '';
        if (name && cleaned.indexOf(name) === -1) cleaned.push(name);
      });
      if (cleaned.length > 0) list = cleaned;
    }
  } catch (err) {
    console.warn('[user] 读取技能分类配置失败，使用默认列表:', err && err.message);
  }
  const finalList = list || DEFAULT_SKILL_CATEGORIES;
  skillCategoryCache = { list: finalList, expireAt: Date.now() + SKILL_CATEGORY_CACHE_TTL };
  return finalList;
}

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
        phone: '',
        wechat_id: '',
        universityId: '',
        universityName: '',
        auctionCount: 0,
        auctionMonth: currentMonth,
        isStudentVerified: false,
        studentVerifyImage: '',
        studentVerifyStatus: '',
        studentVerifyTime: null,
        // 技能达人入驻
        expert_status: 'none',        // none | pending | approved | rejected
        expert_skills: [],
        expert_intro: '',
        expert_certs: [],
        expert_price_unit: 'negotiable', // per_time | per_hour | negotiable
        expert_price: null,
        expert_available_time: '',
        expert_reject_reason: '',
        expert_apply_time: null,
        // 评价聚合（由 review 云函数维护）
        rating_sum: 0,
        rating_count: 0,
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
    if (await isMaintenanceOn()) return { code: -1, msg: '系统维护中，请稍后再试' };
    const existing = await db.collection('user').where({ _openid: userOpenid }).get();
    if (existing.data.length === 0) {
      return { code: -1, msg: '用户不存在' };
    }
    const currentUser = existing.data[0];
    if (currentUser.banned) {
      return { code: -1, msg: '该账号已被封禁，无法操作' };
    }
    const updateData = { ...data };

    // 头像字段兜底：只接受上传到云存储的 fileID。
    // 空值 / 默认头像占位 / 其他非法值一律视为“未修改”并剔除，
    // 避免客户端未上传头像时把用户已有头像覆盖成空（进而全部回退到同一张默认图）。
    if (updateData.avatarUrl !== undefined) {
      const avatar = (updateData.avatarUrl || '').toString().trim();
      if (avatar && avatar.indexOf('cloud://') === 0) {
        updateData.avatarUrl = avatar;
      } else {
        console.warn('[user] 忽略无效的 avatarUrl，保留原头像:', avatar || '(空)');
        delete updateData.avatarUrl;
      }
    }

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

    // 旧客户端兼容：历史字段 contact 视为手机号
    if (updateData.contact !== undefined && updateData.phone === undefined) {
      updateData.phone = updateData.contact;
    }
    delete updateData.contact;

    // 手机号：仅用于账号找回，不对外展示
    if (updateData.phone !== undefined && updateData.phone) {
      if (!validatePhone(updateData.phone)) {
        return { code: -1, msg: '手机号格式不正确' };
      }
      updateData.phone = String(updateData.phone).trim();
    }

    // 微信号：必填、格式校验、全局唯一
    if (updateData.wechat_id !== undefined) {
      const wechatId = (updateData.wechat_id || '').toString().trim();
      if (!wechatId) {
        // 已设置过则视为“未修改”，未设置过则拒绝（必填）
        if (currentUser.wechat_id) {
          delete updateData.wechat_id;
        } else {
          return { code: -1, msg: '请填写微信号' };
        }
      } else if (!validateWechatId(wechatId)) {
        return { code: -1, msg: '微信号格式不正确' };
      } else {
        const dup = await db.collection('user')
          .where({ wechat_id: wechatId, _openid: _.neq(userOpenid) })
          .count();
        if (dup.total > 0) {
          return { code: -1, msg: '该微信号已被其他账号使用' };
        }
        updateData.wechat_id = wechatId;
      }
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

    // 格式兜底：仅在字段非空时校验（不在此处强制必填，避免登录时只提交学校而失败）
    const merged = { ...currentUser, ...updateData };
    if (merged.phone && !validatePhone(merged.phone)) {
      return { code: -1, msg: '手机号格式不正确' };
    }
    if (merged.wechat_id && !validateWechatId(merged.wechat_id)) {
      return { code: -1, msg: '微信号格式不正确' };
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

  // ===================== 技能达人入驻 =====================

  const PRICE_UNITS = ['per_time', 'per_hour', 'negotiable'];

  if (action === 'expertApply') {
    if (await isMaintenanceOn()) return { code: -1, msg: '系统维护中，请稍后再试' };
    const existing = await db.collection('user').where({ _openid: userOpenid }).get();
    if (existing.data.length === 0) return { code: -1, msg: '用户不存在' };
    const currentUser = existing.data[0];
    if (currentUser.banned) return { code: -1, msg: '该账号已被封禁，无法操作' };

    const d = data || {};
    const allowedSkills = await getSkillCategories();
    const skills = Array.isArray(d.expert_skills) ? d.expert_skills.filter(s => allowedSkills.indexOf(s) > -1) : [];
    if (skills.length === 0) return { code: -1, msg: '请至少选择一项技能分类' };

    const intro = (d.expert_intro || '').toString().trim();
    if (!intro) return { code: -1, msg: '请填写个人介绍' };
    if (intro.length > 200) return { code: -1, msg: '个人介绍不能超过200字' };

    const certs = Array.isArray(d.expert_certs) ? d.expert_certs.filter(c => typeof c === 'string' && c.indexOf('cloud://') === 0) : [];
    if (certs.length > 4) return { code: -1, msg: '证明图最多上传4张' };

    const priceUnit = PRICE_UNITS.indexOf(d.expert_price_unit) > -1 ? d.expert_price_unit : 'negotiable';
    const priceNum = Number(d.expert_price);
    const price = priceUnit === 'negotiable' ? null : (Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null);
    if (priceUnit !== 'negotiable' && !price) {
      return { code: -1, msg: '请填写参考报价金额' };
    }

    const textCheck = await checkTextSecurity(intro, '个人介绍');
    if (!textCheck.ok) return { code: -1, msg: textCheck.msg };
    for (const cert of certs) {
      const imgCheck = await checkImageSecurity(cert, '证明图');
      if (!imgCheck.ok) return { code: -1, msg: imgCheck.msg };
    }

    const updateData = {
      expert_skills: skills,
      expert_intro: intro,
      expert_certs: certs,
      expert_price_unit: priceUnit,
      expert_price: price,
      expert_available_time: (d.expert_available_time || '').toString().trim().slice(0, 60),
      expert_reject_reason: '',
      expert_apply_time: db.serverDate(),
      // 暂无人审后台：提交即通过（如需人工审核，把下面改为 'pending' 并走 expertAudit）
      expert_status: 'approved',
      updateTime: db.serverDate()
    };

    await db.collection('user').doc(currentUser._id).update({ data: updateData });
    const fresh = await db.collection('user').where({ _openid: userOpenid }).get();
    return { code: 0, data: fresh.data[0], msg: '已开通技能达人' };
  }

  // 本人撤销入驻
  if (action === 'expertWithdraw') {
    const existing = await db.collection('user').where({ _openid: userOpenid }).get();
    if (existing.data.length === 0) return { code: -1, msg: '用户不存在' };
    await db.collection('user').doc(existing.data[0]._id).update({
      data: { expert_status: 'none', updateTime: db.serverDate() }
    });
    return { code: 0, msg: '已撤销达人身份' };
  }

  // 管理员审核/撤销达人（预留人工审核与小程序内撤销入口）
  if (action === 'expertAudit') {
    const me = await db.collection('user').where({ _openid: userOpenid }).get();
    const isAdmin = me.data.length > 0 && me.data[0].isAdmin === true;
    if (!isAdmin) return { code: -1, msg: '无管理员权限' };

    const { userId, result, reason } = event;
    if (!userId || ['approved', 'rejected', 'none'].indexOf(result) === -1) {
      return { code: -1, msg: '参数错误' };
    }
    const target = await db.collection('user').where({ _id: userId }).limit(1).get();
    if (!target.data.length) return { code: -1, msg: '目标用户不存在' };

    await db.collection('user').doc(userId).update({
      data: {
        expert_status: result === 'none' ? 'none' : result,
        expert_reject_reason: result === 'rejected' ? (reason || '').toString().trim() : '',
        updateTime: db.serverDate()
      }
    });
    const msgMap = { approved: '已通过达人审核', rejected: '已驳回达人申请', none: '已撤销达人身份' };
    return { code: 0, msg: msgMap[result] };
  }

  return { code: -1, msg: '未知操作' };
};