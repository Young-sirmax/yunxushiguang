// utils/bubbleLayout.js —— 小球模式的「不交叠」排布算法
//
// 背景：旧实现是「随机撒点 + 拒绝采样」，每颗最多试 200 次，商品一多就撒不开，
// 全部退化成一堆互相压着的随机位置 —— 表现就是「圆形边缘交叠、界面拥挤」。
//
// 现改为确定性的**错位网格**：先按容器尺寸与商品数量反解出半径，再按行摆放。
// 几何上保证任意两颗泡泡的中心距 ≥ 2r，即画面上不出现交叠。
//
// 纯函数，不依赖 wx.*，可直接在 Node 里跑测试（见 tests/bubbleLayout.test.js）。

/**
 * 错位网格的间距参数
 * @param {number} r 泡泡半径（px）
 * @returns {{jitter:number, stepX:number, stepY:number}}
 *   jitter 抖动幅度（< 相邻中心距的一半，抖动后仍不接触）
 *   stepX  同行相邻两颗的中心距
 *   stepY  行距（略小于 stepX，形成错位排布，比正方网格更省空间）
 */
function bubbleStep(r) {
  const jitter = r * 0.18;
  const stepX = 2 * r + 2 * jitter + 6; // +6 为安全余量
  const stepY = stepX * 0.9;
  return { jitter, stepX, stepY };
}

/** 偶数行 / 奇数行的容量（奇行错位后少放一颗，保证不越出右边界） */
function columnsFor(r, w) {
  const { jitter, stepX } = bubbleStep(r);
  const usableW = Math.max(stepX, w - 2 * (r + jitter));
  const evenCols = Math.max(1, Math.floor(usableW / stepX) + 1);
  const oddCols = Math.max(1, evenCols - 1);
  return { evenCols, oddCols, stepX };
}

/**
 * 枚举容器里所有可用的网格落位点（不带抖动，每行居中）
 * 相邻落位点中心距 ≥ 2r + 2*jitter，因此任意两个不同落位点都不会交叠。
 * 数组顺序即摆放顺序（从左到右、从上到下）。
 */
function latticeSlots(w, h, r) {
  const { jitter, stepX, stepY } = bubbleStep(r);
  const { evenCols, oddCols } = columnsFor(r, w);
  // needH = (rows - 1) * stepY + 2 * (r + jitter) ≤ h  →  rows ≤ (h - 2(r+j)) / stepY + 1
  const span = h - 2 * (r + jitter);
  const maxRows = span < 0 ? 0 : Math.floor(span / stepY) + 1;
  const slots = [];
  for (let row = 0; row < maxRows; row++) {
    const cols = (row % 2 === 1) ? oddCols : evenCols;
    const rowW = (cols - 1) * stepX;
    const startX = (w - rowW) / 2;
    const baseY = r + row * stepY;
    for (let c = 0; c < cols; c++) {
      slots.push({ x: startX + c * stepX, y: baseY });
    }
  }
  return slots;
}

/**
 * 给定半径下容器最多能放几颗
 */
function capacityAt(r, w, h) {
  if (w <= 0 || h <= 0 || r <= 0) return 0;
  return latticeSlots(w, h, r).length;
}

/**
 * 自适应排布：从最大半径往下试，取第一个「装得下 count 颗」的半径。
 * 商品越多 → 半径越小 → 都能铺下且互不交叠（旧版固定直径是交叠的主因之一）。
 *
 * 若连最小半径都装不下（极小屏 + 二级筛选全展开 + 翻了好几页），
 * 返回 minR + 实际容量 capacity，由调用方只渲染 capacity 颗并给出切换提示——
 * 宁可少画几颗，也不允许出现压在一起的泡泡（交叠是本次要修的问题本身）。
 *
 * @param {number} w 容器宽 px
 * @param {number} h 容器高 px
 * @param {number} count 泡泡数量
 * @param {number} maxR 最大半径 px
 * @param {number} minR 最小半径 px
 * @returns {{radius:number, capacity:number}}
 */
function computeBubbleLayout(w, h, count, maxR, minR) {
  if (count <= 0 || w <= 0 || h <= 0) return { radius: maxR, capacity: Math.max(0, count) };
  for (let r = maxR; r >= minR; r -= 1) {
    const cap = capacityAt(r, w, h);
    if (cap >= count) return { radius: r, capacity: cap };
  }
  return { radius: minR, capacity: capacityAt(minR, w, h) };
}

/**
 * 把 circles 就地摆放到错位网格上（每行居中），写入 x / y
 * 调用方须保证 circles.length ≤ capacityAt(r, w, h)；
 * 满足该前提时结果保证：任意两颗中心距 ≥ 2r，且圆心都在 [r, w-r] × [r, h-r] 内
 * @param {Array<{x:number,y:number}>} circles 会被就地修改
 */
function packBubbles(circles, w, h, r) {
  const { jitter } = bubbleStep(r);
  const slots = latticeSlots(w, h, r);
  if (slots.length === 0) return circles;
  const maxX = Math.max(r, w - r);
  const maxY = Math.max(r, h - r);

  for (let i = 0; i < circles.length; i++) {
    const slot = slots[i % slots.length];
    const jx = (Math.random() - 0.5) * 2 * jitter;
    const jy = (Math.random() - 0.5) * 2 * jitter;
    circles[i].x = Math.min(Math.max(slot.x + jx, r), maxX);
    circles[i].y = Math.min(Math.max(slot.y + jy, r), maxY);
  }
  return circles;
}

/** 校验一组已排布的圆是否两两不交叠（测试与自检用） */
function findOverlap(circles, tolerance) {
  const tol = tolerance || 0.5;
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i];
      const b = circles[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < a.radius + b.radius - tol) {
        return { i, j, dist, need: a.radius + b.radius };
      }
    }
  }
  return null;
}

module.exports = {
  bubbleStep,
  columnsFor,
  latticeSlots,
  capacityAt,
  computeBubbleLayout,
  packBubbles,
  findOverlap
};
