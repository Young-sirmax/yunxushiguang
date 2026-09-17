// 云函数 migrate：一次性数据迁移（仅管理员可调用）
//
// 迁移内容：
//   1) user.contact     → phone（手机号）或 wechat_id（微信号），并移除 contact
//   2) user             补齐 wechat_id / phone 字段（缺失时置空串）
//   3) commodity.type   缺失时补 'sell'
//   4) commodity.tradeStatus 缺失时补 'open'
//   5) commodity.sellerContact → sellerPhone 快照，并移除 sellerContact
//
// 用法（在微信开发者工具 → 云函数 migrate → 云端测试 里调用）：
//   { "action": "status" }                                  查看各步骤剩余待迁移数量
//   { "action": "run", "target": "users",     "dryRun": true }  预演（不写库）
//   { "action": "run", "target": "users" }                  真正执行一批（默认 50 条）
//   { "action": "run", "target": "all" }                     依次执行全部步骤各一批
// 反复调用 run 直到 status 中所有 remaining 为 0。
//
// 注意：迁移不可逆，执行前请先备份数据库（云开发控制台可导出集合）。

const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();
const _ = db.command;

const PHONE_REGEX = /^1\d{10}$/;
const WECHAT_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/;

async function isAdmin(openid) {
  try {
    const res = await db.collection('user').where({ _openid: openid, isAdmin: true }).count();
    return res.total > 0;
  } catch (err) {
    return false;
  }
}

// ===== 1) 用户：contact → phone / wechat_id =====
async function migrateUserContact(limit, dryRun) {
  const res = await db.collection('user').where({ contact: _.exists(true) }).limit(limit).get();
  let updated = 0;

  for (const u of res.data) {
    const raw = (u.contact || '').toString().trim();
    const patch = { contact: _.remove(), updateTime: db.serverDate() };

    if (PHONE_REGEX.test(raw)) {
      patch.phone = raw;
    } else if (WECHAT_REGEX.test(raw)) {
      patch.wechat_id = raw;
    } else if (raw) {
      // 无法判定格式：先保留在 phone（仅作兜底复制，不对外展示），由用户后续在「个人信息」完善
      patch.phone = raw;
    }

    if (dryRun) {
      console.log('[migrate][dryRun] user.contact →', u._id, raw, '=>', JSON.stringify(Object.keys(patch)));
    } else {
      await db.collection('user').doc(u._id).update({ data: patch });
    }
    updated += 1;
  }
  return updated;
}

// ===== 2) 用户：补齐 wechat_id / phone 字段 =====
async function migrateUserFields(limit, dryRun) {
  const res = await db.collection('user').where({ wechat_id: _.exists(false) }).limit(limit).get();
  let updated = 0;

  for (const u of res.data) {
    const patch = { updateTime: db.serverDate() };
    patch.wechat_id = u.wechat_id || '';
    if (u.phone === undefined) patch.phone = u.phone || '';

    if (dryRun) {
      console.log('[migrate][dryRun] user 补字段:', u._id);
    } else {
      await db.collection('user').doc(u._id).update({ data: patch });
    }
    updated += 1;
  }
  return updated;
}

// ===== 3) 商品：补 type =====
async function migrateCommodityType(limit, dryRun) {
  const res = await db.collection('commodity').where({ type: _.exists(false) }).limit(limit).get();
  let updated = 0;

  for (const c of res.data) {
    if (dryRun) {
      console.log('[migrate][dryRun] commodity 补 type=sell:', c._id);
    } else {
      await db.collection('commodity').doc(c._id).update({
        data: { type: 'sell', updateTime: db.serverDate() }
      });
    }
    updated += 1;
  }
  return updated;
}

// ===== 4) 商品：补 tradeStatus =====
async function migrateCommodityTradeStatus(limit, dryRun) {
  const res = await db.collection('commodity').where({ tradeStatus: _.exists(false) }).limit(limit).get();
  let updated = 0;

  for (const c of res.data) {
    // 已售出的历史数据视为已完成，其余为可交易
    const tradeStatus = c.status === 'sold' ? 'completed' : 'open';
    if (dryRun) {
      console.log('[migrate][dryRun] commodity 补 tradeStatus:', c._id, tradeStatus);
    } else {
      await db.collection('commodity').doc(c._id).update({
        data: { tradeStatus, updateTime: db.serverDate() }
      });
    }
    updated += 1;
  }
  return updated;
}

// ===== 5) 商品：sellerContact → sellerPhone 快照 =====
async function migrateCommoditySellerContact(limit, dryRun) {
  const res = await db.collection('commodity').where({ sellerContact: _.exists(true) }).limit(limit).get();
  let updated = 0;

  for (const c of res.data) {
    const patch = { sellerContact: _.remove(), updateTime: db.serverDate() };
    // 旧字段内容可能是手机号也可能是微信号，统一存入 sellerPhone 作为兜底复制来源
    if (!c.sellerPhone && c.sellerContact) patch.sellerPhone = c.sellerContact;
    if (!c.exchange_want) patch.exchange_want = c.exchange_want || '';
    if (c.accept_price_diff === undefined) patch.accept_price_diff = c.accept_price_diff || null;

    if (dryRun) {
      console.log('[migrate][dryRun] commodity sellerContact → sellerPhone:', c._id, c.sellerContact);
    } else {
      await db.collection('commodity').doc(c._id).update({ data: patch });
    }
    updated += 1;
  }
  return updated;
}

// ===== 6) 用户：补技能达人字段（expert_status 默认 none） =====
async function migrateUserExpertField(limit, dryRun) {
  const res = await db.collection('user').where({ expert_status: _.exists(false) }).limit(limit).get();
  let updated = 0;

  for (const u of res.data) {
    const patch = {
      expert_status: 'none',
      expert_skills: u.expert_skills || [],
      expert_intro: u.expert_intro || '',
      expert_certs: u.expert_certs || [],
      expert_price_unit: u.expert_price_unit || 'negotiable',
      expert_price: u.expert_price || null,
      expert_available_time: u.expert_available_time || '',
      expert_reject_reason: u.expert_reject_reason || '',
      rating_sum: u.rating_sum || 0,
      rating_count: u.rating_count || 0,
      updateTime: db.serverDate()
    };

    if (dryRun) {
      console.log('[migrate][dryRun] user 补达人字段:', u._id);
    } else {
      await db.collection('user').doc(u._id).update({ data: patch });
    }
    updated += 1;
  }
  return updated;
}

// ===== 7) 用户：技能分类枚举调整（已删除分类 → 其他） =====
// 本次移除「家教辅导」「跑腿代办」，命中者统一改为「其他」并去重
const REMOVED_SKILL_CATEGORIES = ['家教辅导', '跑腿代办'];
const SKILL_FALLBACK = '其他';

async function migrateUserSkillCategories(limit, dryRun) {
  const res = await db.collection('user')
    .where({ expert_skills: _.in(REMOVED_SKILL_CATEGORIES) })
    .limit(limit)
    .get();
  let updated = 0;

  for (const u of res.data) {
    const list = Array.isArray(u.expert_skills) ? u.expert_skills : [];
    const next = [];
    list.forEach(s => {
      const name = REMOVED_SKILL_CATEGORIES.indexOf(s) > -1 ? SKILL_FALLBACK : s;
      if (name && next.indexOf(name) === -1) next.push(name);
    });
    if (next.length === 0) next.push(SKILL_FALLBACK);

    if (dryRun) {
      console.log('[migrate][dryRun] user.expert_skills:', u._id, JSON.stringify(list), '=>', JSON.stringify(next));
    } else {
      await db.collection('user').doc(u._id).update({
        data: { expert_skills: next, updateTime: db.serverDate() }
      });
    }
    updated += 1;
  }
  return updated;
}

// ===== 8) 帖子：技能分类枚举调整（已删除分类 → 其他） =====
async function migrateCommoditySkillCategory(limit, dryRun) {
  const res = await db.collection('commodity')
    .where({ skill_category: _.in(REMOVED_SKILL_CATEGORIES) })
    .limit(limit)
    .get();
  let updated = 0;

  for (const c of res.data) {
    if (dryRun) {
      console.log('[migrate][dryRun] commodity.skill_category:', c._id, c.skill_category, '=>', SKILL_FALLBACK);
    } else {
      await db.collection('commodity').doc(c._id).update({
        data: { skill_category: SKILL_FALLBACK, updateTime: db.serverDate() }
      });
    }
    updated += 1;
  }
  return updated;
}

// ===== 9) 求购：补 want_category 分区（goods 物品求购 / skill 技能求助） =====
// 判定依据：历史数据里若分类（categoryName 或旧 category 字段）为「技能服务」则为技能求助，其余一律物品求购
async function migrateCommodityWantCategory(limit, dryRun) {
  const res = await db.collection('commodity')
    .where({ type: 'want', want_category: _.exists(false) })
    .limit(limit)
    .get();
  let updated = 0;

  for (const c of res.data) {
    const legacy = String(c.category || c.categoryName || '').trim();
    const wantCategory = legacy === '技能服务' ? 'skill' : 'goods';

    if (dryRun) {
      console.log('[migrate][dryRun] commodity.want_category:', c._id, legacy || '(空)', '=>', wantCategory);
    } else {
      await db.collection('commodity').doc(c._id).update({
        data: { want_category: wantCategory, updateTime: db.serverDate() }
      });
    }
    updated += 1;
  }
  return updated;
}

async function countWhere(collection, where) {
  try {
    const res = await db.collection(collection).where(where).count();
    return res.total;
  } catch (err) {
    console.error('[migrate] count 失败:', collection, err.message);
    return -1;
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID;
  if (!(await isAdmin(openid))) {
    return { code: -1, msg: '无管理员权限' };
  }

  const action = event.action || 'status';
  const limit = Math.min(Math.max(parseInt(event.limit, 10) || 50, 1), 100);
  const dryRun = !!event.dryRun;
  const target = event.target || 'all';

  if (action === 'status') {
    const remaining = {
      userContact: await countWhere('user', { contact: _.exists(true) }),
      userWechatField: await countWhere('user', { wechat_id: _.exists(false) }),
      commodityType: await countWhere('commodity', { type: _.exists(false) }),
      commodityTradeStatus: await countWhere('commodity', { tradeStatus: _.exists(false) }),
      commoditySellerContact: await countWhere('commodity', { sellerContact: _.exists(true) }),
      userExpertField: await countWhere('user', { expert_status: _.exists(false) }),
      // 技能分类枚举调整 + 求购分区
      userSkillCategories: await countWhere('user', { expert_skills: _.in(REMOVED_SKILL_CATEGORIES) }),
      commoditySkillCategory: await countWhere('commodity', { skill_category: _.in(REMOVED_SKILL_CATEGORIES) }),
      commodityWantCategory: await countWhere('commodity', { type: 'want', want_category: _.exists(false) })
    };
    return { code: 0, msg: '统计完成', data: { remaining } };
  }

  if (action === 'run') {
    const result = {};
    const tasks = [];
    if (target === 'all' || target === 'users' || target === 'userContact') {
      tasks.push(['userContact', migrateUserContact]);
    }
    if (target === 'all' || target === 'users' || target === 'userFields') {
      tasks.push(['userWechatField', migrateUserFields]);
    }
    if (target === 'all' || target === 'commodity' || target === 'commodityType') {
      tasks.push(['commodityType', migrateCommodityType]);
    }
    if (target === 'all' || target === 'commodity' || target === 'commodityTradeStatus') {
      tasks.push(['commodityTradeStatus', migrateCommodityTradeStatus]);
    }
    if (target === 'all' || target === 'commodity' || target === 'commoditySellerContact') {
      tasks.push(['commoditySellerContact', migrateCommoditySellerContact]);
    }
    if (target === 'all' || target === 'users' || target === 'userExpertField') {
      tasks.push(['userExpertField', migrateUserExpertField]);
    }
    // ===== 技能分类枚举调整 + 求购分区 =====
    if (target === 'all' || target === 'users' || target === 'userSkillCategories') {
      tasks.push(['userSkillCategories', migrateUserSkillCategories]);
    }
    if (target === 'all' || target === 'commodity' || target === 'commoditySkillCategory') {
      tasks.push(['commoditySkillCategory', migrateCommoditySkillCategory]);
    }
    if (target === 'all' || target === 'commodity' || target === 'commodityWantCategory') {
      tasks.push(['commodityWantCategory', migrateCommodityWantCategory]);
    }

    if (tasks.length === 0) {
      return { code: -1, msg: '未知的 target，可选：users / commodity / all 或具体步骤名' };
    }

    for (const [name, fn] of tasks) {
      try {
        result[name] = await fn(limit, dryRun);
      } catch (err) {
        console.error('[migrate] 步骤失败:', name, err.message);
        result[name] = 'failed: ' + err.message;
      }
    }

    return {
      code: 0,
      msg: dryRun ? '预演完成（未写库）' : '迁移完成一批，请再次调用直至 status 全为 0',
      data: { limit, dryRun, processed: result }
    };
  }

  return { code: -1, msg: '未知操作，仅支持 status / run' };
};
