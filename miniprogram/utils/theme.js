// utils/theme.js —— canvas 侧的设计令牌镜像
//
// ⚠️ canvas 读不到 CSS 变量，所以 styles/theme.wxss 里凡是 canvas 会用到的颜色，
//    必须在这里再写一份，两处**同步修改**：
//      miniprogram/styles/theme.wxss  → 全站唯一色板（页面的唯一来源）
//      miniprogram/utils/theme.js    → TOKENS / TYPE_THEME（canvas 的唯一来源）
//
// 类型 → 色系（低饱和，与 wxss 的 --type-* 一一对应）：
//   idle     闲置     绿青  #7EE8C7 → #4ECDC4
//   exchange 以物易物 橙    #FFD194 → #FFB37B
//   wanted   求购     紫    #C9BEFF → #A78BFA
//   skill    技能服务 蓝    #A1C4FD → #7FB3FF

// canvas 用到的中性 / 语义色
const TOKENS = {
  primary: '#22b07d',
  primaryDark: '#14915f',
  primaryLight: '#e9f7f0',
  price: '#f5402f',
  text: '#1f2329',
  textRgb: '31, 35, 41',      // 需要半透明墨色时用（rgba 不能直接塞 hex 变量）
  textSecondary: '#646a73',
  textLight: '#9aa0a6',
  border: '#eff0f2',
  bg: '#f6f7f9',
  fill: '#eff0f2',
  fillStrong: '#e4e6ea',
  white: '#ffffff',
  warning: '#f5a623',
  error: '#f5402f',
  // 图上文字高亮：深色遮罩上唯一的高亮色（警告色的浅档，同色相、
  // 只为在暗底上拉足对比度；气泡/展开动画里的价格与类型文案都用它）
  onImage: '#ffe08a'
};

// 类型主题色：气泡渐变描边 / 填充 / 卡片角标共用
const TYPE_THEME = {
  idle: { from: '#7ee8c7', to: '#4ecdc4', label: '闲置', text: '#12a08e', soft: '#e6f7f2' },
  wanted: { from: '#c9beff', to: '#a78bfa', label: '求购', text: '#7b5bd6', soft: '#f1ecfe' },
  exchange: { from: '#ffd194', to: '#ffb37b', label: '易物', text: '#c4763c', soft: '#fff4e9' },
  skill: { from: '#a1c4fd', to: '#7fb3ff', label: '技能', text: '#4c86d9', soft: '#ebf3ff' }
};

// 数据层的 type 取值（sell/want/exchange/skill）→ 类型主题 key
// 上游沿用历史命名，展示层统一收敛到 idle/wanted 这套新名
const TYPE_KEY_MAP = {
  sell: 'idle',
  want: 'wanted',
  exchange: 'exchange',
  skill: 'skill'
};

function getTypeKey(type) {
  return TYPE_KEY_MAP[type] || 'idle';
}

function getTypeTheme(type) {
  return TYPE_THEME[getTypeKey(type)];
}

/**
 * 绘制类型渐变描边圆环（低饱和、沿圆周方向渐变）
 * - 支持 createConicGradient 时用锥形渐变（真正的圆周方向）
 * - 不支持时退化为 135° 线性渐变（同样低饱和、视觉一致）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx 圆心 x
 * @param {number} cy 圆心 y
 * @param {number} r  半径
 * @param {string} type 帖子类型
 * @param {number} [lineWidth] 线宽，默认 3
 */
function strokeTypeRing(ctx, cx, cy, r, type, lineWidth) {
  const theme = getTypeTheme(type);
  const lw = lineWidth || 3;
  let grad;

  if (typeof ctx.createConicGradient === 'function') {
    grad = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    grad.addColorStop(0, theme.from);
    grad.addColorStop(0.5, theme.to);
    grad.addColorStop(1, theme.from);
  } else {
    grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grad.addColorStop(0, theme.from);
    grad.addColorStop(1, theme.to);
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, r - lw / 2), 0, Math.PI * 2);
  ctx.strokeStyle = grad;
  ctx.lineWidth = lw;
  ctx.stroke();
  ctx.restore();
}

module.exports = { TOKENS, TYPE_THEME, TYPE_KEY_MAP, getTypeKey, getTypeTheme, strokeTypeRing };
