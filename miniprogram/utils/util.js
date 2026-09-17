const formatTime = date => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = date.getSeconds();
  return `${[year, month, day].map(formatNumber).join('/')} ${[hour, minute, second].map(formatNumber).join(':')}`;
};

const formatNumber = n => {
  n = n.toString();
  return n[1] ? n : `0${n}`;
};

const formatDate = timestamp => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return Math.floor(diff / minute) + '分钟前';
  if (diff < day) return Math.floor(diff / hour) + '小时前';
  if (diff < 7 * day) return Math.floor(diff / day) + '天前';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

const showToast = (title, icon = 'none') => {
  wx.showToast({ title, icon, duration: 2000 });
};

/**
 * 生成唯一的云存储路径，确保不同用户、多次上传都不会互相覆盖
 * 结构：{dir}/{时间戳}_{随机段1}{随机段2}_{用户标识}.{真实扩展名}
 * @param {string} dir 云存储目录，如 'avatars'
 * @param {string} filePath 本地临时文件路径（用于推断真实扩展名）
 * @param {string} defaultExt 推断失败时的默认扩展名
 */
const buildCloudPath = (dir, filePath, defaultExt = 'png') => {
  const randomSeg = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

  let ext = defaultExt;
  const matched = /\.([a-zA-Z0-9]{1,5})(?:\?|#|$)/.exec(filePath || '');
  if (matched) ext = matched[1].toLowerCase();

  let uid = '';
  try {
    uid = (wx.getStorageSync('openid') || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  } catch (err) {
    uid = '';
  }

  const parts = [Date.now(), randomSeg()];
  if (uid) parts.push(uid);
  return `${dir}/${parts.join('_')}.${ext}`;
};

let loadingCount = 0;

const showLoading = (title = '加载中...') => {
  loadingCount += 1;
  if (loadingCount === 1) {
    wx.showLoading({ title, mask: true });
  }
};

const hideLoading = () => {
  if (loadingCount > 0) {
    loadingCount -= 1;
  }
  if (loadingCount === 0) {
    wx.hideLoading();
  }
};

module.exports = {
  formatTime,
  formatDate,
  showToast,
  showLoading,
  hideLoading,
  buildCloudPath
};
