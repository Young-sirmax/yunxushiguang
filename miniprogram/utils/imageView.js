// utils/imageView.js —— 展示侧图片工具：临时链接缓存 + 预加载 + 失效重解析
//
// 背景：云存储图片只能用「临时链接」（tempFileURL）展示，官方有效期约 2 小时。
// 这里做三件事：
//   1. 按 fileID 缓存临时链接（带过期时间戳），有效期内直接复用，不再重复解析；
//   2. 提供预加载，长按预览/进详情前先把图拉起来，避免白块等待；
//   3. 链接过期或图片加载失败时，按 fileID 重新解析一次并回传新链接。
//
// 约定：凡是 cloud:// 开头的一律先解析成临时链接；已是 http(s) 的原样使用。

const cache = require('../cache/cache.js');
const API = require('../api/api.js');

const URL_TTL_SECONDS = 90 * 60;   // 缓存 90 分钟（小于官方 2 小时，留安全余量）
const KEY_PREFIX = 'imgurl:';
const MEM_CACHE_MAX = 300;         // 内存缓存条数上限
const PRUNE_THRESHOLD = 400;       // 本地缓存条数超过该值时整体清理一次

const memCache = {};               // fileID -> { url, expireAt(ms) }
let memKeys = [];                  // memCache 的插入顺序，用于淘汰

const isCloudId = (s) => typeof s === 'string' && s.indexOf('cloud://') === 0;

/** 读缓存（内存优先，其次本地存储；过期一律视为未命中） */
function readCache(fileID) {
  if (!fileID) return '';
  const mem = memCache[fileID];
  if (mem) {
    if (mem.expireAt > Date.now()) return mem.url;
    delete memCache[fileID];
  }
  const stored = cache.get(KEY_PREFIX + fileID); // cache.get 内部会自动处理过期
  if (stored && stored.url) {
    writeMem(fileID, stored.url);
    return stored.url;
  }
  return '';
}

function writeMem(fileID, url) {
  if (!memCache[fileID]) memKeys.push(fileID);
  memCache[fileID] = { url, expireAt: Date.now() + URL_TTL_SECONDS * 1000 };
  if (memKeys.length > MEM_CACHE_MAX) {
    const oldest = memKeys.shift();
    if (oldest && oldest !== fileID) delete memCache[oldest];
  }
}

function writeCache(fileID, url) {
  if (!fileID || !url) return;
  writeMem(fileID, url);
  try {
    cache.set(KEY_PREFIX + fileID, { url }, URL_TTL_SECONDS);
    pruneIfNeeded();
  } catch (err) {
    // 本地存储写满等异常不影响展示
    console.warn('[imageView] 写入链接缓存失败:', err);
  }
}

/** 链接缓存条数过多时整体清理一次（下次访问按需重新解析，不影响正确性） */
function pruneIfNeeded() {
  try {
    const info = wx.getStorageInfoSync();
    const keys = (info && info.keys) || [];
    if (keys.length < PRUNE_THRESHOLD) return;
    let hit = 0;
    keys.forEach(k => { if (k.indexOf(KEY_PREFIX) > -1) hit++; });
    if (hit < PRUNE_THRESHOLD) return;
    keys.forEach(k => { if (k.indexOf(KEY_PREFIX) > -1) wx.removeStorageSync(k); });
    Object.keys(memCache).forEach(k => delete memCache[k]);
    memKeys = [];
  } catch (err) {
    // 忽略
  }
}

/** 清掉某个 fileID 的缓存（链接被判定失效时调用） */
function dropCache(fileID) {
  if (!fileID) return;
  delete memCache[fileID];
  memKeys = memKeys.filter(k => k !== fileID);
  cache.remove(KEY_PREFIX + fileID);
}

/** 客户端直连换取临时链接（云存储可读时最省一次云函数调用） */
function fetchByWxCloud(ids) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.getTempFileURL) {
      reject(new Error('wx.cloud.getTempFileURL 不可用'));
      return;
    }
    wx.cloud.getTempFileURL({
      fileList: ids,
      success: resolve,
      fail: reject
    });
  });
}

/** 兜底：走云函数解析（云存储不可直读时仍可用） */
async function fetchByCloudFunction(ids) {
  const res = await API.resolveImages(ids);
  return (res && res.data) || {};
}

/** 批量解析（wx.cloud 优先，缺失的再用云函数补齐） */
async function resolveMissing(ids) {
  const map = {};
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  for (const chunk of chunks) {
    try {
      const res = await fetchByWxCloud(chunk);
      (res.fileList || []).forEach(f => {
        if (f.fileID && f.tempFileURL) map[f.fileID] = f.tempFileURL;
      });
    } catch (err) {
      console.warn('[imageView] wx.cloud.getTempFileURL 失败，回退云函数:', err);
    }

    const stillMissing = chunk.filter(id => !map[id]);
    if (stillMissing.length > 0) {
      try {
        Object.assign(map, await fetchByCloudFunction(stillMissing));
      } catch (err) {
        console.warn('[imageView] 云函数解析图片链接失败:', err);
      }
    }
  }
  return map;
}

/**
 * 批量把 fileID 换成可展示链接：命中缓存不发请求，未命中的才解析并写缓存
 * @param {string[]} fileIDs
 * @returns {Promise<Object>} { [fileID]: url }
 */
async function resolveIds(fileIDs) {
  const unique = [];
  (fileIDs || []).forEach(id => {
    if (isCloudId(id) && unique.indexOf(id) === -1) unique.push(id);
  });

  const map = {};
  const missing = [];
  unique.forEach(id => {
    const cached = readCache(id);
    if (cached) map[id] = cached;
    else missing.push(id);
  });

  if (missing.length > 0) {
    const fetched = await resolveMissing(missing);
    missing.forEach(id => {
      const url = fetched[id];
      if (url) {
        map[id] = url;
        writeCache(id, url);
      }
    });
  }
  return map;
}

/**
 * 把详情页的图片数组装配成 [{ id, url }]：优先用缓存链接，命中时无需等待云端解析
 * @param {string[]} images 云端已转换的链接数组（可能含 cloud://）
 * @param {string[]} imageIds 原始 fileID 数组（云端新增下发）
 */
function decorateImages(images, imageIds) {
  const urlList = Array.isArray(images) ? images : [];
  const idList = Array.isArray(imageIds) ? imageIds : [];
  return urlList.map((url, index) => {
    const id = idList[index] || (isCloudId(url) ? url : '');
    const cached = id ? readCache(id) : '';
    // key 供 wx:for 使用：优先用 fileID，老数据兜底用下标，保证列表渲染稳定
    return { key: id || 'img-' + index, id, url: cached || url };
  });
}

/** 单个链接失效时重新解析（先清缓存，再解析） */
async function refreshUrl(fileID) {
  if (!fileID) return '';
  dropCache(fileID);
  const map = await resolveIds([fileID]);
  return map[fileID] || '';
}

/**
 * 预加载一张图（下载 + 解码），失败静默：只是加速，不影响正常展示
 * @param {string} src
 * @returns {Promise<boolean>}
 */
function preload(src) {
  if (!src) return Promise.resolve(false);
  return new Promise(resolve => {
    wx.getImageInfo({
      src,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

module.exports = {
  URL_TTL_SECONDS,
  isCloudId,
  readCache,
  resolveIds,
  decorateImages,
  refreshUrl,
  preload
};
