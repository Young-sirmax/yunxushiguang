// utils/theme.js —— 类型主题色（与 app.wxss 的 --type-* 变量保持一致）
// ⚠️ canvas 读不到 CSS 变量，两处需同步修改：
//    miniprogram/app.wxss  → --type-sell-from / --type-sell-to 等
//    miniprogram/utils/theme.js → TYPE_THEME（本文件）
//
// 类型 → 色系：
//   sell     闲置     绿青  #7ee8c7 → #4ecdc4
//   want     求购     紫    #c7b9ff → #a18cd1
//   exchange 以物易物 橙    #ffd194 → #ff9a76
//   skill    技能服务 蓝    #a1c4fd → #84c1ff

const TYPE_THEME = {
  sell: { from: '#7ee8c7', to: '#4ecdc4', label: '闲置', text: '#00a89b' },
  want: { from: '#c7b9ff', to: '#a18cd1', label: '求购', text: '#a18cd1' },
  exchange: { from: '#ffd194', to: '#ff9a76', label: '易物', text: '#e8734a' },
  skill: { from: '#a1c4fd', to: '#84c1ff', label: '技能', text: '#4a90e2' }
};

function getTypeTheme(type) {
  return TYPE_THEME[type] || TYPE_THEME.sell;
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

module.exports = { TYPE_THEME, getTypeTheme, strokeTypeRing };
