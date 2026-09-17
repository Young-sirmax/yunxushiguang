// cloudfunctions/adminBatch/index.js —— 管理员「批量上架」
//
// 权限：config 集合 app 记录的 admin_openids 白名单（数组），不在白名单直接拒绝。
// 流程：unzipImages（解压图片包→云存储，返回 文件名→fileID 映射）
//      → importRows（逐行校验 + 内容安全检测 + 写入 status='draft'）
//      → listDrafts / publishDraft（转 onSale）/ deleteDraft
//
// 说明：规格中的"转为 open"在本项目里映射为既有的 status='onSale'
//      （公开列表固定过滤 onSale，直接用 open 会导致上架后不可见）。
const cloud = require('wx-server-sdk');
const AdmZip = require('adm-zip');
const { buildDisplayKeyword } = require('./displayKeyword.js');

cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

const DRAFT_STATUS = 'draft';
const PUBLISHED_STATUS = 'onSale';

const MAX_IMAGES_PER_UNZIP = 120;   // 单次解压上传的图片上限
const MAX_ROWS_PER_IMPORT = 50;     // 单次导入的行数上限
const MAX_PAGE_SIZE = 20;
const MAX_IMAGES_PER_POST = 6;      // 与发布页一致
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;

const VALID_TYPES = ['sell', 'want', 'exchange', 'skill'];
const VALID_PRICE_UNITS = ['per_time', 'per_hour', 'negotiable'];

// ===================== 权限：白名单 =====================

async function isBatchAdmin(openid) {
  if (!openid) return false;
  try {
    const res = await db.collection('config').where({ key: 'app' }).limit(1).get();
    const cfg = res.data[0];
    const list = (cfg && Array.isArray(cfg.admin_openids)) ? cfg.admin_openids : [];
    return list.indexOf(openid) > -1;
  } catch (err) {
    console.error('[adminBatch] 白名单校验异常:', err.message);
    return false;
  }
}

// ===================== 内容安全（与 commodity 云函数同源实现） =====================

async function checkTextSecurity(text, label) {
  if (!text || !String(text).trim()) return { ok: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: String(text) });
    if (res.errCode === 0) return { ok: true };
    return { ok: false, msg: `${label || '文本'}包含违规信息` };
  } catch (err) {
    console.error('[adminBatch] msgSecCheck 异常，降级放行:', err.errCode, err.errMsg);
    return { ok: true };
  }
}

async function checkImageSecurity(fileID, label) {
  if (!fileID || String(fileID).indexOf('cloud://') !== 0) return { ok: true };
  try {
    const downloadRes = await cloud.downloadFile({ fileID });
    const res = await cloud.openapi.security.imgSecCheck({
      media: { contentType: 'image/jpeg', value: downloadRes.fileContent }
    });
    if (res.errCode === 0) return { ok: true };
    return { ok: false, msg: `${label || '图片'}包含违规信息` };
  } catch (err) {
    console.error('[adminBatch] imgSecCheck 异常，降级放行:', err.errCode, err.errMsg);
    return { ok: true };
  }
}

// ===================== 工具 =====================

/** 云存储路径只保留 ASCII，避免中文/特殊字符导致上传失败 */
function sanitizeName(name) {
  return String(name || 'img').replace(/[^A-Za-z0-9._-]/g, '_').slice(-60);
}

/** 宽松匹配键：去掉扩展名、空格、下划线、横线并转小写 */
function normalizeKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[\s_\-()（）]/g, '');
}

function toNumber(val) {
  const n = Number(String(val == null ? '' : val).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 分类名 → categoryId（便于首页分类筛选） */
async function loadCategoryMap() {
  try {
    const res = await db.collection('category').get();
    const map = {};
    (res.data || []).forEach(c => { map[String(c.name || '').trim()] = c._id; });
    return map;
  } catch (err) {
    console.warn('[adminBatch] 读取分类失败，categoryId 留空:', err.message);
    return {};
  }
}

async function loadOperatorInfo(openid) {
  try {
    const res = await db.collection('user').where({ _openid: openid }).limit(1).get();
    const u = res.data[0] || {};
    return { nickName: u.nickName || '', avatarUrl: u.avatarUrl || '' };
  } catch (err) {
    return { nickName: '', avatarUrl: '' };
  }
}

// ===================== 主流程 =====================

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID;

  // 第一步：白名单校验（所有操作统一拦截）
  if (!(await isBatchAdmin(openid))) {
    return { code: -1, msg: '无批量上架权限，请联系管理员开通' };
  }

  const action = event.action;

  // ===== 1) 解压图片包 → 云存储，返回文件名映射 =====
  if (action === 'unzipImages') {
    const zipFileID = event.zipFileID;
    if (!zipFileID) return { code: -1, msg: '缺少压缩包' };

    let zip;
    try {
      const downloadRes = await cloud.downloadFile({ fileID: zipFileID });
      zip = new AdmZip(downloadRes.fileContent);
    } catch (err) {
      console.error('[adminBatch] 解压失败:', err.message);
      return { code: -1, msg: '压缩包解析失败，请确认是 zip 格式' };
    }

    const allEntries = zip.getEntries().filter(e => !e.isDirectory && IMAGE_EXT.test(e.entryName));
    if (allEntries.length === 0) {
      return { code: -1, msg: '压缩包内没有找到图片（支持 jpg/jpeg/png/webp/gif/bmp）' };
    }

    const picked = allEntries.slice(0, MAX_IMAGES_PER_UNZIP);
    const map = {};
    const failed = [];
    const stamp = Date.now();
    let uploadedCount = 0;

    for (let i = 0; i < picked.length; i++) {
      const entry = picked[i];
      const rawBase = String(entry.entryName).split('/').pop();
      try {
        const up = await cloud.uploadFile({
          cloudPath: `batch/${stamp}_${i}_${sanitizeName(rawBase)}`,
          fileContent: entry.getData()
        });
        const lower = rawBase.toLowerCase();
        map[lower] = up.fileID;                 // 全名（含扩展名）
        map[normalizeKey(rawBase)] = up.fileID; // 宽松键（不含扩展名/分隔符）
        uploadedCount += 1;
      } catch (err) {
        failed.push({ name: rawBase, error: err.message || '上传失败' });
      }
    }

    return {
      code: 0,
      data: {
        map,
        uploadedCount,
        zipImageTotal: allEntries.length,
        truncated: allEntries.length > picked.length,
        failed
      },
      msg: `已上传 ${uploadedCount} 张图片`
    };
  }

  // ===== 2) 导入行（写入待上架） =====
  if (action === 'importRows') {
    const rows = Array.isArray(event.rows) ? event.rows.slice(0, MAX_ROWS_PER_IMPORT) : [];
    if (rows.length === 0) return { code: -1, msg: '没有可导入的行' };

    const batchId = event.batchId || `batch_${Date.now()}`;
    const [categoryMap, operator] = await Promise.all([loadCategoryMap(), loadOperatorInfo(openid)]);
    const results = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNo = row.rowNo || (i + 1);
      try {
        const type = VALID_TYPES.indexOf(row.type) > -1 ? row.type : 'sell';
        const title = String(row.title || '').trim();
        const description = String(row.description || '').trim();

        if (!title) throw new Error('标题为空');
        if (title.length > 60) throw new Error('标题超过 60 字');

        // 文本安全检测
        const titleCheck = await checkTextSecurity(title, '标题');
        if (!titleCheck.ok) throw new Error(titleCheck.msg);
        const descCheck = await checkTextSecurity(description, '描述');
        if (!descCheck.ok) throw new Error(descCheck.msg);

        // 图片（最多 6 张，逐张安全检测）
        const images = (Array.isArray(row.images) ? row.images : [])
          .filter(img => typeof img === 'string' && img.indexOf('cloud://') === 0)
          .slice(0, MAX_IMAGES_PER_POST);
        for (let k = 0; k < images.length; k++) {
          const imgCheck = await checkImageSecurity(images[k], `第${k + 1}张图片`);
          if (!imgCheck.ok) throw new Error(imgCheck.msg);
        }

        // 价格规则
        let price = toNumber(row.price);
        let priceUnit = '';
        if (type === 'sell') {
          if (!(price > 0)) throw new Error('价格必须大于 0');
        } else if (type === 'skill') {
          priceUnit = VALID_PRICE_UNITS.indexOf(row.priceUnit) > -1 ? row.priceUnit : 'negotiable';
          if (priceUnit === 'negotiable') price = 0;
          else if (!(price > 0)) throw new Error('技能服务需填写报价金额或选择面议');
        } else {
          price = 0;
        }

        const categoryName = String(row.category || '').trim();

        const doc = {
          // 归属：owner 为管理员本人；_openid 同步为 owner，保证现有卖家信息注入/我的发布可用
          _openid: openid,
          owner: openid,
          operator: openid,
          type,
          title,
          description,
          price,
          price_unit: priceUnit,
          originalPrice: 0,
          condition: String(row.condition || '').trim(),
          quantity: 1,
          tradeLocation: String(row.tradeLocation || '').trim(),
          categoryId: categoryMap[categoryName] || '',
          categoryName,
          images,
          // 以物易物需有期望交换物：CSV 未提供时用标题兜底，保证记录自洽
          exchange_want: type === 'exchange'
            ? (String(row.exchangeWant || '').trim() || title)
            : '',
          accept_price_diff: null,
          available_time: '',
          major: [],
          sellerName: operator.nickName,
          sellerAvatar: operator.avatarUrl,
          status: DRAFT_STATUS,       // 待上架，确认后才置为 onSale
          tradeStatus: 'open',
          viewCount: 0,
          importBatchId: batchId,
          importRowNo: rowNo,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        };
        doc.display_keyword = buildDisplayKeyword({
          title: doc.title,
          type: doc.type,
          categoryName: doc.categoryName,
          skillName: ''
        });

        const addRes = await db.collection('commodity').add({ data: doc });
        results.push({ rowNo, ok: true, id: addRes._id, images: images.length });
      } catch (err) {
        results.push({ rowNo, ok: false, error: err.message || '导入失败' });
      }
    }

    const okCount = results.filter(r => r.ok).length;
    return {
      code: 0,
      data: { batchId, results, okCount, failCount: results.length - okCount },
      msg: `成功 ${okCount} 条，失败 ${results.length - okCount} 条`
    };
  }

  // ===== 3) 待上架列表 =====
  if (action === 'listDrafts') {
    const page = Math.max(1, parseInt(event.page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(event.pageSize, 10) || 20));
    const where = { status: DRAFT_STATUS, owner: openid };

    const totalRes = await db.collection('commodity').where(where).count();
    const listRes = await db.collection('commodity')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    const list = (listRes.data || []).map(item => ({
      _id: item._id,
      title: item.title || '',
      type: item.type || 'sell',
      price: item.price || 0,
      price_unit: item.price_unit || '',
      categoryName: item.categoryName || '',
      importRowNo: item.importRowNo || 0,
      importBatchId: item.importBatchId || '',
      imagesCount: (item.images || []).length,
      cover: (item.images || [])[0] || '',
      createTime: item.createTime || null
    }));

    return { code: 0, data: list, total: totalRes.total, page, pageSize };
  }

  // ===== 4) 单条上架（draft → onSale） =====
  if (action === 'publishDraft') {
    const id = event.id;
    if (!id) return { code: -1, msg: '缺少信息 ID' };

    let doc = null;
    try {
      const res = await db.collection('commodity').doc(id).get();
      doc = res.data;
    } catch (err) {
      return { code: -1, msg: '信息不存在' };
    }
    if (!doc) return { code: -1, msg: '信息不存在' };
    if (doc.owner !== openid && doc._openid !== openid) {
      return { code: -1, msg: '只能上架自己导入的信息' };
    }
    if (doc.status !== DRAFT_STATUS) {
      return { code: -1, msg: '该信息不是待上架状态' };
    }

    await db.collection('commodity').doc(id).update({
      data: {
        status: PUBLISHED_STATUS,
        reviewTime: db.serverDate(),
        reviewer: openid,
        updateTime: db.serverDate()
      }
    });
    return { code: 0, msg: '已上架' };
  }

  // ===== 5) 删除待上架（连带清理云存储图片） =====
  if (action === 'deleteDraft') {
    const id = event.id;
    if (!id) return { code: -1, msg: '缺少信息 ID' };

    let doc = null;
    try {
      const res = await db.collection('commodity').doc(id).get();
      doc = res.data;
    } catch (err) {
      return { code: -1, msg: '信息不存在' };
    }
    if (!doc) return { code: -1, msg: '信息不存在' };
    if (doc.owner !== openid && doc._openid !== openid) {
      return { code: -1, msg: '只能删除自己导入的信息' };
    }

    const images = (doc.images || []).filter(img => typeof img === 'string' && img.indexOf('cloud://') === 0);
    await db.collection('commodity').doc(id).remove();
    if (images.length) {
      try {
        await cloud.deleteFile({ fileList: images.slice(0, 50) });
      } catch (err) {
        console.warn('[adminBatch] 删除图片失败:', err.message);
      }
    }
    return { code: 0, msg: '已删除' };
  }

  return { code: -1, msg: '未知操作' };
};
