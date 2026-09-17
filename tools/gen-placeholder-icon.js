// tools/gen-placeholder-icon.js —— 生成「公益图书角」入口占位图标（144x144 PNG）
//
// 用途：指令 7 要求首页入口先用占位图，茶咖 logo 到位后直接覆盖
//       miniprogram/images/bookcorner-entry.png 即可（尺寸保持 144x144 正方形，圆角 24%）。
// 运行：node tools/gen-placeholder-icon.js
// 说明：不引入任何依赖，用 Node 内置 zlib 手工写 PNG。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 144;

// ===== PNG 基础 =====
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ===== 形状（圆角矩形，带 3x3 超采样抗锯齿） =====
function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const inXBand = (x >= x0 + r && x <= x1 - r);
  const inYBand = (y >= y0 + r && y <= y1 - r);
  if (inXBand || inYBand) return true;
  const cx = x < x0 + r ? x0 + r : x1 - r;
  const cy = y < y0 + r ? y0 + r : y1 - r;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function coverage(shape, px, py) {
  let hit = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const x = px + (sx + 0.5) / 3;
      const y = py + (sy + 0.5) / 3;
      if (insideRoundRect(x, y, shape[0], shape[1], shape[2], shape[3], shape[4])) hit++;
    }
  }
  return hit / 9;
}

// 背景：主色渐变（#3ce8b2 → #00a9c4），圆角 34
const BG_TOP = [0x3c, 0xe8, 0xb2];
const BG_BOTTOM = [0x00, 0xa9, 0xc4];
const bgShape = [0, 0, SIZE - 1, SIZE - 1, 34];

// 书本：左右两页 + 中间书脊留缝
const leftPage = [30, 46, 69, 104, 10];
const rightPage = [75, 46, 114, 104, 10];
// 书签：阳光黄
const bookmark = [86, 46, 102, 82, 5];

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const bgA = coverage(bgShape, x, y);
    if (bgA <= 0) continue;

    const t = y / (SIZE - 1);
    let r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t;
    let g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t;
    let b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t;

    // 白色书页
    const pageCov = Math.max(coverage(leftPage, x, y), coverage(rightPage, x, y));
    if (pageCov > 0) {
      r = r + (255 - r) * pageCov;
      g = g + (255 - g) * pageCov;
      b = b + (255 - b) * pageCov;
    }

    // 黄色书签
    const markCov = coverage(bookmark, x, y);
    if (markCov > 0) {
      r = r + (0xff - r) * markCov;
      g = g + (0xc5 - g) * markCov;
      b = b + (0x3d - b) * markCov;
    }

    rgba[i] = Math.round(r);
    rgba[i + 1] = Math.round(g);
    rgba[i + 2] = Math.round(b);
    rgba[i + 3] = Math.round(bgA * 255);
  }
}

const outPath = path.join(__dirname, '..', 'miniprogram', 'images', 'bookcorner-entry.png');
fs.writeFileSync(outPath, encodePng(rgba, SIZE, SIZE));
console.log('已生成占位图标：' + outPath + ' (' + SIZE + 'x' + SIZE + ')');
