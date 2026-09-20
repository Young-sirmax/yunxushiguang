// tests/bubbleLayout.test.js —— 小球排布「不交叠」回归测试
//
// 运行方式（需要 Node）：
//   node tests/bubbleLayout.test.js
//
// 覆盖：常见机型容器尺寸 × 商品数量 1~40，逐条断言
//   1) 实际渲染的泡泡任意两颗不交叠
//   2) 所有圆心都在容器内
//   3) 数量超过容量时，容量之外的泡泡被裁掉（而不是压在一起）
// 这是「圆形边缘交叠」这个线上问题的防回归用例，改排布参数后必须仍然全绿。

const {
  computeBubbleLayout,
  capacityAt,
  packBubbles,
  findOverlap
} = require('../miniprogram/utils/bubbleLayout.js');

// rpx → px：以 375pt 宽机型为基准
const RPX = 375 / 750;
const MAX_RPX = 220;  // 与 commodity_list.js 的 BUBBLE_MAX_RPX 一致
const MIN_RPX = 104;  // 与 commodity_list.js 的 BUBBLE_MIN_RPX 一致
const MAX_R = (MAX_RPX * RPX) / 2;
const MIN_R = (MIN_RPX * RPX) / 2;

// 常见容器尺寸（宽 × 高，px）：画布区 = 屏幕高 - 头部 - 筛选栏 - tabBar
const CONTAINERS = [
  { name: 'iPhone SE 小屏', w: 320, h: 300 },
  { name: 'iPhone 13 基准', w: 375, h: 430 },
  { name: 'iPhone Pro Max', w: 430, h: 520 },
  { name: '窄高屏（二级筛选全展开）', w: 375, h: 260 },
  { name: '极小容器（压力用例）', w: 300, h: 200 }
];

const COUNTS = [1, 2, 3, 5, 8, 12, 15, 20, 25, 30, 40];

let pass = 0;
let fail = 0;
const failures = [];

function check(desc, cond, extra) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(desc + (extra ? ' → ' + extra : ''));
  }
}

for (const box of CONTAINERS) {
  for (const count of COUNTS) {
    const { radius: r, capacity: cap } = computeBubbleLayout(box.w, box.h, count, MAX_R, MIN_R);

    check(
      `${box.name} / ${count} 颗：半径落在 [${MIN_R.toFixed(2)}, ${MAX_R.toFixed(2)}]`,
      r >= MIN_R - 1e-6 && r <= MAX_R + 1e-6,
      `实际 ${r.toFixed(2)}`
    );

    check(
      `${box.name} / ${count} 颗：容量足够或有明确上限`,
      cap >= Math.min(count, capacityAt(MIN_R, box.w, box.h)),
      `capacity=${cap}`
    );

    // 实际渲染数量 = min(count, capacity)
    const renderCount = Math.min(count, cap);

    // 连跑 20 遍：packBubbles 带随机抖动，必须每一遍都不交叠
    for (let round = 0; round < 20; round++) {
      const circles = [];
      for (let i = 0; i < renderCount; i++) circles.push({ x: 0, y: 0, radius: r });
      packBubbles(circles, box.w, box.h, r);

      const overlap = findOverlap(circles);
      check(
        `${box.name} / ${count} 颗 / 第 ${round + 1} 遍：无交叠`,
        !overlap,
        overlap
          ? `第 ${overlap.i}、${overlap.j} 颗中心距 ${overlap.dist.toFixed(2)} < ${overlap.need.toFixed(2)}`
          : ''
      );

      const out = circles.find(c => c.x < r - 1e-6 || c.x > box.w - r + 1e-6 || c.y < r - 1e-6 || c.y > box.h - r + 1e-6);
      check(
        `${box.name} / ${count} 颗 / 第 ${round + 1} 遍：圆心都在容器内`,
        !out,
        out ? `越界 (${out.x.toFixed(1)}, ${out.y.toFixed(1)}) r=${r.toFixed(1)}` : ''
      );
    }
  }
}

// 商品变多时半径必须单调不增（否则就是「小容器塞大泡泡」的旧问题）
let prev = Infinity;
let monotonic = true;
for (const count of COUNTS) {
  const { radius } = computeBubbleLayout(375, 430, count, MAX_R, MIN_R);
  if (radius > prev + 1e-6) monotonic = false;
  prev = radius;
}
check('商品数量增加时泡泡半径单调不增', monotonic);

// 只有 1 颗时应该用最大半径（少的时候保持原有大泡泡观感）
check(
  '只有 1 颗时用最大半径',
  Math.abs(computeBubbleLayout(375, 430, 1, MAX_R, MIN_R).radius - MAX_R) < 1e-6
);

// 正常机型下，一页 20 条不该被裁剪（分页体验不能被容量上限破坏）
check(
  'iPhone 13 容器下 20 颗全部可渲染',
  computeBubbleLayout(375, 430, 20, MAX_R, MIN_R).capacity >= 20
);
check(
  'iPhone Pro Max 容器下 40 颗全部可渲染',
  computeBubbleLayout(430, 520, 40, MAX_R, MIN_R).capacity >= 40
);

// 边界输入不崩
check('count=0 返回最大半径', computeBubbleLayout(375, 430, 0, MAX_R, MIN_R).radius === MAX_R);
check('容器为 0 时返回最大半径', computeBubbleLayout(0, 0, 10, MAX_R, MIN_R).radius === MAX_R);

console.log(`\n通过 ${pass} 条，失败 ${fail} 条`);
if (fail > 0) {
  console.log('\n失败明细：');
  failures.slice(0, 20).forEach(f => console.log('  ✗ ' + f));
  if (failures.length > 20) console.log(`  ... 另有 ${failures.length - 20} 条`);
  process.exit(1);
}
console.log('小球排布：全部用例无交叠 ✓\n');
