// cloudfunctions/bookcorner/index.js —— 公益图书角 · 用户侧接口
//
// 设计要点（对齐 docs/bookcorner-schema.md）：
//   1. 5 个图书角集合权限均为「仅管理端可读写」，客户端只能走本云函数；
//   2. 用户身份一律用 cloud.getWXContext().OPENID 反查 user 集合，绝不信任客户端传值；
//   3. 留言命中敏感词 → status=pending（进审核队列）；干净 → status=approved；
//      客户端永远只能拿到 approved 的留言；
//   4. 留言昵称、时间、spaceId 一律服务端补全，客户端只提交 bookId + content。
//
// action 一览：
//   getSpace       { spaceId }                              → { space }        ← 为「主页展示空间名称/头图」新增
//   getBooks       { spaceId, zone?, category?, page?, pageSize? } → { list, total, categories }
//   getBookDetail  { bookId }                               → { book, commentTotal }
//   getComments    { bookId, page?, pageSize? }             → { list, total }   ← 为「留言长帖分页」新增（指令 6 要求）
//   addComment     { bookId, content }                      → { status }
//   addExchange    { spaceId, bookTitle, giveTitle }        → { id }
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

const MAX_PAGE_SIZE = 20;
const COMMENT_MAX_LEN = 200;
const TITLE_MAX_LEN = 50;
const EXCHANGE_DEDUP_MS = 10 * 60 * 1000; // 换书登记幂等窗口：10 分钟

// 敏感词兜底表：与 cloudfunctions/config/index.js 的 DEFAULT_SENSITIVE_WORDS 保持一致。
// 运行时优先读 config 集合的 sensitiveWords（控制台可改，无需重新部署）；改动请两处同步。
const DEFAULT_SENSITIVE_WORDS = [
  // 广告引流
  '加微信', '扫码加', '私聊我', '代购', '刷单',
  // 违规服务
  '代写', '代考', '办证', '论文代写',
  // 违规商品
  '盗版', '影印版', '复印版',
  // 诈骗交易
  '保证金', '先付款', '私下转账'
];

// ===================== 通用工具 =====================

/** 分页参数归一化（上限 20，与 commodity / adminBatch 同款） */
function normalizePage(event) {
  const page = Math.max(1, parseInt(event.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(event.pageSize, 10) || 10));
  return { page, pageSize };
}

/** 字符串安全截断：去首尾空白 + 截断到 max 字 */
function trimTo(value, max) {
  return (value === null || value === undefined ? '' : String(value)).trim().slice(0, max);
}

/** 读 config 集合 app 记录（直连读，不跨云函数调用；失败返回 null） */
async function readAppConfig() {
  try {
    const res = await db.collection('config').where({ key: 'app' }).limit(1).get();
    return res.data[0] || null;
  } catch (err) {
    console.error('[bookcorner] 读取 config 失败:', err);
    return null;
  }
}

/** 维护模式：读不到 config 时按未开启处理（照 user 云函数的写法） */
async function isMaintenanceOn() {
  const cfg = await readAppConfig();
  return !!(cfg && cfg.maintenance);
}

/** 敏感词表：config 未配 / 配置非法时用内置兜底表 */
function normalizeSensitiveWords(raw) {
  if (!Array.isArray(raw)) return DEFAULT_SENSITIVE_WORDS;
  const list = [];
  raw.forEach(item => {
    const word = typeof item === 'string' ? item.trim() : '';
    if (word && list.indexOf(word) === -1) list.push(word);
  });
  return list.length > 0 ? list : DEFAULT_SENSITIVE_WORDS;
}

/**
 * 匹配前的文本归一化：小写 + 去掉空白与常见分隔符。
 * 目的：拦住「加 微信」「加-微信」「加·微信」这类绕过写法，同时避免误伤正常语句。
 */
function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\u3000\-_·.、,，。!！?？*~#@+]/g, '');
}

/** 本地词表匹配：命中返回命中的词，未命中返回 null */
function matchSensitiveWord(text, words) {
  const target = normalizeForMatch(text);
  if (!target) return null;
  for (let i = 0; i < words.length; i++) {
    const word = normalizeForMatch(words[i]);
    if (word && target.indexOf(word) > -1) return words[i];
  }
  return null;
}

/**
 * 内容安全（微信官方接口）：接口异常时降级放行并记日志，
 * 避免安全服务抖动导致用户流程卡死（与 user / review 云函数一致）。
 */
async function checkTextSecurity(text, label) {
  if (!text || !text.trim()) return { ok: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: text });
    if (res.errCode === 0) return { ok: true };
    return { ok: false, msg: `${label || '内容'}包含违规信息，请修改后重试` };
  } catch (err) {
    console.error('[bookcorner] msgSecCheck 调用异常，降级放行:', err.errCode, err.errMsg);
    return { ok: true };
  }
}

/** 按 openid 反查用户文档（客户端传来的 openid 一律不用） */
async function findUserByOpenid(openid) {
  const res = await db.collection('user').where({ _openid: openid }).limit(1).get();
  return res.data[0] || null;
}

/** 昵称快照：只从服务端用户文档取，取不到用占位名 */
function pickNickname(user) {
  return (user && (user.nickName || user.nickname)) || '匿名同学';
}

// ===================== action 实现 =====================

/** 某空间下的上架书目（只回 _id/title/category/intro，避免把整本文档丢给客户端） */
async function getBooks(event) {
  const spaceId = trimTo(event.spaceId, 64);
  if (!spaceId) return { code: -1, msg: '缺少空间标识' };

  // 分区：A / B（数据层定义：A=教材流转可外带，B=馆内阅览不外带）
  const zone = trimTo(event.zone, 2).toUpperCase();
  const category = trimTo(event.category, 30);
  const { page, pageSize } = normalizePage(event);

  const where = { spaceId, status: 'on' };
  if (zone) where.zone = zone;
  if (category) where.category = category;

  const totalRes = await db.collection('book').where(where).count();
  const listRes = await db.collection('book')
    .where(where)
    .orderBy('sort', 'asc')
    .orderBy('createdAt', 'asc')
    .field({ _id: true, title: true, category: true, intro: true })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  // 分类筛选项：只取该空间全部上架书的分类，去重后按首次出现顺序返回
  const allRes = await db.collection('book')
    .where(zone ? { spaceId, status: 'on', zone } : { spaceId, status: 'on' })
    .field({ category: true })
    .limit(MAX_PAGE_SIZE * 10)
    .get();
  const categories = [];
  allRes.data.forEach(item => {
    const c = trimTo(item.category, 30);
    if (c && categories.indexOf(c) === -1) categories.push(c);
  });

  return {
    code: 0,
    data: listRes.data,
    total: totalRes.total,
    categories,
    page,
    pageSize,
    noMore: (page - 1) * pageSize + listRes.data.length >= totalRes.total
  };
}

/** 空间信息（主页头部用）：只回展示所需字段，不下发 managers 等管理信息 */
async function getSpace(event) {
  const spaceId = trimTo(event.spaceId, 64);
  if (!spaceId) return { code: -1, msg: '缺少空间标识' };

  const res = await db.collection('space').where({ _id: spaceId }).limit(1).get();
  const space = res.data[0];
  if (!space) return { code: -1, msg: '空间不存在' };
  if (space.status && space.status !== 'active') return { code: -1, msg: '空间暂未开放' };

  return {
    code: 0,
    data: {
      _id: space._id,
      name: space.name || '',
      type: space.type || 'welfare',
      logo: space.logo || '',
      modules: space.modules || []
    }
  };
}

/** 单本书详情 + 已通过留言数（不含任何 pending / rejected 留言） */
async function getBookDetail(event) {
  const bookId = trimTo(event.bookId, 64);
  if (!bookId) return { code: -1, msg: '缺少图书标识' };

  const bookRes = await db.collection('book').where({ _id: bookId }).limit(1).get();
  const book = bookRes.data[0];
  if (!book) return { code: -1, msg: '这本书不在书架上了' };

  const commentRes = await db.collection('book_comment')
    .where({ bookId, status: 'approved' })
    .count();

  return { code: 0, data: { book, commentTotal: commentRes.total } };
}

/**
 * 留言长帖（只回 approved）：加精置顶，其余按时间正序（老的在前，体现「接力」感）。
 * 新增 action 的原因：指令 6 要求留言分页 20 条，而原指令的 getBookDetail 只返回条数。
 */
async function getComments(event) {
  const bookId = trimTo(event.bookId, 64);
  if (!bookId) return { code: -1, msg: '缺少图书标识' };

  const { page, pageSize } = normalizePage(event);
  const where = { bookId, status: 'approved' };
  const fields = { _id: true, nickname: true, content: true, starred: true, createdAt: true };

  const totalRes = await db.collection('book_comment').where(where).count();
  let listRes;
  try {
    // 加精置顶：复合排序需要 book_comment 上有 bookId+status+starred+createdAt 索引
    listRes = await db.collection('book_comment')
      .where(where)
      .orderBy('starred', 'desc')
      .orderBy('createdAt', 'asc')
      .field(fields)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();
  } catch (err) {
    // 索引缺失时不阻塞功能：降级为纯时间排序，前端仍能按 starred 渲染「精选」小标
    console.error('[bookcorner] 复合排序失败，降级为按时间排序:', err);
    listRes = await db.collection('book_comment')
      .where(where)
      .orderBy('createdAt', 'asc')
      .field(fields)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();
    const starred = listRes.data.filter(item => item.starred);
    const rest = listRes.data.filter(item => !item.starred);
    listRes = { data: starred.concat(rest) };
  }

  return {
    code: 0,
    data: listRes.data,
    total: totalRes.total,
    page,
    pageSize,
    noMore: (page - 1) * pageSize + listRes.data.length >= totalRes.total
  };
}

/** 提交留言：服务端截断 + 官方内容安全 + 本地词表 → approved / pending */
async function addComment(event, openid) {
  const bookId = trimTo(event.bookId, 64);
  if (!bookId) return { code: -1, msg: '缺少图书标识' };

  // 服务端截断：不信任客户端传来的长度
  const content = trimTo(event.content, COMMENT_MAX_LEN);
  if (!content) return { code: -1, msg: '留言内容不能为空' };

  if (await isMaintenanceOn()) return { code: -1, msg: '系统维护中，请稍后再试' };

  const sec = await checkTextSecurity(content, '留言');
  if (!sec.ok) return { code: -1, msg: sec.msg };

  const bookRes = await db.collection('book').where({ _id: bookId }).limit(1).get();
  const book = bookRes.data[0];
  if (!book) return { code: -1, msg: '这本书不在书架上了' };

  const user = await findUserByOpenid(openid);
  if (!user) return { code: -1, msg: '请先登录后再留言' };

  // 本地敏感词表：命中进审核队列，不告诉用户「命中敏感词」（防试探）
  const cfg = await readAppConfig();
  const words = normalizeSensitiveWords(cfg && cfg.sensitiveWords);
  const hit = matchSensitiveWord(content, words);
  const status = hit ? 'pending' : 'approved';
  if (hit) console.log('[bookcorner] 留言命中敏感词，转待审:', hit);

  await db.collection('book_comment').add({
    data: {
      bookId,
      spaceId: book.spaceId,          // 冗余外键：空间维度审核列表免 join
      userId: user._id,               // 存 user._id，不存 openid
      nickname: pickNickname(user),   // 昵称快照，客户端传值不采信
      content,
      status,
      starred: false,
      createdAt: db.serverDate()      // 服务端时间
    }
  });

  return {
    code: 0,
    data: { status },
    msg: '留言已提交，将在审核后展示'
  };
}

/** 换书登记（B区「拿一留一」）：10 分钟内同人同书幂等 */
async function addExchange(event, openid) {
  const spaceId = trimTo(event.spaceId, 64);
  const bookTitle = trimTo(event.bookTitle, TITLE_MAX_LEN);
  const giveTitle = trimTo(event.giveTitle, TITLE_MAX_LEN);
  if (!spaceId) return { code: -1, msg: '缺少空间标识' };
  if (!bookTitle) return { code: -1, msg: '请填写要带走的书名' };
  if (!giveTitle) return { code: -1, msg: '请填写要留下的书名' };

  if (await isMaintenanceOn()) return { code: -1, msg: '系统维护中，请稍后再试' };

  const user = await findUserByOpenid(openid);
  if (!user) return { code: -1, msg: '请先登录后再登记' };

  // 幂等：同一用户 10 分钟内提交相同「带走的书名」只算一次，避免连点/重复提交刷流水
  const since = new Date(Date.now() - EXCHANGE_DEDUP_MS);
  const dupRes = await db.collection('exchange_log')
    .where({ userId: user._id, bookTitle, createdAt: _.gt(since) })
    .limit(1)
    .get();
  if (dupRes.data.length > 0) {
    return { code: 0, data: { id: dupRes.data[0]._id, duplicated: true }, msg: '登记成功，让文字继续旅行' };
  }

  const addRes = await db.collection('exchange_log').add({
    data: {
      spaceId,
      bookTitle,
      giveTitle,
      nickname: pickNickname(user),
      userId: user._id,
      createdAt: db.serverDate()
    }
  });

  return { code: 0, data: { id: addRes._id, duplicated: false }, msg: '登记成功，让文字继续旅行' };
}

// ===================== 入口 =====================

exports.main = async (event) => {
  const { action } = event || {};
  const openid = cloud.getWXContext().OPENID;

  try {
    // 只读接口：允许未登录浏览（图书角是公益展示区，先看后登录）
    if (action === 'getSpace') return await getSpace(event);
    if (action === 'getBooks') return await getBooks(event);
    if (action === 'getBookDetail') return await getBookDetail(event);
    if (action === 'getComments') return await getComments(event);

    // 写接口：必须登录
    if (action === 'addComment' || action === 'addExchange') {
      if (!openid) return { code: -1, msg: '请先登录' };
      if (action === 'addComment') return await addComment(event, openid);
      return await addExchange(event, openid);
    }

    return { code: -1, msg: '未知操作' };
  } catch (err) {
    console.error('[bookcorner] ' + action + ' 执行失败:', err);
    return { code: -1, msg: '操作失败，请稍后重试' };
  }
};
