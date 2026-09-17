// cloudfunctions/config/index.js —— 全局配置（维护模式开关 + 批量上架白名单 + 技能分类）
//
// config 集合需要一条记录：
//   {
//     "key": "app",
//     "maintenance": false,
//     "notice": "系统维护中，请稍后再试",
//     "admin_openids": ["oXXXX-xxxxxxxxxxxxxxxxxxx"],
//     "skill_categories": ["项目辅导", "科研教学", ...],
//     "skill_price_ref": { "项目辅导": { "min": 30, "max": 80, "unit": "per_hour" } }
//   }
// admin_openids：批量上架白名单（数组，填管理员的 openid）
// skill_categories：技能分类枚举（数组）。改这里即可增减技能分类，前端与云函数校验都会跟随，
//                   无需重新提审发版（前端有 1 小时本地缓存）。留空/非法时用下面的默认列表兜底。
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

exports.main = async (event) => {
  const { action } = event;
  const openid = cloud.getWXContext().OPENID;

  if (action === 'get') {
    const cfg = await readAppConfig();
    const whitelist = (cfg && Array.isArray(cfg.admin_openids)) ? cfg.admin_openids : [];
    return {
      code: 0,
      data: {
        maintenance: !!(cfg && cfg.maintenance),
        notice: (cfg && cfg.notice) || DEFAULT_NOTICE,
        // 仅下发"当前调用者是否可用批量上架"，不下发白名单本身（避免泄露）
        canBatch: !!openid && whitelist.indexOf(openid) > -1,
        // 技能参考价区间（公开的引导信息，可在控制台调整；为空时前端用默认表兜底）
        skillPriceRef: (cfg && cfg.skill_price_ref) || null,
        // 技能分类枚举（前端渲染 + 服务端校验共用；在控制台改 config 记录即可增删分类）
        skillCategories: normalizeSkillCategories(cfg && cfg.skill_categories)
      }
    };
  }

  return { code: -1, msg: '未知操作' };
};
