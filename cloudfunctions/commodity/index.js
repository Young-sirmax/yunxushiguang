const cloud = require('wx-server-sdk');
const { buildDisplayKeyword } = require('./displayKeyword.js');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

// ===================== 图片临时链接缓存（进程内，热实例复用） =====================
// 官方 tempFileURL 有效期约 2 小时；这里缓存 100 分钟，留足安全余量。
// 目的：列表/详情在有效期内重复进入时不再调用 getTempFileURL，省一次网络往返与耗时。
const TEMP_URL_TTL_MS = 100 * 60 * 1000;
const TEMP_URL_CACHE_MAX = 2000; // 简单容量上限，避免长驻实例内存无限增长
const tempUrlCache = new Map(); // fileID -> { url, expireAt }

function getCachedTempUrl(fileID) {
  const hit = tempUrlCache.get(fileID);
  if (!hit) return '';
  if (hit.expireAt > Date.now()) return hit.url;
  tempUrlCache.delete(fileID); // 过期即失效，绝不返回过期链接
  return '';
}

function setCachedTempUrl(fileID, url) {
  if (!fileID || !url) return;
  tempUrlCache.set(fileID, { url, expireAt: Date.now() + TEMP_URL_TTL_MS });
  if (tempUrlCache.size > TEMP_URL_CACHE_MAX) {
    // Map 迭代顺序为插入顺序，直接淘汰最早的一条
    const oldest = tempUrlCache.keys().next().value;
    tempUrlCache.delete(oldest);
  }
}

/** 收集条目里的 cloud:// fileID（去重）：含 images 数组与列表缩略图 thumb */
function collectFileIDs(items) {
  const ids = [];
  const push = (v) => {
    if (typeof v === 'string' && v.indexOf('cloud://') === 0 && ids.indexOf(v) === -1) ids.push(v);
  };
  (items || []).forEach(it => {
    if (!it) return;
    if (Array.isArray(it.images)) it.images.forEach(push);
    push(it.thumb);
  });
  return ids;
}

/** 批量把 fileID 换成临时链接，命中缓存的不再请求 */
async function fetchTempUrls(fileIDs) {
  const urlMap = {};
  const missing = [];
  (fileIDs || []).forEach(id => {
    const cached = getCachedTempUrl(id);
    if (cached) urlMap[id] = cached;
    else if (missing.indexOf(id) === -1) missing.push(id);
  });

  if (missing.length > 0) {
    try {
      const tempRes = await cloud.getTempFileURL({ fileList: missing });
      (tempRes.fileList || []).forEach(f => {
        const url = f.tempFileURL || '';
        if (f.fileID && url) {
          urlMap[f.fileID] = url;
          setCachedTempUrl(f.fileID, url);
        }
      });
    } catch (err) {
      console.error('[commodity] getTempFileURL 失败:', err && err.message);
    }
  }
  return urlMap;
}

// ===================== 内容安全检查 =====================

/**
 * 文本安全检查 msgSecCheck
 * @param {string} text - 待检测文本
 * @returns {Promise<{ok: boolean, msg: string}>}
 */
async function checkTextSecurity(text) {
  if (!text || !text.trim()) return { ok: true, msg: '' };
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: text
    });
    if (res.errCode === 0) {
      return { ok: true, msg: '' };
    }
    return { ok: false, msg: `文本「${text.substring(0, 20)}...」涉嫌违规` };
  } catch (err) {
    console.error('msgSecCheck 异常，降级放行:', err.errCode, err.errMsg);
    // 接口调用异常时降级放行，避免安全检查服务异常导致用户流程卡死
    return { ok: true, msg: '' };
  }
}

/**
 * 图片安全检查 imgSecCheck
 * @param {string} fileID - 云存储 fileID
 * @returns {Promise<{ok: boolean, msg: string}>}
 */
async function checkImageSecurity(fileID) {
  if (!fileID) return { ok: true, msg: '' };
  if (!fileID.startsWith('cloud://')) return { ok: true, msg: '' };

  try {
    // 先下载图片获取 buffer
    const downloadRes = await cloud.downloadFile({ fileID });
    const buffer = downloadRes.fileContent;

    const res = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: 'image/jpeg',
        value: buffer
      }
    });
    if (res.errCode === 0) {
      return { ok: true, msg: '' };
    }
    return { ok: false, msg: '图片涉嫌违规' };
  } catch (err) {
    console.error('imgSecCheck 异常，降级放行:', err.errCode, err.errMsg);
    // 接口调用异常时降级放行，避免安全检查服务异常导致用户流程卡死
    return { ok: true, msg: '' };
  }
}

/**
 * 批量检查所有文本字段
 */
async function checkAllText(data) {
  const textFields = [
    { field: 'title', label: '标题', value: data.title },
    { field: 'description', label: '描述', value: data.description },
    { field: 'exchange_want', label: '期望交换物品', value: data.exchange_want },
    { field: 'available_time', label: '可服务时间', value: data.available_time },
    { field: 'tradeLocation', label: '交易地点', value: data.tradeLocation }
  ];

  for (const item of textFields) {
    if (item.value && item.value.trim()) {
      const result = await checkTextSecurity(item.value);
      if (!result.ok) {
        return { ok: false, msg: `${item.label}安全检查未通过: ${result.msg}` };
      }
    }
  }
  return { ok: true };
}

/**
 * 批量检查所有图片
 */
async function checkAllImages(images) {
  if (!images || images.length === 0) return { ok: true };

  for (let i = 0; i < images.length; i++) {
    const result = await checkImageSecurity(images[i]);
    if (!result.ok) {
      return { ok: false, msg: `第${i + 1}张图片安全检查未通过: ${result.msg}` };
    }
  }
  return { ok: true };
}

/**
 * 判断 openid 是否为管理员
 */
async function isAdminUser(openid) {
  try {
    const res = await db.collection('user').where({ _openid: openid, isAdmin: true }).count();
    return res.total > 0;
  } catch (err) {
    console.error('[commodity] 管理员校验异常:', err.message);
    return false;
  }
}

/**
 * 判断 openid 是否被封禁
 */
async function isUserBanned(openid) {
  try {
    const res = await db.collection('user').where({ _openid: openid, banned: true }).count();
    return res.total > 0;
  } catch (err) {
    return false;
  }
}

/**
 * 交易状态非 open（已预定/已完成）的信息沉底。
 * 用显式分组替代 Array.sort，避免依赖运行时排序稳定性。
 */
function sinkClosedItems(items) {
  const open = [];
  const closed = [];
  (items || []).forEach(item => {
    if (item && item.tradeStatus && item.tradeStatus !== 'open') {
      closed.push(item);
    } else {
      open.push(item);
    }
  });
  return open.concat(closed);
}

// 发布类型：闲置转让 / 求购 / 以物易物 / 技能服务
const VALID_TYPES = ['sell', 'want', 'exchange', 'skill'];
// 交易状态：可交易 / 已预定 / 已完成
const VALID_TRADE_STATUS = ['open', 'matched', 'completed'];
// 技能报价模式：按次 / 按小时 / 面议
const VALID_PRICE_UNITS = ['per_time', 'per_hour', 'negotiable'];
// 技能分类枚举：默认值兜底，优先读 config 集合（app 记录的 skill_categories）
// 这样增删技能分类只需改配置，不必改代码/重新发版；前端同样从配置读取。
const DEFAULT_SKILL_CATEGORIES = [
  '项目辅导',
  '科研教学',
  '学科竞赛',
  '论文写作',
  '编程开发',
  '设计剪辑',
  '乐器教学',
  '摄影修图',
  '运动陪练',
  '其他'
];
const SKILL_CATEGORY_CACHE_TTL = 10 * 60 * 1000; // 进程内缓存 10 分钟
let skillCategoryCache = { list: null, expireAt: 0 };

/** 取技能分类列表（config 优先，失败/为空回退默认值） */
async function getSkillCategories() {
  if (skillCategoryCache.list && skillCategoryCache.expireAt > Date.now()) {
    return skillCategoryCache.list;
  }
  let list = null;
  try {
    const res = await db.collection('config').where({ key: 'app' }).limit(1).get();
    const raw = res.data[0] && res.data[0].skill_categories;
    if (Array.isArray(raw)) {
      const cleaned = [];
      raw.forEach(item => {
        const name = typeof item === 'string' ? item.trim() : '';
        if (name && cleaned.indexOf(name) === -1) cleaned.push(name);
      });
      if (cleaned.length > 0) list = cleaned;
    }
  } catch (err) {
    console.warn('[commodity] 读取技能分类配置失败，使用默认列表:', err && err.message);
  }
  const finalList = list || DEFAULT_SKILL_CATEGORIES;
  skillCategoryCache = { list: finalList, expireAt: Date.now() + SKILL_CATEGORY_CACHE_TTL };
  return finalList;
}

// 求购分区：物品求购 / 技能求助（缺省按物品求购处理）
const VALID_WANT_CATEGORIES = ['goods', 'skill'];
const normalizeWantCategory = (value) => (VALID_WANT_CATEGORIES.indexOf(value) > -1 ? value : 'goods');
// 兼容 type 别名：wanted → want（对外文档里也写作 wanted）
const normalizeType = (value) => (value === 'wanted' ? 'want' : value);

/**
 * 按发布类型做服务端校验与字段归一化
 * - sell     ：必须有合法价格（> 0）
 * - want     ：不需要价格
 * - exchange ：必须有 exchange_want，accept_price_diff 可空
 * - skill    ：必须有合法报价模式；非面议时必须有金额
 * @returns {{ok: boolean, msg?: string, patch?: object}}
 */
function normalizeByType(source, typeValue) {
  const type = normalizeType(typeValue) || 'sell';
  if (VALID_TYPES.indexOf(type) === -1) {
    return { ok: false, msg: '发布类型不合法' };
  }

  const patch = { type };

  if (type === 'exchange') {
    const wantText = (source.exchange_want || '').toString().trim();
    if (!wantText) {
      return { ok: false, msg: '请填写期望交换的物品' };
    }
    const diff = Number(source.accept_price_diff);
    patch.exchange_want = wantText;
    patch.accept_price_diff = Number.isFinite(diff) && diff > 0 ? diff : null;
    patch.price = 0;
    patch.price_unit = '';
    patch.want_category = '';
  } else if (type === 'skill') {
    const unit = VALID_PRICE_UNITS.indexOf(source.price_unit) > -1 ? source.price_unit : '';
    if (!unit) {
      return { ok: false, msg: '请选择合法的报价模式' };
    }
    const price = Number(source.price);
    if (unit !== 'negotiable' && !(Number.isFinite(price) && price > 0)) {
      return { ok: false, msg: '请填写报价金额，或选择面议' };
    }
    patch.price_unit = unit;
    patch.price = unit === 'negotiable' ? 0 : price;
    patch.exchange_want = '';
    patch.accept_price_diff = null;
    patch.want_category = '';
  } else {
    patch.exchange_want = '';
    patch.accept_price_diff = null;
    patch.price_unit = '';
    if (type === 'sell') {
      const price = Number(source.price);
      if (!Number.isFinite(price) || price <= 0) {
        return { ok: false, msg: '请填写有效的价格' };
      }
      patch.price = price;
      patch.want_category = '';
    } else {
      patch.price = 0;
      // 求购分区：物品求购（goods）/ 技能求助（skill）；缺失按物品求购处理，兼容老客户端
      patch.want_category = normalizeWantCategory(source.want_category);
    }
  }

  return { ok: true, patch };
}

/**
 * 由用户文档计算达人展示字段（列表/详情共用）
 * @param {object} user 用户文档
 * @param {boolean} full 是否包含介绍/技能等详情字段
 */
function buildExpertFields(user, full) {
  const u = user || {};
  const count = u.rating_count || 0;
  const fields = {
    isExpert: u.expert_status === 'approved',
    expertRatingAvg: count > 0 ? Number(((u.rating_sum || 0) / count).toFixed(1)) : 0,
    expertRatingCount: count
  };
  if (full) {
    fields.expertSkills = u.expert_skills || [];
    fields.expertIntro = u.expert_intro || '';
    fields.expertCerts = u.expert_certs || [];
    fields.expertAvailableTime = u.expert_available_time || '';
    fields.expertPriceUnit = u.expert_price_unit || 'negotiable';
    fields.expertPrice = u.expert_price || null;
  }
  return fields;
}

// 列表卡片字段上限：只返回卡片必需字段（不返回描述全文与图片数组，避免大字段拖慢列表）
const MAX_PAGE_SIZE = 20;

function toCardShape(item) {
  const images = Array.isArray(item.images) ? item.images : [];
  return {
    _id: item._id,
    _openid: item._openid,
    type: item.type || 'sell',
    title: item.title || '',
    price: item.price || 0,
    price_unit: item.price_unit || '',
    condition: item.condition || '',
    exchange_want: item.exchange_want || '',
    accept_price_diff: item.accept_price_diff || null,
    available_time: item.available_time || '',
    skill_category: item.skill_category || '',
    // 求购分区（goods 物品求购 / skill 技能求助）：卡片角标与筛选使用
    want_category: item.want_category || '',
    categoryId: item.categoryId || '',
    categoryName: item.categoryName || '',
    tradeLocation: item.tradeLocation || '',
    major: item.major || [],
    // 气泡展示短标题：优先用发布时写入的值，老数据现场兜底计算
    display_keyword: item.display_keyword || buildDisplayKeyword({
      title: item.title,
      type: item.type || 'sell',
      categoryName: item.categoryName,
      skillName: ''
    }),
    status: item.status || 'onSale',
    tradeStatus: item.tradeStatus || 'open',
    rejectReason: item.rejectReason || '',
    quantity: item.quantity || 1,
    createTime: item.createTime,
    // 列表只用缩略图（没有 thumb 的老数据回退首图），不返回整个图片数组
    cover: item.thumb || images[0] || '',
    // 列表图对应的原始 fileID：客户端缓存/失败重试用（老数据为空则回退首图 fileID）
    coverId: item.thumbId || (Array.isArray(item.imageIds) && item.imageIds[0]) || '',
    // 详情页首图原始 fileID：预览时预热详情首图用
    fullCoverId: item.fullCoverId || (Array.isArray(item.imageIds) && item.imageIds[0]) || '',
    sellerName: item.sellerName || '',
    sellerAvatar: item.sellerAvatar || '',
    sellerWechat: item.sellerWechat || '',
    isStudentVerified: item.isStudentVerified || false,
    studentVerifyStatus: item.studentVerifyStatus || '',
    isExpert: !!item.isExpert,
    expertRatingAvg: item.expertRatingAvg || 0,
    expertRatingCount: item.expertRatingCount || 0
  };
}

/**
 * 维护模式：读 config 集合（不存在或读取失败时按未开启处理）
 */
async function isMaintenanceOn() {
  try {
    const res = await db.collection('config').where({ key: 'app' }).limit(1).get();
    return !!(res.data[0] && res.data[0].maintenance);
  } catch (err) {
    return false;
  }
}

/**
 * 发布频率限制：同一用户 1 分钟最多 1 条、1 天最多 10 条（服务端强制）
 */
async function checkPostRateLimit(openid) {
  try {
    const now = Date.now();
    const oneMinAgo = new Date(now - 60 * 1000);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const perMinute = await db.collection('commodity')
      .where({ _openid: openid, createTime: _.gte(oneMinAgo) })
      .count();
    if (perMinute.total >= 1) {
      return { ok: false, msg: '发布太频繁啦，请 1 分钟后再试' };
    }

    const perDay = await db.collection('commodity')
      .where({ _openid: openid, createTime: _.gte(dayStart) })
      .count();
    if (perDay.total >= 10) {
      return { ok: false, msg: '今日发布已达上限（10 条），请明天再来' };
    }

    return { ok: true };
  } catch (err) {
    console.error('[commodity] 发布频率校验异常，降级放行:', err.message);
    return { ok: true };
  }
}

/**
 * 联系方式查看/复制的轻量限流：同一用户每分钟最多 20 次
 * 依赖 rate_limit 集合；集合不存在时降级放行，不影响正常使用
 */
async function checkContactRate(openid) {
  try {
    const col = db.collection('rate_limit');
    const windowStart = new Date(Date.now() - 60 * 1000);
    const res = await col.where({ _openid: openid, key: 'contact', time: _.gte(windowStart) }).count();
    if (res.total >= 20) {
      return { ok: false, msg: '操作过于频繁，请稍后再试' };
    }
    await col.add({ data: { _openid: openid, key: 'contact', time: db.serverDate() } });
    return { ok: true };
  } catch (err) {
    console.warn('[commodity] rate_limit 不可用，降级放行:', err.message);
    return { ok: true };
  }
}

/**
 * 技能服务要求发布者已完成达人入驻
 */
async function checkExpertForSkill(openid, type) {
  if (type !== 'skill') return { ok: true, skills: [] };
  try {
    const res = await db.collection('user').where({ _openid: openid }).get();
    const user = res.data[0];
    if (user && user.expert_status === 'approved') {
      return { ok: true, skills: user.expert_skills || [] };
    }
    return { ok: false, skills: [], msg: '请先完成技能达人入驻后再发布技能服务' };
  } catch (err) {
    console.error('[commodity] 达人校验异常:', err.message);
    return { ok: false, skills: [], msg: '达人身份校验失败，请稍后重试' };
  }
}

exports.main = async (event, context) => {
  const { action, id, data, keyword, categoryId, page = 1, pageSize = 10, sellerId, includeDeleted, majors } = event;
  // 发布类型（兼容 wanted → want 别名）与求购分区（goods 物品求购 / skill 技能求助）
  const type = normalizeType(event.type);
  const wantCategory = event.wantCategory || '';
  const wxContext = cloud.getWXContext();

  const convertFileIDs = async (items) => {
    if (!items || items.length === 0) return items;
    const allFileIDs = collectFileIDs(items);
    if (allFileIDs.length === 0) return items;

    const urlMap = await fetchTempUrls(allFileIDs);
    items.forEach(it => {
      if (it.images && Array.isArray(it.images)) {
        it.images = it.images.map(img => (typeof img === 'string' && urlMap[img]) || img);
      }
      if (typeof it.thumb === 'string' && urlMap[it.thumb]) {
        it.thumb = urlMap[it.thumb];
      }
    });
    return items;
  };

  const convertSingleFileIDs = async (item) => {
    if (!item) return item;
    const list = await convertFileIDs([item]);
    return list[0];
  };

  if (action === 'list') {
    let where = {};
    if (sellerId) {
      where._openid = sellerId;
      if (!includeDeleted) {
        // 卖家可以看到自己所有非删除的商品（含待审核、已驳回）
        where.status = _.neq('deleted');
      }
    } else {
      // 公开列表只展示已上架（审核通过）的商品
      where.status = 'onSale';
    }
    if (categoryId) where.categoryId = categoryId;
    if (type) where.type = type;
    // 求购分区（仅对求购生效）：物品求购 / 技能求助
    // 注意：未迁移的老数据没有 want_category 字段，按「物品求购」查询时要一并命中
    if (type === 'want' && VALID_WANT_CATEGORIES.indexOf(wantCategory) > -1) {
      where.want_category = wantCategory === 'goods'
        ? _.or([_.eq('goods'), _.exists(false)])
        : wantCategory;
    }
    // 图书专区：按“适用专业”过滤（major 存数组，$in 命中任一元素即可）
    if (majors && majors.length) where.major = _.in(majors);

    const perPage = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(pageSize, 10) || 10));
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const totalRes = await db.collection('commodity').where(where).count();
    const listRes = await db.collection('commodity')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((currentPage - 1) * perPage)
      .limit(perPage)
      .get();

    const listData = listRes.data.map(item => ({
      ...item,
      images: item.images || [],
      // 保留原始 fileID：客户端可据此缓存临时链接、加载失败时按 id 重新解析
      imageIds: (item.images || []).slice(),
      // 缩略图原始 fileID（老数据没有 thumb 时为空，前端回退用首图）
      thumbId: item.thumb || '',
      // 首图原始 fileID：供预览链路预热"详情页首图"（详情用的是原图）
      fullCoverId: (item.images || [])[0] || '',
      status: item.status || 'onSale'
    }));

    const convertedData = await convertFileIDs(listData);

    const sellerOpenids = [...new Set(convertedData.map(item => item._openid).filter(Boolean))];
    if (sellerOpenids.length > 0) {
      const usersRes = await db.collection('user').where({
        _openid: _.in(sellerOpenids)
      }).get();
      const userMap = {};
      usersRes.data.forEach(u => {
        userMap[u._openid] = u;
      });
      convertedData.forEach(item => {
        const seller = userMap[item._openid];
        if (seller) {
          item.sellerName = seller.nickName || item.sellerName;
          item.sellerAvatar = seller.avatarUrl || item.sellerAvatar;
          // 列表只下发微信号用于展示/复制；手机号不下发（避免批量泄露），仅详情页按需下发做兜底
          item.sellerWechat = seller.wechat_id || '';
          item.isStudentVerified = seller.isStudentVerified || false;
          item.studentVerifyStatus = seller.studentVerifyStatus || '';
          // 技能达人角标与评分（精简字段，不带介绍/作品图）
          Object.assign(item, buildExpertFields(seller, false));
        }
      });
    }

    // 统一精简为卡片字段；公开列表把"已预定/已完成"沉底，发布者自己的列表保持时间序
    const cards = convertedData.map(toCardShape);
    return { code: 0, data: sellerId ? cards : sinkClosedItems(cards), total: totalRes.total };
  }

  if (action === 'detail') {
    const res = await db.collection('commodity').doc(id).get();
    if (!res.data) return { code: -1, msg: '商品不存在' };

    let data = res.data;
    // 原始 fileID 单独下发：客户端按 id 缓存临时链接，链接过期/加载失败时可精准重解析
    const rawImageIds = Array.isArray(data.images) ? data.images.slice() : [];
    data.images = data.images || [];
    data = await convertSingleFileIDs(data);
    data.imageIds = rawImageIds;

    const seller = await db.collection('user').where({ _openid: res.data._openid }).get();
    if (seller.data.length > 0) {
      data.sellerName = seller.data[0].nickName;
      data.sellerAvatar = seller.data[0].avatarUrl;
      // 详情页：微信号用于复制；手机号仅在卖家未填微信号时作兜底复制，页面不展示
      data.sellerWechat = seller.data[0].wechat_id || '';
      data.sellerPhone = seller.data[0].phone || '';
      data.sellerIsStudentVerified = seller.data[0].isStudentVerified || false;
      data.sellerStudentVerifyStatus = seller.data[0].studentVerifyStatus || '';
      // 技能达人信息（详情页需要完整字段：技能标签/介绍/作品图）
      Object.assign(data, buildExpertFields(seller.data[0], true));
      data.sellerOpenid = res.data._openid;
    }
    return { code: 0, data };
  }

  // ===== 客户端兜底：按 fileID 重新解析临时链接（链接过期 / 图片加载失败时调用） =====
  // 命中进程内缓存的不再请求 getTempFileURL，只有真正过期的才会重新签发。
  if (action === 'resolveImages') {
    const rawList = Array.isArray(event.fileIDs) ? event.fileIDs : [];
    const valid = rawList
      .filter(f => typeof f === 'string' && f.indexOf('cloud://') === 0)
      .slice(0, 50); // 单次上限，防止被滥用
    if (valid.length === 0) return { code: 0, data: {} };
    const urlMap = await fetchTempUrls(valid);
    return { code: 0, data: urlMap };
  }

  if (action === 'create') {
    const requestId = data.requestId;

    if (requestId) {
      const existRes = await db.collection('commodity').where({ requestId }).limit(1).get();
      if (existRes.data && existRes.data.length > 0) {
        return { code: 0, data: { _id: existRes.data[0]._id }, msg: '发布成功' };
      }
    }

    // 封禁用户不允许发布
    if (await isUserBanned(wxContext.OPENID)) {
      return { code: -1, msg: '账号已被封禁，无法发布信息' };
    }

    // 维护模式：写操作一律拒绝
    if (await isMaintenanceOn()) {
      return { code: -1, msg: '系统维护中，请稍后再试' };
    }

    // 发布频率限制（服务端强制）
    const rateCheck = await checkPostRateLimit(wxContext.OPENID);
    if (!rateCheck.ok) {
      return { code: -1, msg: rateCheck.msg };
    }

    // 技能服务：必须已完成技能达人入驻
    const expertCheck = await checkExpertForSkill(wxContext.OPENID, (data && data.type) || 'sell');
    if (!expertCheck.ok) {
      return { code: -1, msg: expertCheck.msg };
    }

    // ===== 内容安全检查（UGC 合规要求） =====
    console.log('[commodity] 开始内容安全检查, requestId:', requestId);

    // 1. 文本安全检查
    const textCheck = await checkAllText(data);
    if (!textCheck.ok) {
      console.warn('[commodity] 文本安全检查未通过:', textCheck.msg);
      return { code: -1, msg: textCheck.msg };
    }

    // 2. 图片安全检查
    const imageCheck = await checkAllImages(data.images);
    if (!imageCheck.ok) {
      console.warn('[commodity] 图片安全检查未通过:', imageCheck.msg);
      return { code: -1, msg: imageCheck.msg };
    }

    console.log('[commodity] 内容安全检查通过');

    // 按类型做服务端校验（exchange 必须有期望交换物品；sell 必须有合法价格）
    const normalized = normalizeByType(data, data.type);
    if (!normalized.ok) {
      return { code: -1, msg: normalized.msg };
    }

    // 技能分类必须在配置枚举内（仅技能服务）
    let skillCategory = '';
    if (normalized.patch.type === 'skill' && data.skill_category) {
      const categories = await getSkillCategories();
      skillCategory = categories.indexOf(data.skill_category) > -1 ? data.skill_category : '';
    }

    const newData = {
      ...data,
      ...normalized.patch,
      // 气泡展示短标题（skill 优先用达人技能名）
      display_keyword: buildDisplayKeyword({
        title: data.title,
        type: normalized.patch.type,
        categoryName: data.categoryName,
        skillName: (expertCheck.skills || [])[0] || ''
      }),
      // 技能服务：可服务时间 + 技能分类（不在枚举内则置空）
      available_time: normalized.patch.type === 'skill'
        ? (data.available_time || '').toString().trim().slice(0, 60)
        : '',
      skill_category: skillCategory,
      _openid: wxContext.OPENID,
      status: 'pendingReview', // 审核状态：待管理员审核，审核通过后才变为 onSale
      tradeStatus: 'open',     // 交易状态：可交易 / matched 已预定 / completed 已完成
      viewCount: 0,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    // 列表缩略图必须是云存储 fileID，非法值直接丢弃（回退用首图）
    if (newData.thumb && String(newData.thumb).indexOf('cloud://') !== 0) delete newData.thumb;
    const res = await db.collection('commodity').add({ data: newData });
    return { code: 0, data: { _id: res._id }, msg: '发布成功，等待管理员审核' };
  }

  if (action === 'update') {
    if (await isMaintenanceOn()) {
      return { code: -1, msg: '系统维护中，请稍后再试' };
    }
    // 封禁用户不允许编辑重发
    if (await isUserBanned(wxContext.OPENID)) {
      return { code: -1, msg: '账号已被封禁，无法操作' };
    }

    // 编辑后重新进入待审核状态
    // 提取可编辑字段，不直接信任前端传入的 status
    const updateData = { ...data };
    delete updateData._openid;
    // 缩略图要么是合法 fileID，要么不传（不传时保留原有 thumb，避免被清空）
    if (updateData.thumb && String(updateData.thumb).indexOf('cloud://') !== 0) delete updateData.thumb;
    delete updateData._id;

    // 编辑时重新进行内容安全检查
    if (updateData.title || updateData.description || updateData.exchange_want || updateData.tradeLocation) {
      const textCheck = await checkAllText(updateData);
      if (!textCheck.ok) {
        return { code: -1, msg: textCheck.msg };
      }
    }
    if (updateData.images && updateData.images.length > 0) {
      const imageCheck = await checkAllImages(updateData.images);
      if (!imageCheck.ok) {
        return { code: -1, msg: imageCheck.msg };
      }
    }

    // 按类型做服务端校验：类型可能未被提交，取库中现有值兜底
    let existed = null;
    try {
      const existedRes = await db.collection('commodity').doc(id).get();
      existed = existedRes.data || null;
    } catch (err) {
      return { code: -1, msg: '商品不存在' };
    }
    if (!existed) return { code: -1, msg: '商品不存在' };

    const mergedForValidate = {
      title: updateData.title !== undefined ? updateData.title : existed.title,
      categoryName: updateData.categoryName !== undefined ? updateData.categoryName : existed.categoryName,
      type: updateData.type !== undefined ? updateData.type : existed.type,
      price: updateData.price !== undefined ? updateData.price : existed.price,
      exchange_want: updateData.exchange_want !== undefined ? updateData.exchange_want : existed.exchange_want,
      accept_price_diff: updateData.accept_price_diff !== undefined ? updateData.accept_price_diff : existed.accept_price_diff,
      price_unit: updateData.price_unit !== undefined ? updateData.price_unit : existed.price_unit
    };

    // 技能服务：编辑时同样要求达人身份
    const expertCheck = await checkExpertForSkill(wxContext.OPENID, mergedForValidate.type);
    if (!expertCheck.ok) {
      return { code: -1, msg: expertCheck.msg };
    }

    const normalized = normalizeByType(mergedForValidate, mergedForValidate.type);
    if (!normalized.ok) {
      return { code: -1, msg: normalized.msg };
    }
    Object.assign(updateData, normalized.patch);

    // 标题/分类变化时同步刷新展示短标题
    updateData.display_keyword = buildDisplayKeyword({
      title: mergedForValidate.title !== undefined ? mergedForValidate.title : existed.title,
      type: normalized.patch.type,
      categoryName: mergedForValidate.categoryName !== undefined ? mergedForValidate.categoryName : existed.categoryName,
      skillName: (expertCheck.skills || [])[0] || ''
    });

    // 技能分类（仅技能服务；不在配置枚举内则置空）
    if (normalized.patch.type === 'skill') {
      const mergedSkillCategory = updateData.skill_category !== undefined
        ? updateData.skill_category
        : existed.skill_category;
      const categories = await getSkillCategories();
      updateData.skill_category = categories.indexOf(mergedSkillCategory) > -1 ? mergedSkillCategory : '';
    } else {
      updateData.skill_category = '';
    }

    if (normalized.patch.type === 'skill') {
      updateData.available_time = (mergedForValidate.available_time !== undefined
        ? mergedForValidate.available_time
        : (updateData.available_time !== undefined ? updateData.available_time : existed.available_time) || ''
      ).toString().trim().slice(0, 60);
    } else {
      updateData.available_time = '';
    }

    // 交易状态只能通过 setTradeStatus 修改，不接受前端直传
    delete updateData.tradeStatus;

    updateData.status = 'pendingReview'; // 编辑后重新审核
    updateData.updateTime = db.serverDate();
    await db.collection('commodity').doc(id).update({ data: updateData });
    return { code: 0, msg: '修改成功，等待管理员审核' };
  }

  // ===== 发布者标记交易状态：可交易 / 已预定 / 已完成 =====
  if (action === 'setTradeStatus') {
    if (await isMaintenanceOn()) {
      return { code: -1, msg: '系统维护中，请稍后再试' };
    }
    if (!id) return { code: -1, msg: '缺少商品ID' };

    const tradeStatus = event.tradeStatus;
    if (VALID_TRADE_STATUS.indexOf(tradeStatus) === -1) {
      return { code: -1, msg: '交易状态不合法' };
    }

    let doc = null;
    try {
      const docRes = await db.collection('commodity').doc(id).get();
      doc = docRes.data || null;
    } catch (err) {
      return { code: -1, msg: '商品不存在' };
    }
    if (!doc) return { code: -1, msg: '商品不存在' };
    if (doc._openid !== wxContext.OPENID) {
      return { code: -1, msg: '只能操作自己发布的信息' };
    }

    await db.collection('commodity').doc(id).update({
      data: { tradeStatus, tradeUpdateTime: db.serverDate(), updateTime: db.serverDate() }
    });

    const msgMap = { open: '已恢复为可交易', matched: '已标记为已预定', completed: '已标记为已完成' };
    return { code: 0, msg: msgMap[tradeStatus] };
  }

  // ===== 联系方式复制限流（轻量防刷） =====
  if (action === 'checkContactAccess') {
    const rate = await checkContactRate(wxContext.OPENID);
    if (!rate.ok) return { code: -1, msg: rate.msg };
    return { code: 0, msg: 'ok' };
  }

  // ===== 管理员审核：通过 =====
  if (action === 'approve') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    if (!id) return { code: -1, msg: '缺少商品ID' };
    try {
      await db.collection('commodity').doc(id).update({
        data: {
          status: 'onSale',
          rejectReason: '',
          reviewTime: db.serverDate(),
          reviewer: cloud.getWXContext().OPENID,
          updateTime: db.serverDate()
        }
      });
      console.log('[commodity] 商品审核通过:', id);
      return { code: 0, msg: '审核通过，商品已上架' };
    } catch (err) {
      console.error('[commodity] 审核通过失败:', err.message);
      return { code: -1, msg: '审核操作失败' };
    }
  }

  // ===== 管理员审核：驳回 =====
  if (action === 'reject') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    if (!id) return { code: -1, msg: '缺少商品ID' };
    const reason = event.reason || '内容不合规';
    try {
      await db.collection('commodity').doc(id).update({
        data: {
          status: 'rejected',
          rejectReason: reason,
          reviewTime: db.serverDate(),
          reviewer: cloud.getWXContext().OPENID,
          updateTime: db.serverDate()
        }
      });
      console.log('[commodity] 商品审核驳回:', id, '原因:', reason);
      return { code: 0, msg: '已驳回' };
    } catch (err) {
      console.error('[commodity] 审核驳回失败:', err.message);
      return { code: -1, msg: '审核操作失败' };
    }
  }

  // ===== 管理员获取待审核商品列表 =====
  if (action === 'pendingList') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    const adminPage = page || 1;
    const adminPageSize = pageSize || 20;
    try {
      const totalRes = await db.collection('commodity')
        .where({ status: 'pendingReview' })
        .count();
      const listRes = await db.collection('commodity')
        .where({ status: 'pendingReview' })
        .orderBy('createTime', 'desc')
        .skip((adminPage - 1) * adminPageSize)
        .limit(adminPageSize)
        .get();
      const convertedData = await convertFileIDs(listRes.data);
      return { code: 0, data: convertedData, total: totalRes.total };
    } catch (err) {
      console.error('[commodity] 获取待审核列表失败:', err.message);
      return { code: -1, msg: '获取待审核列表失败' };
    }
  }

  if (action === 'delete') {
    await db.collection('commodity').doc(id).update({
      data: { status: 'deleted', updateTime: db.serverDate() }
    });
    return { code: 0, msg: '删除成功' };
  }

  if (action === 'restore') {
    await db.collection('commodity').doc(id).update({
      data: { status: 'pendingReview', rejectReason: '', updateTime: db.serverDate() }
    });
    return { code: 0, msg: '已恢复，等待管理员审核后重新上架' };
  }

  if (action === 'search') {
    // 支持按“标题”或“适用专业”关键词命中图书（major 为数组，正则会对数组元素逐一匹配）
    const kw = (keyword || '').trim();
    if (!kw) return { code: 0, data: [] };

    const re = db.RegExp({ regexp: kw, options: 'i' });
    const base = { status: 'onSale' };
    if (categoryId) base.categoryId = categoryId;

    // 用 _.or 组合两个分支，公共条件放进每个分支，避免依赖顶层 and
    const where = _.or([
      Object.assign({}, base, { title: re }),
      Object.assign({}, base, { major: re })
    ]);

    // 搜索结果同样限制单页上限，避免全量拉取
    const res = await db.collection('commodity')
      .where(where)
      .orderBy('createTime', 'desc')
      .limit(MAX_PAGE_SIZE)
      .get();
    const listData = res.data.map(item => ({
      ...item,
      images: item.images || []
    }));
    const convertedData = await convertFileIDs(listData);

    const sellerOpenids = [...new Set(convertedData.map(i => i._openid).filter(Boolean))];
    if (sellerOpenids.length > 0) {
      const usersRes = await db.collection('user').where({ _openid: _.in(sellerOpenids) }).get();
      const userMap = {};
      usersRes.data.forEach(u => { userMap[u._openid] = u; });
      convertedData.forEach(item => {
        const seller = userMap[item._openid];
        if (seller) {
          item.sellerName = seller.nickName || item.sellerName;
          item.sellerAvatar = seller.avatarUrl || item.sellerAvatar;
          item.sellerWechat = seller.wechat_id || '';
          item.isStudentVerified = seller.isStudentVerified || false;
          Object.assign(item, buildExpertFields(seller, false));
        }
      });
    }

    return { code: 0, data: sinkClosedItems(convertedData.map(toCardShape)) };
  }

  // ===== 管理员数据管理：查询全部商品（需管理员身份） =====
  if (action === 'adminList') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    const adminStatus = event.status || '';    // '' 全部 | 具体状态
    const adminType = event.type || '';        // '' 全部 | 'sell' | 'want'
    const adminKeyword = (event.keyword || '').trim();
    const adminPage = Math.max(1, parseInt(page, 10) || 1);
    const adminPageSize = Math.min(50, parseInt(pageSize, 10) || 20);

    const where = {};
    if (adminStatus) where.status = adminStatus;
    if (adminType) where.type = adminType;
    if (adminKeyword) {
      where.title = db.RegExp({ regexp: adminKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' });
    }

    const totalRes = await db.collection('commodity').where(where).count();
    const listRes = await db.collection('commodity')
      .where(where)
      .orderBy('createTime', 'desc')
      .skip((adminPage - 1) * adminPageSize)
      .limit(adminPageSize)
      .get();
    const data = await convertFileIDs(listRes.data.map(item => ({ ...item, images: item.images || [] })));
    return { code: 0, data, total: totalRes.total };
  }

  // ===== 管理员数据管理：直接变更商品状态（上架/下架/转待审/删除等） =====
  if (action === 'adminSetStatus') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    if (!id) return { code: -1, msg: '缺少商品ID' };
    const allowed = ['pendingReview', 'onSale', 'rejected', 'deleted'];
    const targetStatus = event.status;
    if (!allowed.includes(targetStatus)) return { code: -1, msg: '状态值不合法' };

    const update = { status: targetStatus, updateTime: db.serverDate() };
    if (targetStatus === 'onSale') {
      update.rejectReason = '';
      update.reviewTime = db.serverDate();
      update.reviewer = wxContext.OPENID;
    }
    if (targetStatus === 'rejected') {
      update.rejectReason = (event.reason || '').toString().trim();
    }
    if (targetStatus === 'deleted') {
      update.rejectReason = '';
    }
    await db.collection('commodity').doc(id).update({ data: update });
    return { code: 0, msg: '状态已更新' };
  }

  // ===== 管理员数据管理：永久删除商品（文档 + 云存储图片） =====
  if (action === 'adminDelete') {
    if (!(await isAdminUser(wxContext.OPENID))) return { code: -1, msg: '无管理员权限' };
    if (!id) return { code: -1, msg: '缺少商品ID' };
    let existRes = null;
    try {
      existRes = await db.collection('commodity').doc(id).get();
    } catch (err) {
      return { code: -1, msg: '商品不存在' };
    }
    const images = ((existRes.data && existRes.data.images) || [])
      .filter(img => img && img.indexOf('cloud://') === 0);
    await db.collection('commodity').doc(id).remove();
    if (images.length) {
      try { await cloud.deleteFile({ fileList: images.slice(0, 50) }); } catch (err) {
        console.error('[commodity] 删除商品图片失败:', err.message);
      }
    }
    return { code: 0, msg: '商品已永久删除' };
  }

  return { code: -1, msg: '未知操作' };
};