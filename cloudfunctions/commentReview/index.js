// cloudfunctions/commentReview/index.js —— 公益图书角 · 留言审核（管理端专用）
//
// 权限模型（本文件唯一收口，客户端无法绕过）：
//   平台管理员：user.isAdmin === true（本项目既有做法，admin 云函数用密码绑定）
//               或 user.role === 'admin'（兼容 Kimi 指令写法）
//   空间管理员：user.role === 'space_manager' 且 user._id 在该 space 的 managers 数组内
//   其余一律「无权限」——普通用户即使知道 action 名也调不通。
//
// 所有写操作（通过 / 驳回 / 加精 / 取消加精）成功后都追加 op_log，记录操作时的角色快照。
//
// action 一览：
//   getPending  { spaceId, page?, pageSize? }                 → { list, total, pendingCount }
//   getApproved { spaceId, status, page?, pageSize? }         → { list, total }
//   review      { commentId, action }                         → { status, starred }
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

const MAX_PAGE_SIZE = 20;
const CONTENT_PREVIEW_LEN = 60;
const REVIEW_ACTIONS = ['approve', 'reject', 'star', 'unstar'];

function normalizePage(event) {
  const page = Math.max(1, parseInt(event.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(event.pageSize, 10) || 20));
  return { page, pageSize };
}

function trimTo(value, max) {
  return (value === null || value === undefined ? '' : String(value)).trim().slice(0, max);
}

async function findUserByOpenid(openid) {
  const res = await db.collection('user').where({ _openid: openid }).limit(1).get();
  return res.data[0] || null;
}

async function getSpace(spaceId) {
  const res = await db.collection('space').where({ _id: spaceId }).limit(1).get();
  return res.data[0] || null;
}

/**
 * 解析调用者权限。
 * 返回 { ok, role, user, space }；ok=false 时调用方直接回「无权限」。
 */
async function resolvePermission(user, spaceId) {
  if (!user) return { ok: false, role: null };

  // 平台管理员：不限定空间
  if (user.isAdmin === true || user.role === 'admin') {
    const space = spaceId ? await getSpace(spaceId) : null;
    if (spaceId && !space) return { ok: false, role: 'platform_admin' };
    return { ok: true, role: 'platform_admin', space };
  }

  if (!spaceId) return { ok: false, role: null };
  const space = await getSpace(spaceId);
  if (!space) return { ok: false, role: null };

  // 空间管理员：role + managers 名单双条件，缺一不可
  const managers = Array.isArray(space.managers) ? space.managers : [];
  if (user.role === 'space_manager' && managers.indexOf(user._id) > -1) {
    return { ok: true, role: 'space_manager', space };
  }

  return { ok: false, role: null };
}

/** 审核通过 / 驳回 / 加精：写 op_log（只增不改，唯一不做软删除的集合） */
async function writeOpLog(spaceId, operatorId, operatorRole, action, targetId, detail) {
  try {
    await db.collection('op_log').add({
      data: {
        spaceId,
        operatorId,
        operatorRole,
        action,
        targetId,
        detail: detail || {},
        createdAt: db.serverDate()
      }
    });
  } catch (err) {
    // 日志失败不阻塞业务（业务已成功），但必须留痕便于排查
    console.error('[commentReview] op_log 写入失败:', action, targetId, err);
  }
}

/** 批量补书名 / 封面（留言文档只存 bookId，列表展示需要书名） */
async function attachBooks(list) {
  const bookIds = [];
  list.forEach(item => {
    if (item.bookId && bookIds.indexOf(item.bookId) === -1) bookIds.push(item.bookId);
  });
  if (bookIds.length === 0) return list;

  const res = await db.collection('book')
    .where({ _id: _.in(bookIds) })
    .field({ _id: true, title: true, cover: true, zone: true })
    .limit(MAX_PAGE_SIZE)
    .get();

  const map = {};
  res.data.forEach(book => { map[book._id] = book; });
  return list.map(item => {
    const book = map[item.bookId] || {};
    return Object.assign({}, item, {
      bookTitle: book.title || '（书本已下架）',
      bookCover: book.cover || '',
      bookZone: book.zone || ''
    });
  });
}

/** 待审列表 + 待审总数（总数给管理端做角标） */
async function getPending(event, user, space) {
  const { page, pageSize } = normalizePage(event);
  const where = { spaceId: space._id, status: 'pending' };

  const totalRes = await db.collection('book_comment').where(where).count();
  const listRes = await db.collection('book_comment')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  const list = await attachBooks(listRes.data);
  return {
    code: 0,
    data: list,
    total: totalRes.total,
    pendingCount: totalRes.total,
    page,
    pageSize,
    noMore: (page - 1) * pageSize + list.length >= totalRes.total
  };
}

/** 已处理列表（已通过 / 已拒绝），时间倒序 */
async function getApproved(event, user, space) {
  const status = trimTo(event.status, 20) || 'approved';
  if (status !== 'approved' && status !== 'rejected') {
    return { code: -1, msg: '状态参数错误' };
  }

  const { page, pageSize } = normalizePage(event);
  const where = { spaceId: space._id, status };

  const totalRes = await db.collection('book_comment').where(where).count();
  const listRes = await db.collection('book_comment')
    .where(where)
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  const list = await attachBooks(listRes.data);
  return {
    code: 0,
    data: list,
    total: totalRes.total,
    page,
    pageSize,
    noMore: (page - 1) * pageSize + list.length >= totalRes.total
  };
}

/**
 * 审核动作：approve / reject / star / unstar
 * 注意：指令里的入参写成 { commentId, action }，但云函数的 action 字段本身是路由键，
 *      因此这里既支持 { action: 'approve', commentId }（指令原文写法，直接路由到本函数），
 *      也支持 { action: 'review', op: 'approve', commentId }（保留显式 review 入口）。
 */
async function review(event, act, user) {
  const commentId = trimTo(event.commentId, 64);
  if (!commentId) return { code: -1, msg: '缺少留言标识' };
  if (['approve', 'reject', 'star', 'unstar'].indexOf(act) === -1) {
    return { code: -1, msg: '未知的审核动作' };
  }

  const commentRes = await db.collection('book_comment').where({ _id: commentId }).limit(1).get();
  const comment = commentRes.data[0];
  if (!comment) return { code: -1, msg: '留言不存在' };

  // 二次校验：必须对该留言所属空间有权限（防止越权改他人空间的数据）
  const perm = await resolvePermission(user, comment.spaceId);
  if (!perm.ok) return { code: -1, msg: '无权限' };

  const patch = {};
  let logAction = '';
  if (act === 'approve') {
    patch.status = 'approved';
    logAction = 'comment_approve';
  } else if (act === 'reject') {
    patch.status = 'rejected';
    logAction = 'comment_reject';
  } else {
    patch.starred = act === 'star';
    logAction = 'comment_star';
  }

  await db.collection('book_comment').doc(commentId).update({ data: patch });
  await writeOpLog(comment.spaceId, user._id, perm.role, logAction, commentId, {
    from: comment.status,
    starred: patch.starred === undefined ? !!comment.starred : patch.starred
  });

  const messages = {
    approve: '已通过',
    reject: '已拒绝',
    star: '已加精',
    unstar: '已取消加精'
  };
  return {
    code: 0,
    data: {
      status: patch.status === undefined ? comment.status : patch.status,
      starred: patch.starred === undefined ? !!comment.starred : patch.starred
    },
    msg: messages[act]
  };
}

exports.main = async (event) => {
  const { action } = event || {};
  const openid = cloud.getWXContext().OPENID;
  if (!openid) return { code: -1, msg: '请先登录' };

  try {
    const user = await findUserByOpenid(openid);
    if (!user) return { code: -1, msg: '请先登录' };

    if (action === 'getPending' || action === 'getApproved') {
      const spaceId = trimTo(event.spaceId, 64);
      if (!spaceId) return { code: -1, msg: '缺少空间标识' };
      const perm = await resolvePermission(user, spaceId);
      if (!perm.ok) return { code: -1, msg: '无权限' };
      return action === 'getPending'
        ? await getPending(event, user, perm.space)
        : await getApproved(event, user, perm.space);
    }

    // 审核动作：兼容指令原文写法 { action: 'approve' | 'reject' | 'star' | 'unstar', commentId }
    if (REVIEW_ACTIONS.indexOf(action) > -1) return await review(event, action, user);
    // 显式入口：{ action: 'review', op: 'approve', commentId }
    if (action === 'review') return await review(event, trimTo(event.op || event.reviewAction, 20), user);

    return { code: -1, msg: '未知操作' };
  } catch (err) {
    console.error('[commentReview] ' + action + ' 执行失败:', err);
    return { code: -1, msg: '操作失败，请稍后重试' };
  }
};
