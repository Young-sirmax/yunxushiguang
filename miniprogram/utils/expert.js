// utils/expert.js —— 技能达人 / 技能服务共用常量与格式化

// 技能分类「兜底」列表：正式来源是 config 集合（见 app.getSkillCategories，前端缓存 1 小时）。
// 仅在配置读取失败且无本地缓存时使用，保证离线也能正常渲染；增删分类请改配置，不要改这里。
const FALLBACK_SKILL_CATEGORIES = [
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

// 兼容旧引用：等价于兜底列表（新代码请用 app.getSkillCategories()）
const EXPERT_SKILLS = FALLBACK_SKILL_CATEGORIES;

// 报价模式
const PRICE_UNITS = [
  { value: 'per_time', label: '按次' },
  { value: 'per_hour', label: '按小时' },
  { value: 'negotiable', label: '面议' }
];

// ===================== 技能参考价区间（仅提示，不做强制定价） =====================
// 默认值写在这里作为兜底；如需不改代码调整，请在 config 集合 app 记录里加同结构字段：
//   "skill_price_ref": { "家教辅导": { "min": 30, "max": 80, "unit": "per_hour" }, ... }
// （config 里的配置优先，前端这份只是默认值/离线兜底）
const SKILL_PRICE_REF = {
  '项目辅导': { min: 30, max: 80, unit: 'per_hour' },
  '科研教学': { min: 50, max: 150, unit: 'per_hour' },
  '学科竞赛': { min: 40, max: 120, unit: 'per_hour' },
  '论文写作': { min: 50, max: 150, unit: 'per_time' },
  '编程开发': { min: 50, max: 150, unit: 'per_time' },
  '设计剪辑': { min: 30, max: 100, unit: 'per_time' },
  '乐器教学': { min: 40, max: 100, unit: 'per_hour' },
  '摄影修图': { min: 20, max: 50, unit: 'per_time' },
  '运动陪练': { min: 20, max: 60, unit: 'per_hour' },
  '其他': { min: 10, max: 50, unit: 'per_time' }
};

const PRICE_REF_UNIT_LABEL = { per_time: '次', per_hour: '小时' };

/**
 * 取某技能分类的参考价区间
 * @param {string} skillName 技能分类名
 * @param {object} [overrideTable] 来自 config 的覆盖表（优先）
 * @returns {{min:number,max:number,unit:string}|null}
 */
function getSkillPriceRef(skillName, overrideTable) {
  if (!skillName) return null;
  const fromConfig = overrideTable && typeof overrideTable === 'object' ? overrideTable[skillName] : null;
  return fromConfig || SKILL_PRICE_REF[skillName] || null;
}

/**
 * 参考价提示文案："该类目参考价：30-80 元/小时"
 */
function formatPriceRef(ref) {
  if (!ref) return '';
  const unit = PRICE_REF_UNIT_LABEL[ref.unit] || '次';
  return '该类目参考价：' + ref.min + '-' + ref.max + ' 元/' + unit;
}

/**
 * 价格是否显著超出参考区间（默认超出上限 50% 以上 / 低于下限 50% 以下）
 * ⚠️ 当前仅作为后续观察用的工具函数，不参与任何展示与校验（不做 judge）
 * @returns {boolean}
 */
function isPriceOutOfRef(price, ref, threshold) {
  const p = Number(price) || 0;
  if (!ref || p <= 0) return false;
  const t = typeof threshold === 'number' ? threshold : 0.5;
  return p > ref.max * (1 + t) || p < ref.min * (1 - t);
}

/**
 * 报价文案：¥xx/次 · ¥xx/小时 · 面议
 */
function formatSkillPrice(unit, price) {
  const amount = Number(price) || 0;
  if (!unit || unit === 'negotiable' || amount <= 0) return '面议';
  return '¥' + amount + (unit === 'per_hour' ? '/小时' : '/次');
}

/**
 * 技能标签数组 → 展示文本
 */
function joinSkills(skills) {
  return Array.isArray(skills) ? skills.join('、') : '';
}

/**
 * 评分展示：4.6（12条）
 */
function formatRating(avg, count) {
  const c = Number(count) || 0;
  if (c <= 0) return '';
  const a = Number(avg) || 0;
  return a.toFixed(1) + '（' + c + '条评价）';
}

module.exports = {
  FALLBACK_SKILL_CATEGORIES,
  EXPERT_SKILLS,
  PRICE_UNITS,
  SKILL_PRICE_REF,
  getSkillPriceRef,
  formatPriceRef,
  isPriceOutOfRef,
  formatSkillPrice,
  joinSkills,
  formatRating
};
