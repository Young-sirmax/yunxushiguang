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
  hideLoading
};
