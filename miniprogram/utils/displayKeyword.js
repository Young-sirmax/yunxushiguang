// utils/displayKeyword.js —— 气泡展示短标题（纯本地规则，不依赖任何外部接口）
//
// 用途：首页圆形气泡空间有限，直接截标题前 N 字会出现「华为HUAWE…」这类
//      无意义截断。改为：清洗套话 → 取前 6 字（按词边界收尾）→ 分类/类型兜底。
//
// 用法：
//   const { buildDisplayKeyword } = require('../../utils/displayKeyword.js');
//   const kw = buildDisplayKeyword({ title, type, categoryName, skillName });
//
// 规则细节见 docs/气泡关键字规则.md，测试用例见 displayKeyword.test.js

const MAX_LEN = 6;

// 首尾需要剥离的买卖套话词（长的优先，避免「出售」被「出」抢先匹配）
const EDGE_WORDS = [
  '以物换物', '可议价', '可小刀', '包邮', '出售', '转让', '闲置',
  '急出', '全新', '求购', '出', '收', '换'
].sort((a, b) => b.length - a.length);

// 类型兜底名
const TYPE_LABEL = { sell: '闲置', want: '求购', exchange: '以物易物', skill: '技能服务' };

// emoji / 符号（部分老基础库不支持 \u{...} 转义，做一次兜底构造）
let EMOJI_RE;
try {
  EMOJI_RE = new RegExp('[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{200D}]', 'gu');
} catch (err) {
  EMOJI_RE = /[☀-➿️‍]/g;
}

// 标点（中英文）→ 空格
const PUNCT_RE = /[，。！？、；：""''《》〈〉【】〔〕（）()\[\]{}<>~·\-—_*=+|\\/]+/g;

// 单个汉字套话词（出 / 收 / 换）：要求剥离后仍剩 >=3 字，避免误伤「收纳盒」这类词
const SINGLE_CHAR_MIN_REST = 3;

/**
 * 清洗标题
 * 顺序：去 emoji → 标点转空格 → 反复剥离首尾套话 → 压缩空格
 * @param {string} raw
 * @returns {string}
 */
function cleanTitle(raw) {
  let s = String(raw == null ? '' : raw);

  // 1) 去 emoji
  s = s.replace(EMOJI_RE, '');

  // 2) 标点 → 空格（先做，否则「【急出】xxx」的套话词不在首尾、剥离不掉）
  s = s.replace(PUNCT_RE, ' ');

  // 3) 反复剥离首尾套话（如「出售 转让 xxx」）
  let guard = 0;
  let changed = true;
  while (changed && guard < 12) {
    changed = false;
    guard += 1;
    const t = s.trim();
    for (let i = 0; i < EDGE_WORDS.length; i++) {
      const w = EDGE_WORDS[i];
      const minRest = w.length === 1 ? SINGLE_CHAR_MIN_REST - 1 : 1;
      if (t.length >= w.length + minRest && t.indexOf(w) === 0) {
        s = t.slice(w.length);
        changed = true;
        break;
      }
      if (t.length >= w.length + minRest && t.slice(t.length - w.length) === w) {
        s = t.slice(0, t.length - w.length);
        changed = true;
        break;
      }
    }
  }

  // 4) 压缩空格并去掉首尾残留连接符
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s\-—_·]+/, '').replace(/[\s\-—_·]+$/, '');
  return s.trim();
}

/**
 * 是否"有意义"：去掉所有套话词与空格后仍需 >=2 字
 * 用于过滤「出售」「全新」这类整句都是套话的清洗结果
 * @param {string} text
 * @returns {boolean}
 */
function isMeaningful(text) {
  let t = String(text == null ? '' : text).replace(/\s+/g, '');
  for (let i = 0; i < EDGE_WORDS.length; i++) {
    t = t.split(EDGE_WORDS[i]).join('');
  }
  return t.length >= 2;
}

/**
 * 截断到 max 字，并按词边界收尾：
 *   1) 切点落在半截英文/数字词中 → 丢弃该残词（「华为HUAWEI…」→「华为」）
 *   2) 末尾只剩 1 个字 → 丢弃该残词（「高等数学 上」→「高等数学」）
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
function truncateNice(text, max) {
  const limit = max || MAX_LEN;
  const s = String(text == null ? '' : text);
  if (s.length <= limit) return s;

  let cut = s.slice(0, limit);

  const asciiTail = /[A-Za-z0-9]+$/.exec(cut);
  if (asciiTail) {
    const stripped = cut.slice(0, asciiTail.index).replace(/[\s\-—_·]+$/, '');
    if (stripped.length >= 2) cut = stripped;
  }

  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 0 && cut.length - lastSpace - 1 === 1) {
    cut = cut.slice(0, lastSpace);
  }

  return cut.replace(/[\s\-—_·]+$/, '');
}

/**
 * 生成气泡展示短标题
 * 规则：skill 优先用技能分类名 → 清洗标题 → 前 6 字 → 分类名 → 原标题 → 类型兜底
 * @param {{title?:string, type?:string, categoryName?:string, skillName?:string}} options
 * @returns {string}
 */
function buildDisplayKeyword(options) {
  const opt = options || {};
  const type = opt.type || 'sell';

  // 技能服务：优先用技能分类名（如「家教辅导」）
  if (type === 'skill') {
    const skill = cleanTitle(opt.skillName);
    if (isMeaningful(skill)) return truncateNice(skill);
  }

  const cleaned = cleanTitle(opt.title);
  if (isMeaningful(cleaned)) return truncateNice(cleaned);

  // 兜底 1：分类名
  const category = cleanTitle(opt.categoryName);
  if (isMeaningful(category)) return truncateNice(category);

  // 兜底 2：原标题（保持现状）
  const rawTitle = String(opt.title == null ? '' : opt.title).trim();
  if (rawTitle.length >= 2) return truncateNice(rawTitle);

  // 兜底 3：类型名
  return TYPE_LABEL[type] || TYPE_LABEL.sell;
}

module.exports = {
  MAX_LEN,
  EDGE_WORDS,
  TYPE_LABEL,
  cleanTitle,
  isMeaningful,
  truncateNice,
  buildDisplayKeyword
};
