// cloudfunctions/review/index.js —— 技能服务评价
// 说明：评分聚合维护在被评用户的 rating_sum / rating_count 上，
//       列表与卡片直接读取，避免在列表接口里做聚合查询。
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

const MAX_PAGE_SIZE = 20;

async function checkTextSecurity(text, label) {
  if (!text || !text.trim()) return { ok: true };
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: text });
    if (res.errCode === 0) return { ok: true };
    return { ok: false, msg: `${label || '内容'}包含违规信息` };
  } catch (err) {
    console.error('[review] msgSecCheck 异常，降级放行:', err.errCode, err.errMsg);
    return { ok: true };
  }
}

function normalizePage(event) {
  const page = Math.max(1, parseInt(event.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(event.pageSize, 10) || 10));
  return { page, pageSize };
}

exports.main = async (event) => {
  const { action } = event;
  const openid = cloud.getWXContext().OPENID;

  if (!openid) return { code: -1, msg: '请先登录' };

  // 维护模式：评价属于写操作
  if (action === 'create') {
    try {
      const cfgRes = await db.collection('config').where({ key: 'app' }).limit(1).get();
      if (cfgRes.data[0] && cfgRes.data[0].maintenance) {
        return { code: -1, msg: '系统维护中，请稍后再试' };
      }
    } catch (err) {
      // config 集合不存在时视为未开启维护
    }
  }

  // ===== 创建评价 =====
  if (action === 'create') {
    const { postId, targetId } = event;
    if (!postId || !targetId) return { code: -1, msg: '参数错误' };
    if (targetId === openid) return { code: -1, msg: '不能评价自己' };

    const score = Number(event.rating);
    if (!(score >= 1 && score <= 5)) return { code: -1, msg: '请选择 1-5 星评分' };

    const text = (event.comment || '').toString().trim();
    if (!text) return { code: -1, msg: '请填写评价内容' };
    if (text.length > 100) return { code: -1, msg: '评价内容不能超过100字' };

    const sec = await checkTextSecurity(text, '评价');
    if (!sec.ok) return { code: -1, msg: sec.msg };

    // 同一用户对同一帖子只能评价一次
    const dup = await db.collection('review')
      .where({ rater_id: openid, post_id: postId })
      .count();
    if (dup.total > 0) return { code: -1, msg: '你已经评价过这条信息了' };

    const raterRes = await db.collection('user').where({ _openid: openid }).get();
    const rater = raterRes.data[0] || {};

    await db.collection('review').add({
      data: {
        rater_id: openid,
        target_id: targetId,
        post_id: postId,
        rating: score,
        comment: text,
        raterName: rater.nickName || '',
        raterAvatar: rater.avatarUrl || '',
        created_at: db.serverDate()
      }
    });

    // 维护被评人聚合
    await db.collection('user').where({ _openid: targetId }).update({
      data: { rating_sum: _.inc(score), rating_count: _.inc(1) }
    });

    return { code: 0, msg: '评价成功' };
  }

  // ===== 某用户的评价列表 + 汇总 =====
  if (action === 'listByTarget') {
    const targetId = event.targetId;
    if (!targetId) return { code: -1, msg: '缺少用户标识' };
    const { page, pageSize } = normalizePage(event);

    const totalRes = await db.collection('review').where({ target_id: targetId }).count();
    const listRes = await db.collection('review')
      .where({ target_id: targetId })
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    const userRes = await db.collection('user').where({ _openid: targetId }).get();
    const u = userRes.data[0] || {};
    const count = u.rating_count || 0;

    return {
      code: 0,
      data: listRes.data,
      total: totalRes.total,
      summary: {
        count,
        avg: count > 0 ? Number(((u.rating_sum || 0) / count).toFixed(1)) : 0
      }
    };
  }

  // ===== 我收到的评价 =====
  if (action === 'myReceived') {
    const { page, pageSize } = normalizePage(event);

    const totalRes = await db.collection('review').where({ target_id: openid }).count();
    const listRes = await db.collection('review')
      .where({ target_id: openid })
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    const meRes = await db.collection('user').where({ _openid: openid }).get();
    const me = meRes.data[0] || {};
    const count = me.rating_count || 0;

    return {
      code: 0,
      data: listRes.data,
      total: totalRes.total,
      summary: {
        count,
        avg: count > 0 ? Number(((me.rating_sum || 0) / count).toFixed(1)) : 0
      }
    };
  }

  // ===== 某帖子我是否已评价 =====
  if (action === 'checkByPost') {
    const postId = event.postId;
    if (!postId) return { code: -1, msg: '缺少帖子标识' };
    const res = await db.collection('review')
      .where({ rater_id: openid, post_id: postId })
      .count();
    return { code: 0, data: { reviewed: res.total > 0 } };
  }

  return { code: -1, msg: '未知操作' };
};
