/**
 * 学号格式：10 位数字，前 4 位为入学年份（2000-2099），其余数字暂不作校验
 * 示例：2024011251
 */
const validateStudentId = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return { valid: false, error: '请输入学号' };
  }
  if (!/^\d{10}$/.test(trimmed)) {
    return { valid: false, error: '学号必须为10位数字' };
  }
  const year = parseInt(trimmed.substring(0, 4), 10);
  if (year < 2000 || year > 2099) {
    return { valid: false, error: '入学年份格式不正确（前4位为入学年份）' };
  }
  return { valid: true, error: '' };
};

/**
 * 微信号：字母开头，6-20 位，仅含字母、数字、下划线、减号
 * 示例：xiaoshi_2024
 */
const WECHAT_ID_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/;

const validateWechatId = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return { valid: false, error: '请输入微信号' };
  }
  if (!WECHAT_ID_REGEX.test(trimmed)) {
    return { valid: false, error: '微信号格式不正确' };
  }
  return { valid: true, error: '' };
};

/** 手机号：11 位、1 开头（仅用于账号找回，不对外展示） */
const validatePhone = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return { valid: false, error: '请输入手机号' };
  }
  if (!/^1\d{10}$/.test(trimmed)) {
    return { valid: false, error: '手机号格式不正确' };
  }
  return { valid: true, error: '' };
};

/** 注册是否完成：以"已填写合法微信号"为准 */
const isRegistrationComplete = (userInfo) => {
  if (!userInfo) return false;
  return validateWechatId(userInfo.wechat_id).valid;
};

const isStudentVerified = (userInfo) => {
  if (!userInfo) return false;
  return !!userInfo.isStudentVerified;
};

module.exports = {
  WECHAT_ID_REGEX,
  validateStudentId,
  validateWechatId,
  validatePhone,
  isRegistrationComplete,
  isStudentVerified
};