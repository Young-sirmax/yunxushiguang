// utils/bookcorner.js —— 公益图书角公共常量与文案（页面共用，避免多处硬编码）
//
// 分区口径以 docs/bookcorner-schema.md / 运营方案为准：
//   A 区 = 教材流转角（拿一留一，可外带）
//   B 区 = 馆内阅览区（茶咖空间内阅读，不外带）
// ⚠️ Kimi 开发指令第 5 条里的 A/B 名称与运营方案相反，这里以数据层与运营方案为准。
const DEFAULT_SPACE_ID = 'space_stnh_001';

const ZONES = {
  A: {
    key: 'A',
    name: 'A区 · 教材流转',
    short: '教材流转',
    desc: '拿一本，留一本',
    hint: '可外带：带走一本，留下一本八成新以上的教材 / 教辅 / 专业书'
  },
  B: {
    key: 'B',
    name: 'B区 · 馆内阅览',
    short: '馆内阅览',
    desc: '茶咖空间内阅读，不外带',
    hint: '在茶咖空间内阅读，离座请放回原位，方便下一位同学'
  }
};

function getZone(zone) {
  return ZONES[zone] || ZONES.A;
}

module.exports = { DEFAULT_SPACE_ID, ZONES, getZone };
