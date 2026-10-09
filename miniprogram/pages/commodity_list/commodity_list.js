// pages/commodity_list/commodity_list.js
const API = require('../../api/api.js');
const { formatDate } = require('../../utils/util.js');
const { COLLEGE_LIST, getMajorsByCollege, isBookCategoryName } = require('../../utils/majors.js');
const { buildDisplayKeyword } = require('../../utils/displayKeyword.js');
const { strokeTypeRing, getTypeTheme, TOKENS } = require('../../utils/theme.js');
const { computeBubbleLayout, packBubbles, latticeSlots } = require('../../utils/bubbleLayout.js');
const imageView = require('../../utils/imageView.js');

// ===== 浏览模式 =====
// 列表模式（默认）：两列瀑布流，信息密度高，商品多了也不挤
// 小球模式：原气泡交互，保留为可切换玩法
const VIEW_MODE_KEY = 'homeViewMode';
const VIEW_LIST = 'list';
const VIEW_BUBBLE = 'bubble';

// 物理常量（七彩正圆泡泡：轻飘飘 · 一点点重力 · 碰撞轻轻反弹）
// 说明：商品变多后原先「重力大 + 回弹弱」会让泡泡在底部堆叠、边缘交叠。
// 调参方向——重力调小、回锚柔力调大，让泡泡稳定停在自己的锚点上，不再下沉堆挤。
const GRAVITY = 0.012;     // 一点点重力（向下）：泡泡有轻微沉坠感
const DAMPING = 0.94;      // 空气阻尼：动作轻盈，但会自然渐缓不失控
const RESTITUTION = 0.7;   // 泡泡间碰撞弹性：轻轻反弹
const SPRING_K = 0.012;    // 回“悬浮点”的柔力：稳住锚点，避免沉底/扎堆
const RELAX_ITER = 2;      // 每帧位置修正迭代次数：手指拨乱后更快分开，不留交叠
const TOUCH_RADIUS = 90;   // 手指影响的半径
const WIND_PROB = 0.02;    // 微风触发概率（每帧）
const WIND_FORCE = 0.18;   // 微风脉冲强度（偶尔上飘，制造轻飘飘感）
const MAX_SPEED = 2.4;     // 速度软上限（px/帧）

// 泡泡尺寸区间：直径从 220rpx（少）自适应收缩到 104rpx（多），保证都能铺下且不交叠
const BUBBLE_MAX_RPX = 220;
const BUBBLE_MIN_RPX = 104;

// 屏幕宽度（px），用于 rpx → px 换算（canvas 绘制使用 CSS px）
function getWindowWidth() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo().windowWidth;
    return wx.getSystemInfoSync().windowWidth;
  } catch (err) {
    return 375;
  }
}

// rpx → px
function rpxToPx(rpx) {
  return (getWindowWidth() / 750) * rpx;
}

// 轻微明度浮动（±amount，0~1）：同一类型色下每颗泡泡略有深浅差，避免一片死板
// 只动明度不动色相，不引入新颜色
function shiftLightness(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const to = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  const R = Math.round((num >> 16) + (to - (num >> 16)) * k);
  const G = Math.round(((num >> 8) & 0x00ff) + (to - ((num >> 8) & 0x00ff)) * k);
  const B = Math.round((num & 0x0000ff) + (to - (num & 0x0000ff)) * k);
  return `rgb(${R},${G},${B})`;
}

// 用 _id 做稳定散列：同一条商品每次进来深浅一致，不会闪
function stableHash(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) % 100000;
  }
  return h;
}

// 技能报价文案：按次 / 按小时 / 面议
function formatSkillPrice(unit, price) {
  const amount = Number(price) || 0;
  if (unit === 'negotiable' || !amount) return '面议';
  return '¥' + amount + (unit === 'per_hour' ? '/小时' : '/次');
}

// 闲置报价文案：价格为 0 = 发布者未定价（批量上架极简模式允许留空），显示「面议」而不是「¥0」。
// 与列表卡片、详情页、分享文案共用同一口径。
function formatSellPrice(price) {
  const amount = Number(price) || 0;
  return amount > 0 ? '¥' + amount : '面议';
}

// ===== 泡泡排布 =====
// 排布算法（自适应半径 + 错位网格，几何保证不交叠）在 utils/bubbleLayout.js，
// 纯函数、可在 Node 里跑回归测试（tests/bubbleLayout.test.js）。
// 这里只负责把算出来的半径与容量接到页面上。

// 为圆形初始化物理（正圆泡泡：圆心 + 速度 + 悬浮锚点）
function initPhysics(circle) {
  circle.center = { x: circle.x, y: circle.y };
  // 入场时给一点随机初速度，让画面一开始就自然轻盈
  circle.vx = (Math.random() - 0.5) * 0.6;
  circle.vy = (Math.random() - 0.5) * 0.6 - 0.15;
  // 悬浮锚点：泡泡被拨开/撞开后，会轻轻“飘”回自己的位置，形成悬浮云团效果
  circle.rx = circle.x;
  circle.ry = circle.y;
  circle.particles = []; // 空数组兼容旧代码；渲染已改为绝对正圆
}

// 正圆泡泡物理更新（轻飘飘 · 一点重力 · 碰撞软弹 · 悬浮不扎堆）
function physicsUpdate(circles, containerW, containerH) {
  // 1) 速度与位置积分
  for (const circle of circles) {
    if (!circle.center) continue;
    const c = circle.center;
    let vx = (circle.vx || 0) * DAMPING;
    let vy = (circle.vy || 0) * DAMPING + GRAVITY;

    // 微风：偶尔轻推一下（含轻微上扬），制造“轻飘飘”的呼吸感
    if (Math.random() < WIND_PROB) {
      vx += (Math.random() - 0.5) * WIND_FORCE;
      vy -= Math.random() * WIND_FORCE * 0.9;
    }

    // 悬浮柔力：被拨开/撞开后轻轻飘回自己的位置
    vx -= SPRING_K * (c.x - circle.rx);
    vy -= SPRING_K * (c.y - circle.ry);

    // 速度软上限，防止失控弹跳
    const sp2 = vx * vx + vy * vy;
    if (sp2 > MAX_SPEED * MAX_SPEED) {
      const s = MAX_SPEED / Math.sqrt(sp2);
      vx *= s;
      vy *= s;
    }

    c.x += vx;
    c.y += vy;
    circle.vx = vx;
    circle.vy = vy;
  }

  // 2) 泡泡两两碰撞：先推开消除重叠，再沿法线方向“轻轻反弹”
  //    迭代 RELAX_ITER 次：一次推不完的密集区（手指拨过之后）第二次继续分开，
  //    保证每帧结束时画面里没有压在一起的泡泡
  for (let iter = 0; iter < RELAX_ITER; iter++) {
    // 冲量只在第一轮施加，后续轮次只做位置修正，避免能量被反复注入
    const applyImpulse = iter === 0;
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const A = circles[i];
        const B = circles[j];
        if (!A.center || !B.center) continue;
        const ax = A.center.x, ay = A.center.y;
        const bx = B.center.x, by = B.center.y;
        const dx = bx - ax, dy = by - ay;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = A.radius + B.radius;

        if (dist > 0 && dist < minDist) {
          const nx = dx / dist, ny = dy / dist;
          const overlap = minDist - dist;
          A.center.x -= nx * overlap / 2;
          A.center.y -= ny * overlap / 2;
          B.center.x += nx * overlap / 2;
          B.center.y += ny * overlap / 2;

          // 相对速度沿法线的分量 < 0 表示相互接近，此时才反弹
          if (applyImpulse) {
            const rel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
            if (rel < 0) {
              const impulse = -(1 + RESTITUTION) * rel / 2;
              A.vx -= impulse * nx;
              A.vy -= impulse * ny;
              B.vx += impulse * nx;
              B.vy += impulse * ny;
            }
          }
        }
      }
    }
  }

  // 3) 容器边界：软性反弹
  for (const circle of circles) {
    if (!circle.center) continue;
    const c = circle.center;
    const r = circle.radius;
    if (c.x < r) {
      c.x = r;
      circle.vx = Math.abs(circle.vx) * 0.6;
    } else if (c.x > containerW - r) {
      c.x = containerW - r;
      circle.vx = -Math.abs(circle.vx) * 0.6;
    }
    if (c.y < r) {
      c.y = r;
      circle.vy = Math.abs(circle.vy) * 0.6;
    } else if (c.y > containerH - r) {
      c.y = containerH - r;
      circle.vy = -Math.abs(circle.vy) * 0.6;
    }
  }
}

// Canvas渲染
function renderCircles(ctx, circles, containerW, containerH, expandState, preview) {
  ctx.clearRect(0, 0, containerW, containerH);

  // 绘制背景（与页面同色，泡泡区不出现第二种底色）
  const gradient = ctx.createLinearGradient(0, 0, 0, containerH);
  gradient.addColorStop(0, TOKENS.bg);
  gradient.addColorStop(1, TOKENS.fill);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, containerW, containerH);

  // 焦点态：alpha 0→1 平滑过渡（长按预览时，其他泡泡变暗/轻微模糊）
  const focusAlpha = (preview && preview.circleId && preview.alpha > 0.01) ? preview.alpha : 0;
  const canBlur = focusAlpha > 0 && ('filter' in ctx);
  if (canBlur) {
    ctx.filter = `blur(${(2.5 * focusAlpha).toFixed(2)}px)`;
  }

  // 展开动画中的圆形最后绘制（在最上层）
  let expandingCircle = null;

  for (const circle of circles) {
    const isExpanding = expandState && expandState.circleId === circle._id;
    if (isExpanding) {
      expandingCircle = circle;
      continue; // 跳过，稍后单独渲染
    }

    // 焦点泡泡先跳过，等遮罩铺好后再清晰重绘到最上层
    if (focusAlpha > 0 && preview.circleId === circle._id) continue;

    if (focusAlpha > 0) ctx.globalAlpha = 1 - 0.5 * focusAlpha;
    drawSingleCircle(ctx, circle);
    if (focusAlpha > 0) ctx.globalAlpha = 1;
  }

  if (canBlur) ctx.filter = 'none';

  // 焦点态：整体压暗 + 焦点泡泡放大 1.1 倍并高亮描边
  if (focusAlpha > 0) {
    ctx.fillStyle = `rgba(${TOKENS.textRgb}, ${(0.3 * focusAlpha).toFixed(3)})`;
    ctx.fillRect(0, 0, containerW, containerH);

    const focused = circles.find(c => c._id === preview.circleId);
    if (focused) {
      const scale = 1 + 0.1 * focusAlpha; // 微反馈：scale → 1.1
      ctx.save();
      ctx.translate(focused.center.x, focused.center.y);
      ctx.scale(scale, scale);
      ctx.translate(-focused.center.x, -focused.center.y);
      drawSingleCircle(ctx, focused);

      // 高亮描边
      ctx.beginPath();
      ctx.arc(focused.center.x, focused.center.y, focused.radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.9 * focusAlpha).toFixed(2)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 渲染展开中的圆形
  if (expandingCircle && expandState) {
    drawExpandingCircle(ctx, expandingCircle, expandState, containerW, containerH);
  }
}

// 绘制普通圆形（正圆泡泡）
function drawSingleCircle(ctx, circle) {
  const cx = circle.center.x;
  const cy = circle.center.y;
  const r = circle.radius;
  const baseColor = circle.color;

  // 正圆主体 + 立体渐变（清透泡泡质感）
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const fillGradient = ctx.createRadialGradient(
    cx - r * 0.35, cy - r * 0.35, r * 0.08,
    cx, cy, r * 1.1
  );
  fillGradient.addColorStop(0, lightenColor(baseColor, 45));
  fillGradient.addColorStop(0.5, lightenColor(baseColor, 6));
  fillGradient.addColorStop(1, darkenColor(baseColor, 16));
  ctx.fillStyle = fillGradient;
  ctx.fill();

  // 类型渐变描边：闲置=绿青 / 求购=紫 / 以物易物=橙 / 技能=蓝（低饱和、沿圆周方向）
  strokeTypeRing(ctx, cx, cy, r, circle.type, 3);

  // 左上角小高光，增强立体感
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx - r * 0.34, cy - r * 0.38, r * 0.13, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.restore();

  // 内容（商品图 / 求购标识 / 文字）
  drawCircleContent(ctx, circle);
}

// 绘制展开中的圆形（从原位置移到屏幕中心，再向四周扩大撑满屏幕）
function drawExpandingCircle(ctx, circle, es, containerW, containerH) {
  const t = 1 - Math.pow(1 - es.progress, 3); // easeOutCubic

  // 圆心从原位置过渡到屏幕中心
  const cx = es.originX + (es.centerX - es.originX) * t;
  const cy = es.originY + (es.centerY - es.originY) * t;
  // 半径从原半径扩大到撑满屏幕
  const r = es.radius * (1 + (es.targetScale - 1) * t);

  // 遮罩其他圆形（展开过程中渐变遮盖背景）
  if (es.progress > 0.3) {
    const maskAlpha = (es.progress - 0.3) / 0.7 * 0.9;
    ctx.fillStyle = `rgba(0, 0, 0, ${maskAlpha})`;
    ctx.fillRect(0, 0, containerW, containerH);
  }

  // 绘制正圆
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);

  // 渐变填充
  const fillGradient = ctx.createRadialGradient(
    cx - r * 0.3, cy - r * 0.3, r * 0.1,
    cx, cy, r * 1.2
  );
  fillGradient.addColorStop(0, lightenColor(es.color, 30));
  fillGradient.addColorStop(0.7, es.color);
  fillGradient.addColorStop(1, darkenColor(es.color, 20));
  ctx.fillStyle = fillGradient;
  ctx.fill();

  // 边框
  ctx.strokeStyle = lightenColor(es.color, 40);
  ctx.lineWidth = 3;
  ctx.stroke();

  // 绘制内容（图片 + 文字），随圆形一起放大
  const contentR = r * 0.75;

  // 裁剪到圆形内绘制图片
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, contentR, 0, Math.PI * 2);
  ctx.clip();

  if (circle.imageLoaded && circle.imageObj) {
    try {
      ctx.drawImage(circle.imageObj, cx - contentR, cy - contentR, contentR * 2, contentR * 2);
    } catch (e) {
      drawImageFallback(ctx, cx, cy, contentR);
    }
  } else {
    drawImageFallback(ctx, cx, cy, contentR);
  }

  // 底部渐变遮罩
  const maskGradient = ctx.createLinearGradient(cx, cy + contentR * 0.3, cx, cy + contentR);
  maskGradient.addColorStop(0, 'rgba(0,0,0,0)');
  maskGradient.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = maskGradient;
  ctx.fillRect(cx - contentR, cy - contentR, contentR * 2, contentR * 2);
  ctx.restore();

  // 文字信息
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  ctx.clip();

  const label = circle.label || '';
  const fontSize = Math.max(12, r * 0.09);
  ctx.fillStyle = TOKENS.white;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillText(label, cx, cy + contentR * 0.15);

  const priceFontSize = Math.max(14, r * 0.12);
  ctx.fillStyle = TOKENS.onImage;
  ctx.font = `bold ${priceFontSize}px sans-serif`;
  ctx.fillText(
    circle.type === 'want'
      ? '求购中'
      : (circle.type === 'exchange'
        ? '🔁 易物'
        : (circle.type === 'skill' ? formatSkillPrice(circle.priceUnit, circle.price) : formatSellPrice(circle.price))),
    cx,
    cy + contentR * 0.5
  );

  ctx.font = `${Math.max(10, r * 0.07)}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(circle.condition || '', cx, cy + contentR * 0.75);
  ctx.restore();
}

// 在圆形内绘制商品内容
function drawCircleContent(ctx, circle) {
  const r = circle.radius;
  const cx = circle.center.x;
  const cy = circle.center.y;
  const contentR = r * 0.75;

  const isWant = circle.type === 'want';
  const isExchange = circle.type === 'exchange';
  const isSkill = circle.type === 'skill';
  const isVerified = circle.isVerified;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, contentR, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();

  if (isWant) {
    drawWantFallback(ctx, cx, cy, contentR);
  } else if (circle.imageLoaded && circle.imagePath) {
    try {
      const img = circle.imageObj;
      if (img) {
        ctx.drawImage(img, cx - contentR, cy - contentR, contentR * 2, contentR * 2);
      }
    } catch (e) {
      drawImageFallback(ctx, cx, cy, contentR);
    }
  } else {
    drawImageFallback(ctx, cx, cy, contentR);
  }

  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, contentR, 0, Math.PI * 2);
  ctx.clip();

  // 图上文字底衬：统一用深色渐隐（保证任何图片下都读得清）
  const maskGradient = ctx.createLinearGradient(cx, cy + contentR * 0.3, cx, cy + contentR);
  maskGradient.addColorStop(0, 'rgba(0,0,0,0)');
  maskGradient.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = maskGradient;
  ctx.fillRect(cx - contentR, cy - contentR, contentR * 2, contentR * 2);
  ctx.restore();

  const titleR = r * 0.92;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, titleR, 0, Math.PI * 2);
  ctx.clip();

  // 展示短标题（数据层已算好）：超长时缩字号而不是截断
  const label = circle.label || '';
  const maxTextWidth = contentR * 1.6;
  let titleFontSize = Math.max(13, r * 0.1);
  ctx.fillStyle = TOKENS.white;
  ctx.font = `bold ${titleFontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  while (label && ctx.measureText(label).width > maxTextWidth && titleFontSize > 9) {
    titleFontSize -= 1;
    ctx.font = `bold ${titleFontSize}px sans-serif`;
  }

  const titleY = cy + contentR * 0.15;
  ctx.fillText(label, cx, titleY);

  const priceY = cy + contentR * 0.5;
  const priceFontSize = Math.max(14, r * 0.12);
  ctx.font = `bold ${priceFontSize}px sans-serif`;

  // 图上文字只有一种「高亮色」：统一暖金，不再按类型各配一色
  ctx.fillStyle = TOKENS.onImage;
  if (isWant) {
    ctx.fillText('求购中', cx, priceY);
  } else if (isExchange) {
    ctx.fillText('🔁 易物', cx, priceY);
  } else if (isSkill) {
    ctx.fillText(formatSkillPrice(circle.priceUnit, circle.price), cx, priceY);
  } else {
    ctx.fillText(formatSellPrice(circle.price), cx, priceY);
  }

  const tagY = cy + contentR * 0.75;
  ctx.font = `${Math.max(10, r * 0.07)}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';

  let tagText = '';
  if (isWant) {
    tagText = '求购信息';
  } else if (isExchange) {
    tagText = '以物易物';
  } else if (isSkill) {
    tagText = '技能服务';
  } else {
    tagText = circle.condition || '';
  }
  if (isSkill && circle.isExpert) tagText += ' 🎓达人';
  if (isVerified) tagText += ' ✓已认证';
  ctx.fillText(tagText, cx, tagY);

  ctx.restore();
}

function drawWantFallback(ctx, cx, cy, r) {
  const theme = getTypeTheme('want');
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, theme.soft);
  gradient.addColorStop(1, theme.text);
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  ctx.fillStyle = TOKENS.white;
  ctx.font = `bold ${r * 0.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔍', cx, cy - r * 0.2);
  ctx.font = `${r * 0.18}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText('求购中', cx, cy + r * 0.15);
}

function drawImageFallback(ctx, cx, cy, r) {
  // 占位：中性灰，不再用彩色（避免无图商品变成一块“随机色”）
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, TOKENS.fill);
  gradient.addColorStop(1, TOKENS.fillStrong);
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  ctx.fillStyle = TOKENS.textLight;
  ctx.font = `${r * 0.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📦', cx, cy - r * 0.2);
}

// 颜色辅助函数
function lightenColor(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, (num >> 16) + amt);
  const G = Math.min(255, ((num >> 8) & 0x00ff) + amt);
  const B = Math.min(255, (num & 0x0000ff) + amt);
  return `rgb(${R},${G},${B})`;
}

function darkenColor(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, (num >> 16) - amt);
  const G = Math.max(0, ((num >> 8) & 0x00ff) - amt);
  const B = Math.max(0, (num & 0x0000ff) - amt);
  return `rgb(${R},${G},${B})`;
}

// ===== 列表模式：卡片展示字段 =====
// 展示口径（与详情页/发布页一致，不改数据层）：
//   sell     → ¥xx（有金额用价格色）
//   want     → 预算 ¥xx（数据层求购不落 price，没有金额就是「预算面议」）
//   exchange → 可换物（+ 期望交换物）
//   skill    → ¥xx/次 · ¥xx/小时 · 面议
const TYPE_LABEL = { sell: '闲置', want: '求购', exchange: '易物', skill: '技能' };
const TYPE_CLASS = { sell: 'idle', want: 'wanted', exchange: 'exchange', skill: 'skill' };

function buildCardView(item) {
  const type = item.type || 'sell';
  const isWant = type === 'want';
  const isExchange = type === 'exchange';
  const isSkill = type === 'skill';
  const amount = Number(item.price) || 0;
  const unit = item.price_unit || '';

  let priceText = '';
  let priceMuted = false; // true = 无具体金额（面议/可换物），用弱化色，不抢价格色的视觉位

  if (isWant) {
    if (amount > 0) {
      priceText = '预算 ¥' + amount;
    } else {
      priceText = '预算面议';
      priceMuted = true;
    }
  } else if (isExchange) {
    priceText = '可换物';
    priceMuted = true;
  } else if (isSkill) {
    priceText = formatSkillPrice(unit, amount);
    priceMuted = priceText === '面议';
  } else {
    if (amount > 0) {
      priceText = '¥' + amount;
    } else {
      priceText = '面议';
      priceMuted = true;
    }
  }

  const tradeStatus = item.tradeStatus || 'open';
  // 求购按二级分区区分角标：物品求购 → 「求购」，技能求助 → 「求助」
  const typeLabel = isWant ? (item.want_category === 'skill' ? '求助' : '求购') : TYPE_LABEL[type];
  const typeClass = (isWant && item.want_category === 'skill') ? 'wanted-deep' : TYPE_CLASS[type];

  return Object.assign({}, item, {
    timeText: formatDate(item.createTime),
    typeLabel: typeLabel || '闲置',
    typeClass: typeClass || 'idle',
    priceText: priceText,
    priceMuted: priceMuted,
    // 以物易物：价格行后缀显示期望交换物（过长由 CSS 截断）
    exchangeShort: isExchange ? (item.exchange_want || '') : '',
    conditionText: isSkill ? '' : (item.condition || ''),
    isClosed: tradeStatus !== 'open',
    statusText: tradeStatus === 'matched' ? '已预订' : (tradeStatus === 'completed' ? '已完成' : '')
  });
}

// 两列瀑布流分列：按估算高度投放到较矮的一列，长短卡片混排也能两边齐平
function splitIntoColumns(list) {
  const left = [];
  const right = [];
  let leftH = 0;
  let rightH = 0;
  // 列宽 (750 - 左右边距32 - 列间距16) / 2 = 351rpx，图区 1:1 所以图高≈351rpx
  const COL_W = 351;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const titleLen = (item.title || '').length;
    const titleLines = Math.min(2, Math.max(1, Math.ceil(titleLen / 10)));
    // 图区 + 信息区（内边距 32 + 标题行 + 价格行 + 标签行）
    const h = COL_W + 32 + titleLines * 40 + 40 + 44;
    if (leftH <= rightH) {
      left.push(item);
      leftH += h;
    } else {
      right.push(item);
      rightH += h;
    }
  }
  return { left, right };
}

// 列表骨架占位：首次加载/切筛选时左右各放几张，与实际卡片同构，减少跳动
const SKELETON_LEFT = [1, 2, 3];
const SKELETON_RIGHT = [1, 2, 3];

Page({
  data: {
    categoryList: [],
    currentCategory: '',
    currentType: '', // 类型筛选：'' 全部 | 'sell' 闲置 | 'want' 求购 | 'exchange' 易物 | 'skill' 技能
    // 求购二级分区：'' 未启用 | 'goods' 物品求购 | 'skill' 技能求助
    currentWantCategory: '',
    wantCategoryOptions: [
      { value: 'goods', icon: '📦', label: '物品求购' },
      { value: 'skill', icon: '🎓', label: '技能求助' }
    ],
    // 图书专区：仅在「书籍教材」类目下展开的二级筛选（学院 → 专业）
    isBookCategory: false,
    collegeList: COLLEGE_LIST,
    currentCollege: '',
    majorList: [],
    currentMajor: '',
    commodityList: [],
    // 浏览模式：list 列表（默认）| bubble 小球
    viewMode: VIEW_LIST,
    // 列表模式两列数据（与 commodityList 同源，只是换渲染组件）
    leftColumn: [],
    rightColumn: [],
    skeletonLeft: SKELETON_LEFT,
    skeletonRight: SKELETON_RIGHT,
    page: 1,
    pageSize: 20,
    hasMore: true,
    isLoading: false,
    isRefreshing: false,
    // 小球模式下超出容器容量的条数（>0 时提示切列表模式查看全部）
    cappedCount: 0,
    // 长按预览卡片（居中弹层）：数据驱动
    previewShow: false,
    previewItem: null,
    // 预览图预热：离屏 <image> 提前把图片拉进 image 组件缓存（长按瞬间就开始加载）
    preloadSrcs: []
  },

  canvas: null,
  ctx: null,
  canvasCircles: [],
  containerSize: { w: 0, h: 0 },
  pendingCircleList: null, // 画布未就绪（列表模式 / 尺寸未量到）时暂存的数据
  lastTouchTime: 0,
  lastTouchPos: null,
  touchedCircle: null,
  expandState: null,
  animationId: null,
  isAnimating: false,
  positionCache: null, // 保存圆形布局 {id -> {x, y}}
  previewAlpha: 0,     // 焦点态程度：0 普通浏览 → 1 长按预览
  previewCircle: null, // 当前长按预览的泡泡
  isPreviewing: false, // 是否处于长按预览（预览时冻结物理）

  onLoad() {
    // 开启右上角菜单的“转发给朋友 / 分享到朋友圈”，否则微信不会显示分享入口
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    // 浏览模式：记住上次选择，新用户默认列表模式
    let saved = '';
    try {
      saved = wx.getStorageSync(VIEW_MODE_KEY) || '';
    } catch (err) {
      saved = '';
    }
    this.setData({ viewMode: saved === VIEW_BUBBLE ? VIEW_BUBBLE : VIEW_LIST });
    this.loadCategoryList();
  },

  onShareAppMessage() {
    return {
      title: '云叙石光 · 校园物品信息服务站｜闲置转让 & 求购',
      path: '/pages/commodity_list/commodity_list'
    };
  },

  onShareTimeline() {
    return { title: '云叙石光 · 校园物品信息服务站', query: '' };
  },

  onReady() {
    this.isFirstLoad = true;
    // 只有小球模式才需要初始化画布：列表模式下 canvas 节点不存在
    if (this.data.viewMode === VIEW_BUBBLE) {
      this.initCanvas();
    }
    this.loadCommodityList(true, true); // 首次加载，允许随机布局
  },

  onShow() {
    if (this.data.viewMode === VIEW_BUBBLE && this.canvas && !this.isFirstLoad) {
      // 刷新 Canvas 位置（防止页面布局变化导致偏移）
      wx.createSelectorQuery().select('#commodityCanvas')
        .boundingClientRect((rect) => {
          if (rect) this.canvasRect = { left: rect.left, top: rect.top };
        }).exec();
      // 从详情页返回，不做任何刷新，保持球形位置和状态完全不变
    }
    this.isFirstLoad = false;
  },

  // ===== 浏览模式切换 =====
  // 只切换渲染组件，不重新请求数据：两种模式共用同一份 commodityList / 同一分页游标
  switchViewMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.viewMode) return;

    this.closePreviewCard();
    try {
      wx.setStorageSync(VIEW_MODE_KEY, mode);
    } catch (err) {
      // 缓存写失败不影响本次切换
    }
    wx.vibrateShort({ type: 'light' });

    if (mode === VIEW_BUBBLE) {
      this.setData({ viewMode: VIEW_BUBBLE }, () => {
        // 等画布挂载后再量尺寸并补画（数据已在 loadCommodityList 里备好）
        wx.nextTick(() => {
          this.initCanvas();
          this.buildCanvasCircles(this.data.commodityList, true);
        });
      });
    } else {
      this.stopRenderLoop();
      this.setData({ viewMode: VIEW_LIST });
      this.refreshColumns(this.data.commodityList);
    }
  },

  // 列表模式分列（数据不变，只重算两列归属）
  refreshColumns(list) {
    const cols = splitIntoColumns(list || []);
    this.setData({ leftColumn: cols.left, rightColumn: cols.right });
  },

  initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#commodityCanvas')
      .fields({ node: true, size: true, rect: true })
      .exec((res) => {
        if (!res[0]) return;

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio;

        this.canvas = canvas;
        this.ctx = ctx;
        this.containerSize = { w: res[0].width, h: res[0].height };
        // 缓存 Canvas 相对视口的位置，用于触摸坐标换算
        this.canvasRect = { left: res[0].left, top: res[0].top };

        canvas.width = res[0].width * dpr;
        canvas.height = res[0].height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.startRenderLoop();
        this.flushPendingCircles();
      });
  },

  // 画布尺寸就绪后，把之前暂存的列表补画上去（首次进入 / 从小球模式切回都不会漏画）
  flushPendingCircles() {
    if (!this.pendingCircleList) return;
    const pending = this.pendingCircleList;
    this.pendingCircleList = null;
    this.buildCanvasCircles(pending.list, pending.rebuildLayout);
  },

  startRenderLoop() {
    // 防止重复启动：两处 rAF 叠加会让物理以双倍速度跑
    if (this.animationId) return;
    const render = () => {
      // 焦点态淡入淡出（0 正常 → 1 长按预览）
      const focusTarget = this.isPreviewing ? 1 : 0;
      this.previewAlpha += (focusTarget - this.previewAlpha) * 0.18;
      if (Math.abs(focusTarget - this.previewAlpha) < 0.01) {
        this.previewAlpha = focusTarget;
      }

      if (this.isAnimating) {
        // 展开动画中
        this.updateExpandAnimation();
      } else if (!this.isPreviewing) {
        // 正常物理模拟（预览时冻结画面，卡片锚点不飘）
        physicsUpdate(this.canvasCircles, this.containerSize.w, this.containerSize.h);
      }

      renderCircles(
        this.ctx,
        this.canvasCircles,
        this.containerSize.w,
        this.containerSize.h,
        this.expandState,
        { circleId: this.previewCircle ? this.previewCircle._id : null, alpha: this.previewAlpha }
      );

      this.animationId = this.canvas.requestAnimationFrame(render);
    };
    render();
  },

  // 切到列表模式时停掉渲染循环，省电省 CPU（画布节点也会随 wx:if 一起卸载）
  stopRenderLoop() {
    if (this.animationId && this.canvas) {
      try {
        this.canvas.cancelAnimationFrame(this.animationId);
      } catch (err) {
        // 画布节点已随 wx:if 卸载：rAF 自然失效，忽略即可
      }
    }
    this.animationId = null;
  },

  async loadCategoryList() {
    try {
      const res = await API.getCategoryList();
      if (res.code === 0) {
        this.setData({ categoryList: res.data || [] });
      }
    } catch (err) {
      console.error('获取分类失败:', err);
    }
  },

  async loadCommodityList(reset = false, rebuildLayout = true) {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });

    try {
      const res = await API.getCommodityList({
        categoryId: this.data.currentCategory,
        type: this.data.currentType,
        // 求购分区（物品求购 / 技能求助）仅在求购类型下生效
        wantCategory: this.data.currentType === 'want' ? this.data.currentWantCategory : '',
        majors: this.buildMajorFilter(),
        page: this.data.page,
        pageSize: this.data.pageSize
      });

      if (res.code === 0) {
        const list = (res.data || []).map(buildCardView);

        if (reset) {
          this.setData({
            commodityList: list,
            hasMore: list.length >= this.data.pageSize,
            isRefreshing: false
          });
          this.refreshColumns(list);
          this.buildCanvasCircles(list, rebuildLayout);
        } else {
          const newList = this.data.commodityList.concat(list);
          this.setData({
            commodityList: newList,
            hasMore: list.length >= this.data.pageSize
          });
          this.refreshColumns(newList);
          this.buildCanvasCircles(newList, rebuildLayout);
        }
      }
    } catch (err) {
      console.error('获取商品列表失败:', err);
    } finally {
      this.setData({ isLoading: false, isRefreshing: false });
    }
  },

  // 从详情页返回时只刷新数据，保持位置和颜色不变
  async refreshCommodityData() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });

    try {
      const res = await API.getCommodityList({
        categoryId: this.data.currentCategory,
        type: this.data.currentType,
        wantCategory: this.data.currentType === 'want' ? this.data.currentWantCategory : '',
        majors: this.buildMajorFilter(),
        page: 1,
        pageSize: this.data.pageSize
      });

      if (res.code === 0) {
        const list = (res.data || []).map(buildCardView);

        this.setData({
          commodityList: list,
          hasMore: list.length >= this.data.pageSize,
          isRefreshing: false
        });
        this.refreshColumns(list);
        // rebuildLayout=false，复用缓存的位置和颜色
        this.buildCanvasCircles(list, false);
      }
    } catch (err) {
      console.error('刷新商品数据失败:', err);
    } finally {
      this.setData({ isLoading: false, isRefreshing: false });
    }
  },

  buildCanvasCircles(list, rebuildLayout = true) {
    // 列表重建（切分类/切类型/刷新）时先收起预览卡，避免卡片指向已消失的商品
    this.closePreviewCard();

    if (list.length === 0) {
      this.canvasCircles = [];
      this.pendingCircleList = null;
      if (this.data.cappedCount !== 0) this.setData({ cappedCount: 0 });
      return;
    }

    // 列表模式下画布未挂载，或画布尺寸还没量到：先暂存，等 initCanvas 完成后补画
    if (this.data.viewMode !== VIEW_BUBBLE || !this.containerSize.w || !this.containerSize.h) {
      this.pendingCircleList = { list: list, rebuildLayout: rebuildLayout };
      return;
    }
    this.pendingCircleList = null;

    // 构建缓存Map（复用之前的位置和颜色）
    const oldLayoutMap = {};
    if (!rebuildLayout && this.canvasCircles.length > 0) {
      for (const c of this.canvasCircles) {
        oldLayoutMap[c._id] = {
          x: c.center ? c.center.x : c.x,
          y: c.center ? c.center.y : c.y,
          color: c.color
        };
      }
    }
    // 如果切换了分类但有positionCache（从其他页面返回），也使用缓存
    if (!rebuildLayout && this.positionCache && Object.keys(this.positionCache).length > 0) {
      Object.assign(oldLayoutMap, this.positionCache);
    }

    const containerW = this.containerSize.w;
    const containerH = this.containerSize.h;
    // 自适应泡泡尺寸与容量：商品越多直径越小；极小屏装不下时只画 capacity 颗，
    // 宁可少画也不让泡泡压在一起（交叠正是本次要修的问题）
    const layout = computeBubbleLayout(
      containerW, containerH, list.length,
      rpxToPx(BUBBLE_MAX_RPX) / 2, rpxToPx(BUBBLE_MIN_RPX) / 2
    );
    const bubbleRadius = layout.radius;
    const renderList = list.length > layout.capacity ? list.slice(0, layout.capacity) : list;
    const cappedCount = list.length - renderList.length;
    if (this.data.cappedCount !== cappedCount) {
      this.setData({ cappedCount: cappedCount });
    }

    const tempCircles = renderList.map((item) => {
      const theme = getTypeTheme(item.type);
      let color = oldLayoutMap[item._id] ? oldLayoutMap[item._id].color : null;
      if (!color) {
        // 泡泡底色 = 类型色（低饱和），同类型内按 _id 做稳定深浅浮动
        // 旧版的「随机彩虹调色板」已废弃：颜色不再随商品随机，同类型一个色系
        const seed = stableHash(item._id);
        const amount = ((seed % 21) - 10) / 100;  // -0.10 ~ +0.10
        color = shiftLightness(theme.to, amount);
      }
      let cachedPos = oldLayoutMap[item._id];
      let x = cachedPos ? cachedPos.x : 0;
      let y = cachedPos ? cachedPos.y : 0;

      return {
        _id: item._id,
        title: item.title,
        price: item.price,
        originalPrice: item.originalPrice,
        condition: item.condition,
        tradeLocation: item.tradeLocation,
        timeText: item.timeText,
        images: item.images,
        type: item.type || 'sell',
        // 求购分区：goods 物品求购 / skill 技能求助（卡片角标与配色使用）
        wantCategory: item.want_category || '',
        // 气泡展示短标题：优先用服务端写入的 display_keyword，老数据现场兜底（逻辑在数据层，不在渲染里）
        label: item.display_keyword || buildDisplayKeyword({
          title: item.title,
          type: item.type || 'sell',
          categoryName: item.categoryName,
          skillName: ''
        }),
        major: item.major || [], // 图书专区：适用专业（数组）
        // 以物易物与交易状态
        exchangeWant: item.exchange_want || '',
        priceDiff: item.accept_price_diff || null,
        tradeStatus: item.tradeStatus || 'open',
        // 技能服务：达人角标 / 报价模式 / 可服务时间
        isExpert: !!item.isExpert,
        priceUnit: item.price_unit || '',
        availableTime: item.available_time || '',
        privileges: item.privileges || [],
        isVerified: item.isStudentVerified || false,
        rewardAmount: item.rewardAmount || 0,
        radius: bubbleRadius,
        color: color,
        x: x,
        y: y,
        imageLoaded: false,
        // 列表只下发缩略图 cover（老数据回退首图原图），详情页才加载完整图片数组
        imagePath: item.cover || '',
        // 列表图原始 fileID：链接过期后按 id 重新解析
        imageId: item.coverId || '',
        // 详情页首图（原图）fileID：长按预览时预热它，进详情可秒开
        fullImageId: item.fullCoverId || ''
      };
    });

    // 区分有位置缓存和无缓存的圆形
    if (rebuildLayout) {
      // 完全重新布局：错位网格，几何保证不交叠
      packBubbles(tempCircles, containerW, containerH, bubbleRadius);
    } else {
      // 保留已有位置，只给新增的商品分配新位置
      const newCircles = tempCircles.filter(c => !oldLayoutMap[c._id]);
      const existingCircles = tempCircles.filter(c => oldLayoutMap[c._id]);

      if (newCircles.length > 0 && existingCircles.length > 0) {
        // 在网格里挑还没被占用的落位点：落位点之间天然不交叠，
        // 只要再避开已有圆，新增的这批就不会压到任何泡泡上
        const slots = latticeSlots(containerW, containerH, bubbleRadius);
        let slotIdx = 0;
        let placedAll = true;
        for (const newCircle of newCircles) {
          let placed = false;
          for (; slotIdx < slots.length && !placed; slotIdx++) {
            const slot = slots[slotIdx];
            let conflict = false;
            for (const ex of existingCircles) {
              const dx = slot.x - ex.x;
              const dy = slot.y - ex.y;
              if (Math.sqrt(dx * dx + dy * dy) < bubbleRadius + ex.radius + 2) {
                conflict = true;
                break;
              }
            }
            if (!conflict) {
              newCircle.x = slot.x;
              newCircle.y = slot.y;
              placed = true;
            }
          }
          if (!placed) {
            placedAll = false;
            break;
          }
        }
        // 空位不够（说明整体已超出容量）：整盘重排一次，宁可跳位置也不交叠
        if (!placedAll) {
          packBubbles(tempCircles, containerW, containerH, bubbleRadius);
        }
      } else if (newCircles.length > 0) {
        packBubbles(newCircles, containerW, containerH, bubbleRadius);
      }
    }

    // 初始化物理
    for (const circle of tempCircles) {
      initPhysics(circle);
      this.loadImage(circle);
    }

    this.canvasCircles = tempCircles;

    // 保存布局缓存（用于从详情页返回时恢复）
    const cache = {};
    for (const c of tempCircles) {
      cache[c._id] = {
        x: c.center ? c.center.x : c.x,
        y: c.center ? c.center.y : c.y,
        color: c.color
      };
    }
    this.positionCache = cache;
  },

  loadImage(circle) {
    if (!circle.imagePath) return;
    this.loadCanvasImage(circle, circle.imagePath);
  },

  // 画布图片加载：失败时（多半是临时链接过期）按 fileID 重新解析并重试一次
  loadCanvasImage(circle, url) {
    const img = this.canvas.createImage();
    img.onload = () => {
      circle.imageObj = img;
      circle.imageLoaded = true;
    };
    img.onerror = () => {
      circle.imageLoaded = false;
      this.retryBubbleImage(circle);
    };
    img.src = url;
  },

  async retryBubbleImage(circle) {
    if (!circle.imageId || circle._imgRetried) return; // 每张图只重试一次
    circle._imgRetried = true;
    try {
      const url = await imageView.refreshUrl(circle.imageId);
      if (!url) return;
      circle.imagePath = url;
      this.loadCanvasImage(circle, url);
    } catch (err) {
      // 重试失败：保持占位绘制，不影响其它气泡
    }
  },

  // 触摸事件处理
  onTouchStart(e) {
    if (this.isAnimating) return;

    const touch = e.touches[0];
    const rect = this.canvasRect || { left: 0, top: 0 };
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    this.lastTouchTime = Date.now();
    this.lastTouchPos = { x, y };
    this.touchStartPos = { x, y };

    // 从后往前遍历（后绘制的在上层），精确命中
    this.touchedCircle = null;
    for (let i = this.canvasCircles.length - 1; i >= 0; i--) {
      const circle = this.canvasCircles[i];
      const dx = x - circle.center.x;
      const dy = y - circle.center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= circle.radius) {
        this.touchedCircle = circle;
        break;
      }
    }

    // 先收起可能还开着的预览卡（内部会清掉未执行的定时器）
    clearTimeout(this._longPressTimer);
    this.closePreviewCard();
    this._gestureHadPreview = false; // 本次手势是否出现过预览卡（出现过则不跳详情）

    // 点击空白处（没命中任何泡泡）到此为止：卡片已收起，也不触发长按预览
    if (!this.touchedCircle) return;

    // 长按 400ms：弹出居中预览卡片；拖动或快速点击不会触发
    this._longPressTimer = setTimeout(() => {
      if (this.isDragging || this.isAnimating || this.data.previewShow) return;
      if (this.touchedCircle) this.showPreviewCard(this.touchedCircle);
    }, 400);
  },

  onTouchMove(e) {
    if (this.isAnimating) return;

    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;

    if (!this.lastTouchPos) {
      this.lastTouchPos = { x, y };
      return;
    }

    const dx = x - this.lastTouchPos.x;
    const dy = y - this.lastTouchPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 累计位移超过 10px：取消长按定时器；若预览已打开则同步关闭
    if (this.touchStartPos) {
      const mdx = x - this.touchStartPos.x;
      const mdy = y - this.touchStartPos.y;
      if (Math.sqrt(mdx * mdx + mdy * mdy) > 10) {
        clearTimeout(this._longPressTimer);
        this.closePreviewCard();
      }
    }

    // 如果移动距离大，不是点击
    if (dist > 8) {
      this.isDragging = true;
      clearTimeout(this._longPressTimer);
      this.closePreviewCard();

      // 对附近的圆形施加推力
      for (const circle of this.canvasCircles) {
        const cdx = x - circle.center.x;
        const cdy = y - circle.center.y;
        const cdist = Math.sqrt(cdx * cdx + cdy * cdy);

        if (cdist < TOUCH_RADIUS && cdist > 0) {
          const force = (TOUCH_RADIUS - cdist) / TOUCH_RADIUS;
          // 手指掠过时给泡泡一个轻快的速度冲量
          const pushX = (cdx / cdist) * force * 0.5 + dx * 0.15;
          const pushY = (cdy / cdist) * force * 0.5 + dy * 0.15;
          circle.vx = (circle.vx || 0) + pushX;
          circle.vy = (circle.vy || 0) + pushY;
        }
      }
    }

    this.lastTouchPos = { x, y };
  },

  onTouchEnd(e) {
    if (this.isAnimating) return;

    clearTimeout(this._longPressTimer);

    const touchDuration = Date.now() - this.lastTouchTime;
    const wasDragging = this.isDragging;
    // 本次手势只要出现过预览卡就不跳详情（即使中途因移动而收起）
    const wasLongPress = !!this._gestureHadPreview;
    this.isDragging = false;

    // 松手即收起卡片（先取 wasLongPress，再收起）
    this.closePreviewCard();

    // 校验：触摸结束时手指是否仍在同一圆形内（防止误触）
    let validClick = false;
    if (!wasDragging && !wasLongPress && touchDuration < 500 && this.touchedCircle) {
      validClick = true;
    }

    if (validClick) {
      this.startExpandAnimation(this.touchedCircle);
    }

    this.lastTouchPos = null;
    this.touchedCircle = null;
    this.touchStartPos = null;
  },

  // 离屏预热：把图片塞进 <image> 组件缓存，长按预览/进详情时无需再等下载
  queuePreload(src) {
    if (!src) return;
    if (this.data.preloadSrcs.indexOf(src) > -1) return;
    // 只保留最近 6 张，避免长期占用内存
    this.setData({ preloadSrcs: this.data.preloadSrcs.concat(src).slice(-6) });
  },

  // 长按：弹出居中预览卡片（数据驱动，同时点亮焦点泡泡）
  showPreviewCard(circle) {
    this._longPressShown = true;
    this._gestureHadPreview = true;
    this.previewCircle = circle;   // 画布焦点：该泡泡放大 1.1 倍并高亮描边
    this.isPreviewing = true;

    // 长按触发的同时就开始加载预览图，不等卡片动画完成（图未就绪时卡片先显示骨架）
    this.queuePreload(circle.imagePath);
    imageView.preload(circle.imagePath);

    // 预览打开期间，顺手把"详情页首图（原图）"解析并预热好，点进详情可秒开
    const detailId = circle.fullImageId || circle.imageId;
    if (detailId) {
      imageView.resolveIds([detailId]).then(map => {
        const url = map[detailId];
        if (url) {
          this.queuePreload(url);
          imageView.preload(url);
        }
      });
    }

    const isWant = circle.type === 'want';
    const isExchange = circle.type === 'exchange';
    const isSkill = circle.type === 'skill';

    let priceText = formatSellPrice(circle.price);
    if (isWant) priceText = '求购中';
    else if (isExchange) priceText = '想换：' + (circle.exchangeWant || '面议');
    else if (isSkill) priceText = formatSkillPrice(circle.priceUnit, circle.price);

    this.setData({
      previewShow: true,
      previewItem: {
        _id: circle._id,
        image: circle.imagePath || '',
        title: circle.title,
        priceText,
        condition: isSkill ? '' : (circle.condition || ''),
        verified: !!circle.isVerified,
        expert: !!circle.isExpert,
        type: circle.type,
        // 求购分区：物品求购 → 角标「求购」，技能求助 → 角标「求助」
        wantCategory: isWant ? (circle.wantCategory || 'goods') : '',
        typeLabel: isWant
          ? (circle.wantCategory === 'skill' ? '求助' : '求购')
          : (isExchange ? '易物' : (isSkill ? '技能' : '闲置')),
        exchangeWant: isExchange ? (circle.exchangeWant || '') : '',
        availableTime: isSkill ? (circle.availableTime || '') : ''
      }
    });

    wx.vibrateShort({ type: 'light' });
  },

  // 关闭预览卡片
  closePreviewCard() {
    this._longPressShown = false;
    this._gestureHadPreview = this._gestureHadPreview || this.isPreviewing;
    this.isPreviewing = false;
    this.previewCircle = null;

    if (this.data.previewShow) {
      this.setData({ previewShow: false, previewItem: null });
    }
  },

  // 点击遮罩：仅关闭
  onPreviewClose() {
    this.closePreviewCard();
  },

  // 点击卡片：进详情
  onPreviewOpenCard(e) {
    const id = e.detail && e.detail.id;
    this.closePreviewCard();
    if (id) {
      wx.navigateTo({ url: `/pages/commodity_detail/commodity_detail?id=${id}` });
    }
  },

  // 展开动画：圆形从原位置移到屏幕中心，再向四周扩大撑满屏幕
  startExpandAnimation(circle) {
    this.isAnimating = true;
    const screenCenterX = this.containerSize.w / 2;
    const screenCenterY = this.containerSize.h / 2;
    // 计算撑满屏幕需要的缩放比例
    const maxDim = Math.max(this.containerSize.w, this.containerSize.h);
    const targetScale = maxDim / (2 * circle.radius) + 0.5;

    this.expandState = {
      circleId: circle._id,
      originX: circle.center.x,
      originY: circle.center.y,
      centerX: screenCenterX,
      centerY: screenCenterY,
      radius: circle.radius,
      color: circle.color,
      targetScale: targetScale,
      progress: 0
    };

    wx.vibrateShort({ type: 'light' });

    // 动画完成后跳转详情页
    setTimeout(() => {
      this.goDetail({ currentTarget: { dataset: { id: circle._id } } });
    }, 600);
  },

  updateExpandAnimation() {
    if (!this.expandState) {
      this.isAnimating = false;
      return;
    }

    this.expandState.progress += 0.05;

    if (this.expandState.progress >= 1) {
      this.expandState.progress = 1;
    }
  },

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  },

  switchCategory(e) {
    const id = e.currentTarget.dataset.id;
    // 是否是「书籍教材」类目：决定是否展开二级专业筛选
    const category = (this.data.categoryList || []).find(c => c._id === id);
    const isBookCategory = !!category && isBookCategoryName(category.name);
    this.setData({
      currentCategory: id,
      isBookCategory,
      currentCollege: '',
      currentMajor: '',
      majorList: [],
      page: 1,
      commodityList: [],
      leftColumn: [],
      rightColumn: [],
      hasMore: true
    });
    this.positionCache = null; // 切换分类时清空位置缓存，重新布局
    this.loadCommodityList(true, true);
    this.refreshCanvasSize(); // 二级筛选展开/收起会改变画布高度，需要重新量尺寸
  },

  // 选择学院（二级筛选第一级）
  selectCollege(e) {
    const college = e.currentTarget.dataset.college || '';
    if (college === this.data.currentCollege) return;
    this.setData({
      currentCollege: college,
      currentMajor: '',
      majorList: college ? getMajorsByCollege(college) : [],
      page: 1,
      commodityList: [],
      leftColumn: [],
      rightColumn: [],
      hasMore: true
    });
    this.positionCache = null;
    this.loadCommodityList(true, true);
    this.refreshCanvasSize(); // 专业行出现/消失，画布高度随之变化
  },

  // 选择专业（二级筛选第二级）
  selectMajor(e) {
    const major = e.currentTarget.dataset.major || '';
    if (major === this.data.currentMajor) return;
    this.setData({
      currentMajor: major,
      page: 1,
      commodityList: [],
      leftColumn: [],
      rightColumn: [],
      hasMore: true
    });
    this.positionCache = null;
    this.loadCommodityList(true, true);
  },

  // 组装专业过滤参数：优先按具体专业，其次按整个学院，未筛选则不过滤
  buildMajorFilter() {
    const { isBookCategory, currentMajor, currentCollege } = this.data;
    if (!isBookCategory) return [];
    if (currentMajor) return [currentMajor];
    if (currentCollege) return getMajorsByCollege(currentCollege);
    return [];
  },

  // 二级筛选展开/收起后重新测量画布，避免画布被拉伸变形
  refreshCanvasSize() {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this.resizeCanvas(), 60);
  },

  resizeCanvas() {
    if (!this.canvas || !this.ctx) return;
    wx.createSelectorQuery().select('#commodityCanvas')
      .fields({ node: true, size: true, rect: true })
      .exec((res) => {
        if (!res[0] || !res[0].width || !res[0].height) return;
        const { width, height, left, top } = res[0];
        const dpr = wx.getSystemInfoSync().pixelRatio;
        this.containerSize = { w: width, h: height };
        this.canvasRect = { left, top };
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        // 用 setTransform 重置矩阵（不能用 scale，避免多次调用把缩放叠加）
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.flushPendingCircles();
      });
  },

  switchType(e) {
    const type = e.currentTarget.dataset.type;
    if (this.data.currentType === type) return;
    this.setData({
      currentType: type,
      // 切到求购：默认展示「物品求购」分区
      currentWantCategory: type === 'want' ? 'goods' : '',
      page: 1,
      commodityList: [],
      leftColumn: [],
      rightColumn: [],
      hasMore: true
    });
    this.positionCache = null; // 切换类型时清空位置缓存，重新布局
    this.loadCommodityList(true, true);
  },

  // 求购二级筛选：物品求购 / 技能求助
  switchWantCategory(e) {
    const value = e.currentTarget.dataset.value;
    if (this.data.currentWantCategory === value) return;
    this.setData({
      currentWantCategory: value,
      page: 1,
      commodityList: [],
      leftColumn: [],
      rightColumn: [],
      hasMore: true
    });
    this.positionCache = null;
    this.loadCommodityList(true, true);
  },

  onRefresh() {
    // 已有请求在飞：直接收起下拉圈，不排队（避免 refresher 一直转）
    if (this.data.isRefreshing || this.data.isLoading) {
      this.setData({ isRefreshing: false });
      return;
    }
    this.setData({ page: 1, isRefreshing: true });
    this.positionCache = null; // 下拉刷新时清空位置缓存，重新布局
    this.loadCommodityList(true, true);
  },

  onLoadMore() {
    if (!this.data.hasMore || this.data.isLoading) return;
    this.setData({ page: this.data.page + 1 });
    this.loadCommodityList();
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/commodity_search/commodity_search' });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    // 重置动画状态
    this.isAnimating = false;
    this.expandState = null;
    wx.navigateTo({ url: `/pages/commodity_detail/commodity_detail?id=${id}` });
  },

  goRelease() {
    if (!wx.getStorageSync('openid')) {
      wx.showModal({
        title: '提示',
        content: '请先登录后再发布信息',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/index/index' });
          }
        }
      });
      return;
    }
    // 按当前筛选的类型预选发布类型（闲置 / 求购 / 以物易物）
    const current = this.data.currentType;
    const type = ['sell', 'want', 'exchange', 'skill'].indexOf(current) > -1 ? current : '';
    wx.navigateTo({
      url: '/pages/commodity_release/commodity_release' + (type ? '?type=' + type : '')
    });
  },

  onUnload() {
    clearTimeout(this._longPressTimer);
    clearTimeout(this._resizeTimer);
    this.stopRenderLoop();
  }
});
