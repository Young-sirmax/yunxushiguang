// utils/avatar.js —— 头像的统一处理：有效性判定、字母头像兜底、云存储上传
// 约定：合法头像一律是上传到云存储的 fileID（cloud:// 开头），展示时直接交给 <image src>，
// 与商品图走同一条链路，不额外引入 getTempFileURL 之类的第二套逻辑。

const { compressImage } = require('./image.js');

const AVATAR_DIR = 'avatars';

/**
 * 头像是否可用。
 * 空值、微信默认灰头像(http 链接)、被写坏的历史值、本地临时路径一律判为无效，
 * 交给字母头像兜底，避免页面上出现空白圆圈。
 */
const isValidAvatar = (url) => typeof url === 'string' && url.indexOf('cloud://') === 0;

/** 昵称首字符：中文取首字，英文取首字母大写；没有昵称时用占位图标 */
const letterAvatar = (nickName) => {
  const name = (nickName || '').trim();
  if (!name) return '👤';
  const first = name[0];
  return /[a-z]/.test(first) ? first.toUpperCase() : first;
};

// 字母头像底色池：只取设计令牌里的颜色（写 var() 而不是色值，改主色时自动跟随）
// 选的是各色相里较深的一档，保证白色字母在底色上读得清（对比度均 ≥ 2.8）
const LETTER_COLORS = [
  'var(--primary)',
  'var(--primary-dark)',
  'var(--type-idle-text)',
  'var(--type-exchange-text)',
  'var(--type-wanted-text)',
  'var(--type-skill-text)',
  'var(--error)'
];

/** 按用户标识取稳定底色，同一用户每次进来颜色一致 */
const letterColor = (seed) => {
  const s = String(seed || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) % 100000;
  }
  return LETTER_COLORS[hash % LETTER_COLORS.length];
};

/**
 * 统一的头像展示态：有合法 fileID 展示图片，否则回退字母头像
 * @returns {{useImage:boolean, src:string, letter:string, color:string}}
 */
const avatarView = (userInfo) => {
  const u = userInfo || {};
  if (isValidAvatar(u.avatarUrl)) {
    return { useImage: true, src: u.avatarUrl, letter: '', color: '' };
  }
  return {
    useImage: false,
    src: '',
    letter: letterAvatar(u.nickName),
    color: letterColor(u._openid || u.nickName)
  };
};

/** 云存储路径：avatars/{openid}/{时间戳}.{ext} */
const buildAvatarPath = (filePath) => {
  let openid = '';
  try {
    openid = (wx.getStorageSync('openid') || '').replace(/[^a-zA-Z0-9]/g, '');
  } catch (err) {
    openid = '';
  }
  const matched = /\.([a-zA-Z0-9]{1,5})(?:\?|#|$)/.exec(filePath || '');
  const ext = matched ? matched[1].toLowerCase() : 'png';
  return `${AVATAR_DIR}/${openid || 'anonymous'}/${Date.now()}.${ext}`;
};

/**
 * 上传头像到云存储并返回 fileID（先压缩，失败一律抛出由调用方 toast）
 * @param {string} localPath chooseAvatar 回调里的临时路径
 * @returns {Promise<string>} fileID
 */
const uploadAvatar = async (localPath) => {
  if (!localPath) throw new Error('未获取到头像，请重试');
  const compressed = await compressImage(localPath);
  const res = await wx.cloud.uploadFile({
    cloudPath: buildAvatarPath(compressed),
    filePath: compressed
  });
  if (!res || !res.fileID) throw new Error('头像上传失败，请重试');
  return res.fileID;
};

module.exports = {
  isValidAvatar,
  letterAvatar,
  letterColor,
  avatarView,
  buildAvatarPath,
  uploadAvatar
};
