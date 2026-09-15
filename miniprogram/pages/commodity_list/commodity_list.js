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

// 物理常量（七彩正圆泡泡：轻飘飘 · 一点点重力 · 碰撞轻轻反弹）
const GRAVITY = 0.05;      // 一点点重力（向下）：泡泡有轻微沉坠感
const DAMPING = 0.965;     // 空气阻尼：动作轻盈，但会自然渐缓不失控
const RESTITUTION = 0.7;   // 泡泡间碰撞弹性：轻轻反弹
const SPRING_K = 0.0035;   // 回“悬浮点”的柔力：轻盈悬浮，避免沉底/扎堆
const TOUCH_RADIUS = 90;   // 手指影响的半径
const WIND_PROB = 0.02;    // 微风触发概率（每帧）
const WIND_FORCE = 0.18;   // 微风脉冲强度（偶尔上飘，制造轻飘飘感）
const MAX_SPEED = 2.4;     // 速度软上限（px/帧）

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
  // ===== 绝对正圆的七彩泡泡 =====
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

  // 一圈清透的高光边，像薄薄的泡泡膜
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

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

  const fontSize = Math.max(12, r * 0.09);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const titleText = circle.title.length > 8 ? circle.title.substring(0, 7) + '..' : circle.title;
  ctx.fillText(titleText, cx, cy + contentR * 0.15);

  const priceFontSize = Math.max(14, r * 0.12);
  ctx.fillStyle = circle.type === 'want' ? '#2dd8c0' : '#FFD700';
  ctx.font = `bold ${priceFontSize}px sans-serif`;
  ctx.fillText(circle.type === 'want' ? '求购中' : '¥' + circle.price, cx, cy + contentR * 0.5);

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
    ctx.fillStyle = '#00b3a6';
    ctx.fillText('求购中', cx, priceY);
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
  if (isVerified) tagText += ' ✓已认证';
  ctx.fillText(tagText, cx, tagY);
  
  ctx.restore();
}

function drawWantFallback(ctx, cx, cy, r) {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, '#e0f7f5');
  gradient.addColorStop(1, '#00a8a0');
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
    currentType: '', // 类型筛选：'' 全部 | 'sell' 闲置 | 'want' 求购
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
    // 开启右上角菜单的“转发给朋友 / 分享到朋友圈”，否则微信不会显示分享入口
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
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
        type: this.data.currentType,
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
        type: this.data.currentType,
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
        color = item.type === 'want' ? '#00a8a0' : COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
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
        isVerified: item.isStudentVerified || false,
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

  switchType(e) {
    const type = e.currentTarget.dataset.type;
    if (this.data.currentType === type) return;
    this.setData({
      currentType: type,
      page: 1,
      commodityList: [],
      hasMore: true
    });
    this.positionCache = null; // 切换类型时清空位置缓存，重新布局
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
    const type = this.data.currentType === 'want' ? 'want' : (this.data.currentType === 'sell' ? 'sell' : '');
    wx.navigateTo({
      url: '/pages/commodity_release/commodity_release' + (type ? '?type=' + type : '')
    });
  },

  onUnload() {
    if (this.animationId && this.canvas) {
      this.canvas.cancelAnimationFrame(this.animationId);
    }
  }
});