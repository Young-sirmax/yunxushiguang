// cloudfunctions/config/index.js —— 全局配置（维护模式开关 + 批量上架白名单 + 技能分类）
//
// config 集合需要一条记录：
//   {
//     "key": "app",
//     "maintenance": false,
//     "notice": "系统维护中，请稍后再试",
//     "admin_openids": ["oXXXX-xxxxxxxxxxxxxxxxxxx"],
//     "super_admin_openids": ["oXXXX-xxxxxxxxxxxxxxxxxxx"],
//     "skill_categories": ["项目辅导", "科研教学", ...],
//     "skill_price_ref": { "项目辅导": { "min": 30, "max": 80, "unit": "per_hour" } },
//     "sensitiveWords": ["加微信", "刷单", ...]
//   }
// admin_openids：批量上架白名单（数组，填管理员的 openid）——v2 起作为超管的回退来源保留。
// super_admin_openids：超级管理员名单（数组）。只有超管能在小程序内授权/回收批量上架权限。
//                      该字段缺失或为空时回退到 admin_openids，存量环境无需改配置即可平滑升级。
//                      被授权人存 batch_admin 集合，不在本字段里维护。
// skill_categories：技能分类枚举（数组）。改这里即可增减技能分类，前端与云函数校验都会跟随，
//                   无需重新提审发版（前端有 1 小时本地缓存）。留空/非法时用下面的默认列表兜底。
// sensitiveWords：敏感词表（数组），公益图书角评论审核用。同样改这里即生效、无需重新部署。
//                 出于防绕过考虑，本字段**不下发给客户端**（action 'get' 不返回）；
//                 其他云函数需要时请直接读 config 集合（照 user 云函数 isMaintenanceOn 的写法），
//                 不要跨云函数调用。留空/非法时用下面的默认词表兜底。
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

const DEFAULT_NOTICE = '系统维护中，请稍后再试';

// 技能分类默认值（与 cloudfunctions/commodity、cloudfunctions/user 中的兜底列表保持一致）
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

/** 规整技能分类数组：去空、去重、去非字符串；不合法时返回默认列表 */
function normalizeSkillCategories(raw) {
  if (!Array.isArray(raw)) return DEFAULT_SKILL_CATEGORIES;
  const list = [];
  raw.forEach(item => {
    const name = typeof item === 'string' ? item.trim() : '';
    if (name && list.indexOf(name) === -1) list.push(name);
  });
  return list.length > 0 ? list : DEFAULT_SKILL_CATEGORIES;
}

// 敏感词默认值（公益图书角评论审核用）
// 只覆盖「平台自定的引流 / 违规交易」词——这类词 msgSecCheck 不拦，必须靠本地词表。
// 词条用词组而非单字，降低误伤；上线后按实际审核记录在控制台增删即可，无需改代码。
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

/** 规整敏感词数组：去空、去重、去非字符串；不合法时返回默认词表 */
function normalizeSensitiveWords(raw) {
  if (!Array.isArray(raw)) return DEFAULT_SENSITIVE_WORDS;
  const list = [];
  raw.forEach(item => {
    const word = typeof item === 'string' ? item.trim() : '';
    if (word && list.indexOf(word) === -1) list.push(word);
  });
  return list.length > 0 ? list : DEFAULT_SENSITIVE_WORDS;
}

async function readAppConfig() {
  try {
    const res = await db.collection('config').where({ key: 'app' }).limit(1).get();
    return res.data[0] || null;
  } catch (err) {
    // config 集合不存在时按默认值处理，避免影响正常使用
    console.warn('[config] 读取失败，按默认配置处理:', err.message);
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
 * 超管名单：super_admin_openids 优先，缺失/为空时回退 admin_openids。
 * 回退是为了让存量环境在不改配置的情况下平滑升级到 v2 权限模型。
 */
function resolveSuperAdminList(cfg) {
  const supers = normalizeOpenidList(cfg && cfg.super_admin_openids);
  return supers.length > 0 ? supers : normalizeOpenidList(cfg && cfg.admin_openids);
}

/** 是否在 batch_admin 集合里有一条 active 授权记录（集合不存在时兜底 false） */
async function hasBatchGrant(openid) {
  if (!openid) return false;
  try {
    const res = await db.collection('batch_admin')
      .where({ openid, status: 'active' })
      .limit(1)
      .get();
    return res.data.length > 0;
  } catch (err) {
    console.warn('[config] 读取 batch_admin 失败，按未授权处理:', err.message);
    return false;
  }
}

exports.main = async (event) => {
  const { action } = event;
  const openid = cloud.getWXContext().OPENID;

  if (action === 'get') {
    const cfg = await readAppConfig();
    const superList = resolveSuperAdminList(cfg);
    const isSuper = !!openid && superList.indexOf(openid) > -1;
    // 超管天然拥有批量上架权限；其余人看 batch_admin 集合（指令 4.3：客户端只拿布尔值）
    const canBatch = isSuper || await hasBatchGrant(openid);

    return {
      code: 0,
      data: {
        maintenance: !!(cfg && cfg.maintenance),
        notice: (cfg && cfg.notice) || DEFAULT_NOTICE,
        // 仅下发"当前调用者是否可用批量上架 / 是否超管"，白名单与授权名单本身永不下发
        canBatch,
        isSuper,
        // 技能参考价区间（公开的引导信息，可在控制台调整；为空时前端用默认表兜底）
        skillPriceRef: (cfg && cfg.skill_price_ref) || null,
        // 技能分类枚举（前端渲染 + 服务端校验共用；在控制台改 config 记录即可增删分类）
        skillCategories: normalizeSkillCategories(cfg && cfg.skill_categories)
      }
    };
  }

  // 敏感词表：仅管理员（超管名单）可读。
  // 普通用户拿不到词表，避免按词表逐条试探绕过审核。
  if (action === 'sensitiveWords') {
    const cfg = await readAppConfig();
    const superList = resolveSuperAdminList(cfg);
    if (!openid || superList.indexOf(openid) === -1) {
      return { code: -1, msg: '无权限' };
    }
    return { code: 0, data: normalizeSensitiveWords(cfg && cfg.sensitiveWords) };
  }

  // 引导初始化：把默认敏感词写进 config 记录（新环境第一次部署时用一次）。
  // 只填空、绝不覆盖已有词表，因此可以安全地重复调用。
  // 之后在控制台直接增删 sensitiveWords 即可，无需再调用本 action。
  if (action === 'initSensitiveWords') {
    const cfg = await readAppConfig();
    if (!cfg) return { code: -1, msg: '缺少 key=app 的配置记录，请先在控制台创建' };
    if (Array.isArray(cfg.sensitiveWords) && cfg.sensitiveWords.length > 0) {
      return { code: 0, data: cfg.sensitiveWords, msg: '已存在词表，未覆盖' };
    }
    await db.collection('config').doc(cfg._id).update({
      data: { sensitiveWords: DEFAULT_SENSITIVE_WORDS }
    });
    return { code: 0, data: DEFAULT_SENSITIVE_WORDS, msg: '已写入默认敏感词' };
  }

  return { code: -1, msg: '未知操作' };
};
