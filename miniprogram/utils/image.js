// utils/image.js —— 图片上传前的压缩与数量控制
// 目标：单张 ≤ 500KB；长边尽量压到 1280px 以内；减少云存储与流量成本
// 另提供 makeThumb：为列表/气泡生成小图（列表只用小图，详情才用原图）

const MAX_SIZE_BYTES = 500 * 1024;   // 单张上限 500KB
const MAX_EDGE = 1280;               // 长边上限（px）
const MAX_IMAGES_PER_POST = 9;       // 单帖图片数上限（沿用现有发布页 9 张）
const THUMB_MAX_EDGE = 320;          // 列表/气泡缩略图长边（px）
const THUMB_QUALITY = 80;            // 缩略图 jpg 质量

/**
 * 读取本地文件大小
 * @param {string} filePath
 * @returns {Promise<number>} 字节数，失败返回 0
 */
function getFileSize(filePath) {
  return new Promise((resolve) => {
    try {
      wx.getFileSystemManager().getFileInfo({
        filePath,
        success: (res) => resolve(res.size || 0),
        fail: () => resolve(0)
      });
    } catch (err) {
      resolve(0);
    }
  });
}

/**
 * 读取图片宽高
 * @param {string} filePath
 * @returns {Promise<{width:number,height:number}>}
 */
function getImageSize(filePath) {
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: filePath,
      success: (res) => resolve({ width: res.width || 0, height: res.height || 0 }),
      fail: () => resolve({ width: 0, height: 0 })
    });
  });
}

/**
 * 按质量压缩一次
 */
function compressOnce(filePath, quality) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality,
      success: (res) => resolve(res.tempFilePath || filePath),
      fail: () => resolve(filePath)
    });
  });
}

/**
 * 压缩单张图片：先用质量阶梯逼近 500KB；若原图长边超限且平台支持离屏画布，再等比缩小。
 * 任何一步失败都回退到原图，保证不阻塞发布流程。
 * @param {string} filePath 本地临时路径
 * @returns {Promise<string>} 压缩后的本地路径
 */
async function compressImage(filePath) {
  if (!filePath || filePath.indexOf('cloud://') === 0 || filePath.indexOf('http') === 0) {
    return filePath;
  }

  let out = filePath;
  let size = await getFileSize(filePath);

  // 1) 质量阶梯压缩
  if (size > MAX_SIZE_BYTES || size === 0) {
    const ladder = [80, 60, 40, 25];
    for (let i = 0; i < ladder.length; i++) {
      out = await compressOnce(filePath, ladder[i]);
      size = await getFileSize(out);
      if (size > 0 && size <= MAX_SIZE_BYTES) break;
    }
  }

  // 2) 长边超限时尝试等比缩小（失败则忽略，沿用已压缩结果）
  try {
    const { width, height } = await getImageSize(out);
    const longEdge = Math.max(width, height);
    if (longEdge > MAX_EDGE && width > 0 && height > 0) {
      const scaled = await scaleByCanvas(out, width, height, longEdge);
      if (scaled) {
        const scaledSize = await getFileSize(scaled);
        if (scaledSize === 0 || scaledSize <= size || size === 0) out = scaled;
      }
    }
  } catch (err) {
    console.warn('[image] 等比缩小跳过:', err);
  }

  return out;
}

/**
 * 用离屏画布等比缩小到长边 1280（尽量不改变文件名/格式由导出决定）
 * 说明：离屏 2d 画布在部分基础库版本不可用，失败时返回空串由调用方回退
 */
function scaleByCanvas(filePath, width, height, longEdge) {
  return new Promise((resolve) => {
    if (!wx.createOffscreenCanvas) {
      resolve('');
      return;
    }
    try {
      const ratio = MAX_EDGE / longEdge;
      const targetW = Math.round(width * ratio);
      const targetH = Math.round(height * ratio);
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: targetW, height: targetH });
      const ctx = canvas.getContext('2d');
      const img = canvas.createImage();
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, targetW, targetH);
          // 离屏画布无法直接导出临时文件时返回空串，由调用方回退
          resolve('');
        } catch (err) {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = filePath;
    } catch (err) {
      resolve('');
    }
  });
}

/**
 * 批量压缩（顺序执行，避免并发压缩导致内存峰值）
 * @param {string[]} paths
 * @returns {Promise<string[]>}
 */
async function compressImages(paths) {
  const result = [];
  for (let i = 0; i < paths.length; i++) {
    try {
      result.push(await compressImage(paths[i]));
    } catch (err) {
      result.push(paths[i]);
    }
  }
  return result;
}

/** 剩余可上传张数 */
function remainCount(currentLength) {
  return Math.max(0, MAX_IMAGES_PER_POST - (currentLength || 0));
}

/**
 * 用页面里隐藏的 2d canvas 生成缩略图（长边 ≤320px 的 jpg）
 * 用途：列表卡片与首页气泡只加载小图，详情页才加载原图 —— 显著减少流量、加快首屏。
 * 任何一步失败都返回空串，由调用方回退用原图，保证发布流程不被阻断。
 * @param {string} filePath 本地图片路径（临时文件）
 * @param {string} canvasId 页面 WXML 中 <canvas type="2d" id="..."> 的 id
 * @returns {Promise<string>} 缩略图临时路径，失败返回 ''
 */
function makeThumb(filePath, canvasId) {
  return new Promise((resolve) => {
    if (!filePath || !canvasId || typeof wx.createSelectorQuery !== 'function') {
      resolve('');
      return;
    }
    try {
      wx.createSelectorQuery()
        .select('#' + canvasId)
        .fields({ node: true, size: true })
        .exec(async (res) => {
          const canvas = res && res[0] && res[0].node;
          if (!canvas || typeof canvas.getContext !== 'function') {
            resolve('');
            return;
          }
          try {
            const size = await getImageSize(filePath);
            const longEdge = Math.max(size.width, size.height);
            if (!longEdge) {
              resolve('');
              return;
            }
            const ratio = Math.min(1, THUMB_MAX_EDGE / longEdge);
            const w = Math.max(1, Math.round(size.width * ratio));
            const h = Math.max(1, Math.round(size.height * ratio));

            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            const img = canvas.createImage();

            img.onload = () => {
              try {
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                wx.canvasToTempFilePath({
                  canvas,
                  x: 0,
                  y: 0,
                  width: w,
                  height: h,
                  destWidth: w,
                  destHeight: h,
                  fileType: 'jpg',
                  quality: THUMB_QUALITY,
                  success: (r) => resolve(r.tempFilePath || ''),
                  fail: (err) => {
                    console.warn('[image] 缩略图导出失败，回退原图:', err);
                    resolve('');
                  }
                });
              } catch (err) {
                resolve('');
              }
            };
            img.onerror = () => resolve('');
            img.src = filePath;
          } catch (err) {
            resolve('');
          }
        });
    } catch (err) {
      resolve('');
    }
  });
}

module.exports = {
  MAX_SIZE_BYTES,
  MAX_EDGE,
  MAX_IMAGES_PER_POST,
  THUMB_MAX_EDGE,
  compressImage,
  compressImages,
  remainCount,
  makeThumb
};
