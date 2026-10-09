// cloudfunctions/adminBatch/index.js —— 「批量上架」（v2：站内授权 + 极简上传）
//
// 权限（v2 起为两级）：
//   超管  isSuperAdmin —— config 集合 app 记录的 super_admin_openids（缺失时回退 admin_openids）
//   被授权人 isBatchAdmin —— 超管本人，或 batch_admin 集合中 status='active' 的记录
//   授权/回收/名单查询仅超管可调；被授权人不能转授。
//
// 主流程（v2 极简模式）：前端相册直选图片并上传云存储
//      → importRows{mode:'simple'}（标题可空走自动生成、价格可空走面议，写入 status='draft'）
//      → publishBatch（一次上架 ≤50 条）/ publishDraft / deleteDraft
// 高级模式（保留）：unzipImages + importRows（CSV + ZIP），入口已收进折叠区。
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
const MAX_BATCH_PUBLISH = 50;       // publishBatch 单次上架条数上限
const MAX_PAGE_SIZE = 20;
const MAX_IMAGES_PER_POST = 6;      // 与发布页一致
const MAX_TITLE_LEN = 60;
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;

// 极简模式的默认分类（未选分类时落这个；分类集合里若不存在则 categoryId 留空，不影响上架）
const DEFAULT_CATEGORY_NAME = '其他闲置';

// 邀请卡 token 有效期（指令 4.2：5 分钟、一次性）
const INVITE_TTL_MS = 5 * 60 * 1000;
const INVITE_COLLECTION = 'batch_invite';

const VALID_TYPES = ['sell', 'want', 'exchange', 'skill'];
const VALID_PRICE_UNITS = ['per_time', 'per_hour', 'negotiable'];

// ===================== 权限：超管 + 被授权人（两级） =====================

async function readAppConfig() {
  try {
    const res = await db.collection('config').where({ key: 'app' }).limit(1).get();
    return res.data[0] || null;
  } catch (err) {
    console.warn('[adminBatch] 读取 config 失败，按无配置处理:', err.message);
    return null;
  }
}

/** openid 数组规整：去空、去重、去非字符串 */
function normalizeOpenidList(raw) {
  if (!Array.isArray(raw)) return [];
  const list = [];
  raw.forEach(item => {
    const v = typeof item === 'string' ? item.trim() : '';
    if (v && list.indexOf(v) === -1) list.push(v);
  });
  return list;
}

/**
 * 超管判定：config.app.super_admin_openids 优先；
 * 该字段缺失或为空时回退到既有 admin_openids —— 保证存量环境升级后不失效。
 */
async function isSuperAdmin(openid) {
  if (!openid) return false;
  const cfg = await readAppConfig();
  const supers = normalizeOpenidList(cfg && cfg.super_admin_openids);
  const list = supers.length > 0 ? supers : normalizeOpenidList(cfg && cfg.admin_openids);
  return list.indexOf(openid) > -1;
}

/**
 * 批量上架权限：超管天然拥有；其余人查 batch_admin 集合的 active 记录。
 * batch_admin 集合不存在时查询抛错 → 兜底为 false，不影响超管使用。
 */
async function isBatchAdmin(openid) {
  if (!openid) return false;
  if (await isSuperAdmin(openid)) return true;
  try {
    const res = await db.collection('batch_admin')
      .where({ openid, status: 'active' })
      .limit(1)
      .get();
    return res.data.length > 0;
  } catch (err) {
    console.error('[adminBatch] batch_admin 权限校验异常:', err.message);
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

/**
 * 邀请 token：32 位十六进制随机串。
 * 用 crypto 而不是 Math.random —— 这个 token 等价于一次授权，Math.random 可预测，
 * 猜到 token 就能给自己授权。
 */
function randomToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

/**
 * 北京时间的 月日（MMDD）。
 * 云函数运行时时区为 UTC，直接用 getMonth() 会在 08:00 前算出前一天，故显式 +8。
 */
function beijingMMDD() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 无意义文件名特征：相机/微信/截图默认命名、纯数字、长哈希（微信随机名）
const MEANINGLESS_NAME = /^(img|image|video|mmexport|wx_camera|wx_camera_|screenshot|photo|pic|dsc|dji|tim|wechatimg)[-_]?\d*$/i;
const HASH_NAME = /^[a-f0-9]{16,}$/i;

/** 文件名是否为「可读文本」（指令 5.2 规则 1） */
function isReadableFileName(rawName) {
  const base = String(rawName || '').replace(/\.[a-z0-9]+$/i, '').trim();
  if (!base) return false;
  if (/^\d+$/.test(base)) return false;
  if (MEANINGLESS_NAME.test(base)) return false;
  if (HASH_NAME.test(base)) return false;
  return true;
}

/**
 * 标题自动生成（指令 5.2，按优先级，不做自由发挥）：
 *   1) 图片文件名是可读文本 → 直接用文件名（去扩展名，截断 60 字）
 *   2) 否则 → 「闲置 MMDD N/M」
 * 注意：极简模式走 wx.chooseMedia，客户端拿不到相册原始文件名，实际会落到规则 2。
 */
function buildAutoTitle(row, index, total) {
  const fromFile = String(row.fileName || '').replace(/\.[a-z0-9]+$/i, '').trim();
  if (fromFile && isReadableFileName(fromFile)) {
    return fromFile.slice(0, MAX_TITLE_LEN);
  }
  return `闲置 ${beijingMMDD()} ${index + 1}/${total}`;
}

/**
 * 单条上架：draft → onSale。
 * publishDraft（单条）与 publishBatch（批量）共用，保证校验口径不出现两份。
 * @returns {{ok: boolean, msg: string}}
 */
async function publishDraftDoc(id, openid) {
  if (!id) return { ok: false, msg: '缺少信息 ID' };

  let doc = null;
  try {
    const res = await db.collection('commodity').doc(id).get();
    doc = res.data;
  } catch (err) {
    return { ok: false, msg: '信息不存在' };
  }
  if (!doc) return { ok: false, msg: '信息不存在' };
  if (doc.owner !== openid && doc._openid !== openid) {
    return { ok: false, msg: '只能上架自己导入的信息' };
  }
  if (doc.status !== DRAFT_STATUS) {
    return { ok: false, msg: '该信息不是待上架状态' };
  }

  await db.collection('commodity').doc(id).update({
    data: {
      status: PUBLISHED_STATUS,
      reviewTime: db.serverDate(),
      reviewer: openid,
      updateTime: db.serverDate()
    }
  });
  return { ok: true, msg: '已上架' };
}

// ===================== 主流程 =====================

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID;
  const action = event.action;

  // ===== 0) 受邀人接受邀请卡：此时对方还没有任何权限，故不走下方的权限闸门 =====
  if (action === 'acceptInvite') {
    if (!openid) return { code: -1, msg: '请先登录' };
    const token = String(event.token || '').trim();
    if (!token) return { code: -1, msg: '邀请卡无效' };

    let inv = null;
    try {
      const res = await db.collection(INVITE_COLLECTION).where({ token }).limit(1).get();
      inv = res.data[0] || null;
    } catch (err) {
      console.error('[adminBatch] 读取邀请卡失败:', err.message);
      return { code: -1, msg: '邀请卡无效或已失效' };
    }
    if (!inv) return { code: -1, msg: '邀请卡无效或已失效' };
    if (inv.used) return { code: -1, msg: '该邀请卡已被使用' };
    if (new Date(inv.expireAt).getTime() < Date.now()) {
      return { code: -1, msg: '邀请卡已过期，请让管理员重新生成' };
    }

    // 已有权限的人不该把这张卡消耗掉，否则真正需要的人就用不了了。
    // 放在消费之前判断，且此时不动 used。
    const exist = await db.collection('batch_admin')
      .where({ openid, status: 'active' }).limit(1).get();
    if (exist.data.length > 0) {
      return { code: 0, msg: '你已拥有批量上架权限' };
    }

    // 一次性消费：用「条件更新」抢占（where 里带 used:false），
    // 两个并发请求只有一个能把 used 从 false 改成 true，另一个 updated=0 即被判为已被使用。
    // 不能用「先查 used 再写 used」——那中间有窗口，同一张卡会授权给两个人。
    let claimed = 0;
    try {
      const upd = await db.collection(INVITE_COLLECTION)
        .where({ token, used: false })
        .update({ data: { used: true, usedBy: openid, usedAt: db.serverDate() } });
      claimed = (upd && upd.stats && upd.stats.updated) || 0;
    } catch (err) {
      console.error('[adminBatch] 消费邀请卡失败:', err.message);
      return { code: -1, msg: '接受邀请失败，请稍后重试' };
    }
    if (claimed === 0) return { code: -1, msg: '该邀请卡已被使用' };

    const me = await loadOperatorInfo(openid);
    await db.collection('batch_admin').add({
      data: {
        openid,
        nickName: me.nickName,
        avatarUrl: me.avatarUrl,
        grantedBy: inv.grantedBy || '',
        grantTime: db.serverDate(),
        status: 'active',
        note: inv.note || '',
        grantedVia: 'invite'
      }
    });
    return { code: 0, msg: '已获得批量上架权限' };
  }

  // ===== 1) 超管专属：授权 / 回收 / 名单 / 生成邀请卡 =====
  if (action === 'grantAdmin' || action === 'revokeAdmin' ||
      action === 'listAdmins' || action === 'createInvite' ||
      action === 'searchUsers') {
    if (!(await isSuperAdmin(openid))) {
      return { code: -1, msg: '仅超级管理员可操作' };
    }

    // 按昵称/姓名搜索候选用户（指令 4.2 方式 B 的选人来源）
    if (action === 'searchUsers') {
      const keyword = String(event.keyword || '').trim();
      if (!keyword) return { code: 0, data: [], total: 0 };
      try {
        const re = db.RegExp({
          regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          options: 'i'
        });
        const res = await db.collection('user')
          .where(db.command.or([{ nickName: re }, { realName: re }]))
          .limit(20)
          .get();
        return {
          code: 0,
          data: (res.data || []).map(u => ({
            _id: u._id,
            nickName: u.nickName || '',
            realName: u.realName || '',
            avatarUrl: u.avatarUrl || '',
            universityName: u.universityName || ''
          })),
          total: (res.data || []).length
        };
      } catch (err) {
        console.error('[adminBatch] 搜索用户失败:', err.message);
        return { code: -1, msg: '搜索失败，请稍后重试' };
      }
    }

    // 生成邀请卡（指令 4.2 方式 A）：5 分钟有效、一次性
    if (action === 'createInvite') {
      const note = String(event.note || '').trim().slice(0, 50);
      const token = randomToken();
      const expireAt = new Date(Date.now() + INVITE_TTL_MS);
      try {
        await db.collection(INVITE_COLLECTION).add({
          data: {
            token,
            grantedBy: openid,
            note,
            used: false,
            usedBy: '',
            expireAt,
            createdAt: db.serverDate()
          }
        });
      } catch (err) {
        console.error('[adminBatch] 生成邀请卡失败:', err.message);
        return { code: -1, msg: '生成邀请卡失败，请确认已创建 batch_invite 集合' };
      }
      return { code: 0, data: { token, expireAt }, msg: '邀请卡已生成，5 分钟内有效' };
    }

    // 直接授权（指令 4.2 方式 B）：优先用 user._id 反查 openid，也支持直接填 openid
    if (action === 'grantAdmin') {
      const userId = String(event.userId || '').trim();
      let targetOpenid = String(event.openid || '').trim();

      if (!targetOpenid && userId) {
        try {
          const u = await db.collection('user').doc(userId).get();
          targetOpenid = (u.data && u.data._openid) || '';
        } catch (err) {
          console.error('[adminBatch] 反查用户 openid 失败:', err.message);
        }
      }
      if (!targetOpenid) return { code: -1, msg: '请选择要授权的用户' };

      try {
        const exist = await db.collection('batch_admin')
          .where({ openid: targetOpenid, status: 'active' }).limit(1).get();
        if (exist.data.length > 0) {
          return { code: 0, msg: '该用户已拥有批量上架权限' };
        }

        const target = await loadOperatorInfo(targetOpenid);
        await db.collection('batch_admin').add({
          data: {
            openid: targetOpenid,
            nickName: target.nickName,
            avatarUrl: target.avatarUrl,
            grantedBy: openid,
            grantTime: db.serverDate(),
            status: 'active',
            note: String(event.note || '').trim().slice(0, 50),
            grantedVia: 'manual'
          }
        });
      } catch (err) {
        console.error('[adminBatch] 授权失败:', err.message);
        return { code: -1, msg: '授权失败，请确认已创建 batch_admin 集合' };
      }
      return { code: 0, msg: '已授权' };
    }

    // 回收：优先用 batch_admin 记录 _id（listAdmins 下发的脱敏 id），也兼容传 openid
    if (action === 'revokeAdmin') {
      const docId = String(event.id || '').trim();
      const targetOpenid = String(event.openid || '').trim();
      if (!docId && !targetOpenid) return { code: -1, msg: '缺少用户标识' };

      const where = docId ? { _id: docId, status: 'active' } : { openid: targetOpenid, status: 'active' };
      let docs = [];
      try {
        const res = await db.collection('batch_admin').where(where).get();
        docs = res.data || [];
      } catch (err) {
        console.error('[adminBatch] 查询授权记录失败:', err.message);
        return { code: -1, msg: '操作失败，请稍后重试' };
      }
      if (docs.length === 0) return { code: -1, msg: '该用户没有可回收的权限' };

      // 回收只改状态，保留历史（指令 4.3：其历史导入的草稿保留，owner 不变）
      for (const doc of docs) {
        await db.collection('batch_admin').doc(doc._id).update({
          data: {
            status: 'revoked',
            revokedBy: openid,
            revokeTime: db.serverDate()
          }
        });
      }
      return { code: 0, msg: '已回收权限' };
    }

    // 名单：脱敏，不返回完整 openid
    if (action === 'listAdmins') {
      let list = [];
      try {
        const res = await db.collection('batch_admin')
          .orderBy('grantTime', 'desc').limit(100).get();
        list = res.data || [];
      } catch (err) {
        console.error('[adminBatch] 读取授权名单失败:', err.message);
        return { code: -1, msg: '读取名单失败，请确认已创建 batch_admin 集合' };
      }
      return {
        code: 0,
        data: list.map(d => ({
          _id: d._id,
          nickName: d.nickName || '',
          avatarUrl: d.avatarUrl || '',
          note: d.note || '',
          status: d.status || 'active',
          grantedVia: d.grantedVia || 'manual',
          grantTime: d.grantTime || null,
          revokeTime: d.revokeTime || null,
          // 仅给尾 4 位便于人工核对，不下发完整 openid
          openidTail: String(d.openid || '').slice(-4)
        })),
        total: list.length
      };
    }
  }

  // ===== 2) 其余操作：批量上架权限闸门 =====
  if (!(await isBatchAdmin(openid))) {
    return { code: -1, msg: '无批量上架权限，请联系管理员开通' };
  }

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

    // 极简模式（指令 5）：标题可空自动生成、价格可空走面议、分类可空落默认分类
    const simple = event.mode === 'simple';

    const batchId = event.batchId || `batch_${Date.now()}`;
    const [categoryMap, operator] = await Promise.all([loadCategoryMap(), loadOperatorInfo(openid)]);
    const results = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNo = row.rowNo || (i + 1);
      try {
        const type = VALID_TYPES.indexOf(row.type) > -1 ? row.type : 'sell';

        // 标题：极简模式为空时按 5.2 规则自动生成（fileName 可读则用文件名，否则「闲置 MMDD N/M」）
        let title = String(row.title || '').trim();
        if (!title && simple) title = buildAutoTitle(row, i, rows.length);
        const description = String(row.description || '').trim();

        if (!title) throw new Error('标题为空');
        if (title.length > MAX_TITLE_LEN) throw new Error(`标题超过 ${MAX_TITLE_LEN} 字`);

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

        // 价格规则（指令 5.3：极简模式允许留空 → price=0 + negotiable，详情页显示「价格面议」）
        let price = toNumber(row.price);
        let priceUnit = '';
        if (type === 'sell') {
          if (!(price > 0)) {
            if (!simple) throw new Error('价格必须大于 0');
            price = 0;
            priceUnit = 'negotiable';
          }
        } else if (type === 'skill') {
          priceUnit = VALID_PRICE_UNITS.indexOf(row.priceUnit) > -1 ? row.priceUnit : 'negotiable';
          if (priceUnit === 'negotiable') price = 0;
          else if (!(price > 0)) throw new Error('技能服务需填写报价金额或选择面议');
        } else {
          price = 0;
        }

        const categoryName = String(row.category || '').trim() || (simple ? DEFAULT_CATEGORY_NAME : '');

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
    const r = await publishDraftDoc(event.id, openid);
    return r.ok ? { code: 0, msg: r.msg } : { code: -1, msg: r.msg };
  }

  // ===== 4') 批量上架（指令 7：ids[] 一次 ≤50 条，内部复用 publishDraft 逻辑） =====
  if (action === 'publishBatch') {
    const ids = Array.isArray(event.ids) ? event.ids.slice(0, MAX_BATCH_PUBLISH) : [];
    if (ids.length === 0) return { code: -1, msg: '没有可上架的信息' };

    const results = [];
    let okCount = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        const r = await publishDraftDoc(id, openid);
        if (r.ok) okCount += 1;
        results.push({ id, ok: r.ok, msg: r.msg });
      } catch (err) {
        // 单条失败不阻断整批（与前端「不整批回滚」的约定一致）
        console.error('[adminBatch] 批量上架单条失败:', id, err.message);
        results.push({ id, ok: false, msg: '上架失败' });
      }
    }

    const failCount = results.length - okCount;
    return {
      code: 0,
      data: { results, okCount, failCount, truncated: (event.ids || []).length > MAX_BATCH_PUBLISH },
      msg: `已上架 ${okCount} 条${failCount > 0 ? `，失败 ${failCount} 条` : ''}`
    };
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
