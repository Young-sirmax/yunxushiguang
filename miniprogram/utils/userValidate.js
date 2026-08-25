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

/** 联系方式：微信号/手机号，4-30位 */
const validateContact = (value) => {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return { valid: false, error: '请输入微信号或手机号' };
  }
  if (trimmed.length < 4 || trimmed.length > 30) {
    return { valid: false, error: '请输入正确的微信号或手机号' };
  }
  return { valid: true, error: '' };
};

const isRegistrationComplete = (userInfo) => {
  if (!userInfo) return false;
  const { universityId, realName, studentId, contact } = userInfo;
  if (!universityId || !realName || !studentId || !contact) return false;
  return validateStudentId(studentId).valid && validateContact(contact).valid;
};

module.exports = {
  validateStudentId,
  validateContact,
  isRegistrationComplete
};
