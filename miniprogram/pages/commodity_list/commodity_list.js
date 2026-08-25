// pages/commodity_list/commodity_list.js
const API = require('../../api/api.js');
const { formatDate } = require('../../utils/util.js');

// 颜色调色板
const COLOR_PALETTE = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8B500', '#FF69B4', '#00CED1', '#FF7F50', '#9370DB',
  '#20B2AA', '#FF8C00', '#DA70D6', '#32CD32', '#1E90FF'
];

// 物理常量
const GRAVITY = -0.015; // 轻微上浮，模拟水中气泡浮力
const FRICTION = 0.992; // 接近1，让浮动缓慢衰减不停止
const BOUNCE_DAMPING = 0.55; // 碰撞反弹力，模拟弹性壁
const CONSTRAINT_ITERATIONS = 6;
const TOUCH_RADIUS = 80;
const FLOAT_NOISE = 0.025; // 每帧随机扰动幅度（模拟水中微粒扰动）

// 圆堆积算法 - 生成不重叠的圆形布局
function computePacking(circles, containerW, containerH) {
  const placed = [];
  const padding = 10;
  const gap = 6;
  
  circles.sort((a, b) => b.radius - a.radius);
  
  for (let i = 0; i < circles.length; i++) {
    const circle = circles[i];
    const maxAttempts = 200;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = circle.radius + padding + Math.random() * (containerW - 2 * (circle.radius + padding));
      const y = circle.radius + padding + Math.random() * (containerH - 2 * (circle.radius + padding));
      
      let overlapping = false;
      for (let j = 0; j < placed.length; j++) {
        const other = placed[j];
        const dx = x - other.x;
        const dy = y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < circle.radius + other.radius + gap) {
          overlapping = true;
          break;
        }
      }
      
      if (!overlapping) {
        circle.x = x;
        circle.y = y;
        placed.push(circle);
        break;
      }
      
      if (attempt === maxAttempts - 1) {
        circle.x = containerW / 2;
        circle.y = containerH / 2;
      }
    }
  }
  
  return circles;
}

// 为圆形初始化物理粒子（边界质点）
function initPhysics(circle, segmentCount = 24) {
  circle.particles = [];
  circle.constraints = [];
  const radius = circle.radius;

  // 微小随机初速度，模拟气泡在水中的起始浮动
  const initVX = (Math.random() - 0.5) * 0.7;
  const initVY = (Math.random() - 0.5) * 0.7 - 0.25;
  circle.initVX = initVX;
  circle.initVY = initVY;

  for (let i = 0; i < segmentCount; i++) {
    const angle = (i / segmentCount) * Math.PI * 2;
    const px = circle.x + Math.cos(angle) * radius;
    const py = circle.y + Math.sin(angle) * radius;
    // 边界粒子也同步初速度
    circle.particles.push({
      x: px,
      y: py,
      oldX: px - initVX,
      oldY: py - initVY,
      originalAngle: angle,
      originalRadius: radius
    });
  }

  // 中心粒子
  circle.center = {
    x: circle.x,
    y: circle.y,
    oldX: circle.x - initVX,
    oldY: circle.y - initVY
  };
  
  // 连接中心与边界粒子的约束
  for (let i = 0; i < segmentCount; i++) {
    circle.constraints.push({
      p1: circle.center,
      p2: circle.particles[i],
      length: radius,
      type: 'radial'
    });
  }
  
  // 相邻边界粒子的约束（保持周长）
  for (let i = 0; i < segmentCount; i++) {
    const next = (i + 1) % segmentCount;
    const dx = circle.particles[i].x - circle.particles[next].x;
    const dy = circle.particles[i].y - circle.particles[next].y;
    const length = Math.sqrt(dx * dx + dy * dy);
    circle.constraints.push({
      p1: circle.particles[i],
      p2: circle.particles[next],
      length: length,
      type: 'circumference'
    });
  }
  
  // 对角约束（增加结构稳定性）
  for (let i = 0; i < segmentCount; i++) {
    const opposite = (i + Math.floor(segmentCount / 2)) % segmentCount;
    const dx = circle.particles[i].x - circle.particles[opposite].x;
    const dy = circle.particles[i].y - circle.particles[opposite].y;
    const length = Math.sqrt(dx * dx + dy * dy);
    circle.constraints.push({
      p1: circle.particles[i],
      p2: circle.particles[opposite],
      length: length,
      type: 'diagonal'
    });
  }
  
  circle.segmentCount = segmentCount;
}

// Verlet积分物理更新
function physicsUpdate(circles, containerW, containerH) {
  // Verlet积分更新位置（含水中浮动微扰）
  for (const circle of circles) {
    // 每帧随机微小扰动：模拟水中微粒冲撞，保持气泡不停止浮动
    const nx = (Math.random() - 0.5) * FLOAT_NOISE;
    const ny = (Math.random() - 0.5) * FLOAT_NOISE;

    const center = circle.center;
    const vx = (center.x - center.oldX) * FRICTION;
    const vy = (center.y - center.oldY) * FRICTION;
    center.oldX = center.x;
    center.oldY = center.y;
    center.x += vx + nx;
    center.y += vy + GRAVITY + ny;

    for (const p of circle.particles) {
      const pvx = (p.x - p.oldX) * FRICTION;
      const pvy = (p.y - p.oldY) * FRICTION;
      p.oldX = p.x;
      p.oldY = p.y;
      p.x += pvx + nx;
      p.y += pvy + GRAVITY * 0.3 + ny;
    }
  }

  // 满足约束
  for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
    // 内部约束
    for (const circle of circles) {
      for (const c of circle.constraints) {
        const dx = c.p2.x - c.p1.x;
        const dy = c.p2.y - c.p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) continue;

        const diff = (dist - c.length) / dist;
        const offsetX = dx * 0.5 * diff;
        const offsetY = dy * 0.5 * diff;

        c.p1.x += offsetX;
        c.p1.y += offsetY;
        c.p2.x -= offsetX;
        c.p2.y -= offsetY;
      }
    }

    // 圆形间碰撞检测（弹性壁碰撞：推开 + 反向回弹速度）
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const c1 = circles[i];
        const c2 = circles[j];

        const dxC = c2.center.x - c1.center.x;
        const dyC = c2.center.y - c1.center.y;
        const distC = Math.sqrt(dxC * dxC + dyC * dyC);
        const minDist = c1.radius + c2.radius + 4;

        if (distC < minDist && distC > 0) {
          const overlap = minDist - distC;
          const nx = dxC / distC;
          const ny = dyC / distC;
          const pushRate = 0.25;

          // 位置推开
          c1.center.x -= nx * overlap * pushRate;
          c1.center.y -= ny * overlap * pushRate;
          c2.center.x += nx * overlap * pushRate;
          c2.center.y += ny * overlap * pushRate;

          // 给 oldX/oldY 反向偏移产生"回弹"速度（弹性壁效果）
          const bounce = overlap * BOUNCE_DAMPING * 0.6;
          c1.center.oldX += nx * bounce;
          c1.center.oldY += ny * bounce;
          c2.center.oldX -= nx * bounce;
          c2.center.oldY -= ny * bounce;

          // 同步更新边界粒子
          for (const p of c1.particles) {
            p.x -= nx * overlap * pushRate;
            p.y -= ny * overlap * pushRate;
            p.oldX += nx * bounce;
            p.oldY += ny * bounce;
          }
          for (const p of c2.particles) {
            p.x += nx * overlap * pushRate;
            p.y += ny * overlap * pushRate;
            p.oldX -= nx * bounce;
            p.oldY -= ny * bounce;
          }
        }
      }
    }
    
    // 边界约束
    for (const circle of circles) {
      // 中心约束
      if (circle.center.x < circle.radius) {
        circle.center.x = circle.radius;
        circle.center.oldX = circle.center.x + (circle.center.x - circle.center.oldX) * BOUNCE_DAMPING;
      }
      if (circle.center.x > containerW - circle.radius) {
        circle.center.x = containerW - circle.radius;
        circle.center.oldX = circle.center.x + (circle.center.x - circle.center.oldX) * BOUNCE_DAMPING;
      }
      if (circle.center.y < circle.radius) {
        circle.center.y = circle.radius;
        circle.center.oldY = circle.center.y + (circle.center.y - circle.center.oldY) * BOUNCE_DAMPING;
      }
      if (circle.center.y > containerH - circle.radius) {
        circle.center.y = containerH - circle.radius;
        circle.center.oldY = circle.center.y + (circle.center.y - circle.center.oldY) * BOUNCE_DAMPING;
      }
      
      // 边界粒子约束
      for (const p of circle.particles) {
        if (p.x < 5) {
          p.x = 5;
          p.oldX = p.x + (p.x - p.oldX) * BOUNCE_DAMPING;
        }
        if (p.x > containerW - 5) {
          p.x = containerW - 5;
          p.oldX = p.x + (p.x - p.oldX) * BOUNCE_DAMPING;
        }
        if (p.y < 5) {
          p.y = 5;
          p.oldY = p.y + (p.y - p.oldY) * BOUNCE_DAMPING;
        }
        if (p.y > containerH - 5) {
          p.y = containerH - 5;
          p.oldY = p.y + (p.y - p.oldY) * BOUNCE_DAMPING;
        }
      }
    }
  }
}

// Canvas渲染
function renderCircles(ctx, circles, containerW, containerH, expandState) {
  ctx.clearRect(0, 0, containerW, containerH);

  // 绘制背景
  const gradient = ctx.createLinearGradient(0, 0, 0, containerH);
  gradient.addColorStop(0, '#f5f7fa');
  gradient.addColorStop(1, '#e8ecf1');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, containerW, containerH);

  // 展开动画中的圆形最后绘制（在最上层）
  let expandingCircle = null;

  for (const circle of circles) {
    const isExpanding = expandState && expandState.circleId === circle._id;
    if (isExpanding) {
      expandingCircle = circle;
      continue; // 跳过，稍后单独渲染
    }

    drawSingleCircle(ctx, circle);
  }

  // 渲染展开中的圆形
  if (expandingCircle && expandState) {
    drawExpandingCircle(ctx, expandingCircle, expandState, containerW, containerH);
  }
}

// 绘制普通圆形（带物理变形）
function drawSingleCircle(ctx, circle) {
    // 绘制变形圆形主体
    ctx.beginPath();
    const particles = circle.particles;
    ctx.moveTo(
      (particles[0].x + particles[particles.length - 1].x) / 2,
      (particles[0].y + particles[particles.length - 1].y) / 2
    );

    for (let i = 0; i < particles.length; i++) {
      const next = (i + 1) % particles.length;
      const cx = particles[i].x;
      const cy = particles[i].y;
      const nx = (particles[i].x + particles[next].x) / 2;
      const ny = (particles[i].y + particles[next].y) / 2;
      ctx.quadraticCurveTo(cx, cy, nx, ny);
    }
    ctx.closePath();

    // 填充渐变
    const fillRadius = circle.radius * 1.2;
    const fillGradient = ctx.createRadialGradient(
      circle.center.x - circle.radius * 0.3,
      circle.center.y - circle.radius * 0.3,
      circle.radius * 0.1,
      circle.center.x,
      circle.center.y,
      fillRadius
    );

    const baseColor = circle.color;
    fillGradient.addColorStop(0, lightenColor(baseColor, 30));
    fillGradient.addColorStop(0.7, baseColor);
    fillGradient.addColorStop(1, darkenColor(baseColor, 20));

    ctx.fillStyle = fillGradient;
    ctx.fill();

    // 边框
    ctx.strokeStyle = lightenColor(baseColor, 40);
    ctx.lineWidth = 3;
    ctx.stroke();

    // 绘制内容
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

  const fontSize = Math.max(12, r * 0.09);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const titleText = circle.title.length > 8 ? circle.title.substring(0, 7) + '..' : circle.title;
  ctx.fillText(titleText, cx, cy + contentR * 0.15);

  const priceFontSize = Math.max(14, r * 0.12);
  ctx.fillStyle = '#FFD700';
  ctx.font = `bold ${priceFontSize}px sans-serif`;
  ctx.fillText('¥' + circle.price, cx, cy + contentR * 0.5);

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
  const hasPrivileges = circle.privileges && circle.privileges.length > 0;
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
  
  const fontSize = Math.max(12, r * 0.09);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const titleY = cy + contentR * 0.15;
  const titleText = circle.title.length > 8 ? circle.title.substring(0, 7) + '..' : circle.title;
  ctx.fillText(titleText, cx, titleY);
  
  const priceY = cy + contentR * 0.5;
  const priceFontSize = Math.max(14, r * 0.12);
  ctx.font = `bold ${priceFontSize}px sans-serif`;
  
  if (isWant) {
    ctx.fillStyle = '#4ECDC4';
    if (circle.rewardAmount > 0) {
      ctx.fillText('¥' + circle.rewardAmount + ' 悬赏', cx, priceY);
    } else {
      ctx.fillText('求购中', cx, priceY);
    }
  } else {
    ctx.fillStyle = '#FFD700';
    ctx.fillText('¥' + circle.price, cx, priceY);
  }
  
  const tagY = cy + contentR * 0.75;
  ctx.font = `${Math.max(10, r * 0.07)}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  
  let tagText = '';
  if (isWant) {
    tagText = '求购信息';
  } else {
    tagText = circle.condition || '';
  }
  if (hasPrivileges) {
    if (circle.privileges.indexOf('urgent') !== -1) tagText += ' 🔥急出';
    if (circle.privileges.indexOf('top') !== -1) tagText += ' 📌置顶';
  }
  if (isVerified) tagText += ' ✓已认证';
  ctx.fillText(tagText, cx, tagY);
  
  ctx.restore();
}

function drawWantFallback(ctx, cx, cy, r) {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, '#E8F8F5');
  gradient.addColorStop(1, '#4ECDC4');
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${r * 0.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔍', cx, cy - r * 0.2);
  ctx.font = `${r * 0.18}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText('求购中', cx, cy + r * 0.15);
}

function drawImageFallback(ctx, cx, cy, r) {
  // 绘制占位图
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, '#e0e0e0');
  gradient.addColorStop(1, '#c0c0c0');
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  
  // 占位图标
  ctx.fillStyle = '#999';
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
  const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
  const B = Math.min(255, (num & 0x0000FF) + amt);
  return `rgb(${R},${G},${B})`;
}

function darkenColor(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, (num >> 16) - amt);
  const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
  const B = Math.max(0, (num & 0x0000FF) - amt);
  return `rgb(${R},${G},${B})`;
}

Page({
  data: {
    categoryList: [],
    currentCategory: '',
    commodityList: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    isRefreshing: false
  },

  canvas: null,
  ctx: null,
  canvasCircles: [],
  containerSize: { w: 0, h: 0 },
  lastTouchTime: 0,
  lastTouchPos: null,
  touchedCircle: null,
  expandState: null,
  animationId: null,
  isAnimating: false,
  positionCache: null, // 保存圆形布局 {id -> {x, y}}

  onLoad() {
    this.loadCategoryList();
  },

  onReady() {
    this.initCanvas();
    this.isFirstLoad = true;
    this.loadCommodityList(true, true); // 首次加载，允许随机布局
  },

  onShow() {
    if (this.canvas && !this.isFirstLoad) {
      // 刷新 Canvas 位置（防止页面布局变化导致偏移）
      wx.createSelectorQuery().select('#commodityCanvas')
        .boundingClientRect((rect) => {
          if (rect) this.canvasRect = { left: rect.left, top: rect.top };
        }).exec();
      // 从详情页返回，不做任何刷新，保持球形位置和状态完全不变
    }
    this.isFirstLoad = false;
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
        ctx.scale(dpr, dpr);

        this.startRenderLoop();
      });
  },

  startRenderLoop() {
    const render = () => {
      if (this.isAnimating) {
        // 展开动画中
        this.updateExpandAnimation();
      } else {
        // 正常物理模拟
        physicsUpdate(this.canvasCircles, this.containerSize.w, this.containerSize.h);
      }
      
      renderCircles(this.ctx, this.canvasCircles, this.containerSize.w, this.containerSize.h, this.expandState);
      
      this.animationId = this.canvas.requestAnimationFrame(render);
    };
    render();
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
        page: this.data.page,
        pageSize: this.data.pageSize
      });

      if (res.code === 0) {
        const list = (res.data || []).map(function(item) {
          return Object.assign({}, item, { timeText: formatDate(item.createTime) });
        });

        if (reset) {
          this.setData({
            commodityList: list,
            hasMore: list.length >= this.data.pageSize,
            isRefreshing: false
          });
          this.buildCanvasCircles(list, rebuildLayout);
        } else {
          const newList = this.data.commodityList.concat(list);
          this.setData({
            commodityList: newList,
            hasMore: list.length >= this.data.pageSize
          });
          this.buildCanvasCircles(newList, rebuildLayout);
        }
      }
    } catch (err) {
      console.error('获取商品列表失败:', err);
    } finally {
      this.setData({ isLoading: false });
    }
  },

  // 从详情页返回时只刷新数据，保持位置和颜色不变
  async refreshCommodityData() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });

    try {
      const res = await API.getCommodityList({
        categoryId: this.data.currentCategory,
        page: 1,
        pageSize: this.data.pageSize
      });

      if (res.code === 0) {
        const list = (res.data || []).map(function(item) {
          return Object.assign({}, item, { timeText: formatDate(item.createTime) });
        });

        this.setData({
          commodityList: list,
          hasMore: list.length >= this.data.pageSize,
          isRefreshing: false
        });
        // rebuildLayout=false，复用缓存的位置和颜色
        this.buildCanvasCircles(list, false);
      }
    } catch (err) {
      console.error('刷新商品数据失败:', err);
    } finally {
      this.setData({ isLoading: false });
    }
  },

  buildCanvasCircles(list, rebuildLayout = true) {
    if (!this.containerSize.w || !this.containerSize.h || list.length === 0) {
      this.canvasCircles = [];
      return;
    }

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

    // 计算价格范围，用于映射半径
    let minPrice = Infinity, maxPrice = -Infinity;
    for (const item of list) {
      const price = parseFloat(item.price) || 0;
      minPrice = Math.min(minPrice, price);
      maxPrice = Math.max(maxPrice, price);
    }
    if (minPrice === maxPrice) maxPrice = minPrice + 1;

    const minR = 45;
    const maxR = 100;
    const containerW = this.containerSize.w - 40;
    const containerH = this.containerSize.h - 40;

    const tempCircles = list.map((item) => {
      const price = parseFloat(item.price) || 0;
      const normalizedPrice = (price - minPrice) / (maxPrice - minPrice);
      const radius = minR + normalizedPrice * (maxR - minR);
      let color = oldLayoutMap[item._id] ? oldLayoutMap[item._id].color : null;
      if (!color) {
        color = item.type === 'want' ? '#4ECDC4' : COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
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
        privileges: item.privileges || [],
        isVerified: item.isVerified || false,
        rewardAmount: item.rewardAmount || 0,
        radius: radius,
        color: color,
        x: x,
        y: y,
        imageLoaded: false,
        imagePath: item.images && item.images[0] ? item.images[0] : null
      };
    });

    // 区分有位置缓存和无缓存的圆形
    if (rebuildLayout) {
      // 完全重新布局
      const padding = 20;
      const containerW = this.containerSize.w - padding * 2;
      const containerH = this.containerSize.h - padding * 2;
      computePacking(tempCircles, containerW, containerH);
    } else {
      // 保留已有位置，只给新增的商品分配新位置
      const newCircles = tempCircles.filter(c => !oldLayoutMap[c._id]);
      const existingCircles = tempCircles.filter(c => oldLayoutMap[c._id]);

      if (newCircles.length > 0 && existingCircles.length > 0) {
        // 给新增圆形找空位（避开已有圆）
        for (const newCircle of newCircles) {
          let placed = false;
          for (let attempt = 0; attempt < 200 && !placed; attempt++) {
            const x = newCircle.radius + 30 + Math.random() * (containerW - 2 * (newCircle.radius + 30));
            const y = newCircle.radius + 30 + Math.random() * (containerH - 2 * (newCircle.radius + 30));
            let overlap = false;
            for (const ex of existingCircles) {
              const dx = x - ex.x;
              const dy = y - ex.y;
              if (Math.sqrt(dx * dx + dy * dy) < newCircle.radius + ex.radius + 4) {
                overlap = true;
                break;
              }
            }
            if (!overlap) {
              newCircle.x = x;
              newCircle.y = y;
              placed = true;
            }
          }
          if (!placed) {
            newCircle.x = containerW / 2;
            newCircle.y = containerH / 2;
          }
        }
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
    
    const img = this.canvas.createImage();
    img.onload = () => {
      circle.imageObj = img;
      circle.imageLoaded = true;
    };
    img.onerror = () => {
      circle.imageLoaded = false;
    };
    img.src = circle.imagePath;
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
    
    // 如果移动距离大，不是点击
    if (dist > 8) {
      this.isDragging = true;
      
      // 对附近的圆形施加推力
      for (const circle of this.canvasCircles) {
        const cdx = x - circle.center.x;
        const cdy = y - circle.center.y;
        const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
        
        if (cdist < TOUCH_RADIUS && cdist > 0) {
          const force = (TOUCH_RADIUS - cdist) / TOUCH_RADIUS;
          const pushX = (cdx / cdist) * force * 2.5 + dx * 0.1;
          const pushY = (cdy / cdist) * force * 2.5 + dy * 0.1;
          
          circle.center.oldX = circle.center.x - pushX;
          circle.center.oldY = circle.center.y - pushY;
          
          for (const p of circle.particles) {
            p.oldX = p.x - pushX;
            p.oldY = p.y - pushY;
          }
        }
      }
    }
    
    this.lastTouchPos = { x, y };
  },

  onTouchEnd(e) {
    if (this.isAnimating) return;

    const touchDuration = Date.now() - this.lastTouchTime;
    const wasDragging = this.isDragging;
    this.isDragging = false;

    // 校验：触摸结束时手指是否仍在同一圆形内（防止误触）
    let validClick = false;
    if (!wasDragging && touchDuration < 500 && this.touchedCircle) {
      validClick = true;
    }

    if (validClick) {
      this.startExpandAnimation(this.touchedCircle);
    }

    this.lastTouchPos = null;
    this.touchedCircle = null;
    this.touchStartPos = null;
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
    this.setData({
      currentCategory: id,
      page: 1,
      commodityList: [],
      hasMore: true
    });
    this.positionCache = null; // 切换分类时清空位置缓存，重新布局
    this.loadCommodityList(true, true);
  },

  onRefresh() {
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
      wx.navigateTo({ url: '/pages/index_register/index_register' });
      return;
    }
    wx.navigateTo({ url: '/pages/commodity_release/commodity_release' });
  },

  onUnload() {
    if (this.animationId && this.canvas) {
      this.canvas.cancelAnimationFrame(this.animationId);
    }
  }
});