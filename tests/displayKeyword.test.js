// utils/displayKeyword.test.js —— 气泡短标题规则测试
//
// 运行方式（需要 Node）：
//   node tests/displayKeyword.test.js
//
// 说明：以下 16 条为「占位样例」，逻辑已覆盖常见套话/emoji/英文型号/兜底分支。
//      你可以把真实标题补充/替换到 CASES 里（把 expect 填成期望值即可）。

const { buildDisplayKeyword, cleanTitle, truncateNice, isMeaningful } = require('../miniprogram/utils/displayKeyword.js');

const CASES = [
  // ===== 套话剥离 =====
  { name: '首部套话「出售」+ 成色 + 英文型号', input: { title: '出售 九成新 iPad 2021' }, expect: '九成新' },
  { name: '首尾套话「出」「可小刀」', input: { title: '出 二手自行车 可小刀' }, expect: '二手自行车' },
  { name: '括号包裹的套话「【急出】」', input: { title: '【急出】iPhone 13 全新未拆' }, expect: 'iPhone' },
  { name: '求购套话（type=want）', input: { title: '求购 高等数学 上册', type: 'want' }, expect: '高等数学' },
  { name: 'emoji + 求购 + 可议价', input: { title: '🔍 求购 吉他 可议价', type: 'want' }, expect: '吉他' },
  { name: '中文冒号分隔', input: { title: '转让：宿舍小台灯' }, expect: '宿舍小台灯' },
  { name: '多重首部套话「包邮 + 出」', input: { title: '包邮 出 英语四级真题' }, expect: '英语四级真题' },
  { name: '以物易物 + 想换（type=exchange）', input: { title: '以物换物 想换一副羽毛球拍', type: 'exchange' }, expect: '想换一副羽毛' },
  { name: '首部套话「收」', input: { title: '收 二手考研数学 张宇' }, expect: '二手考研数学' },

  // ===== 英文/数字词边界收尾 =====
  { name: '纯英文起头（不被截成半截词）', input: { title: 'switch 游戏卡带 塞尔达' }, expect: 'switch' },
  { name: '中文 + 英文型号（关键修复：不再出现「华为HUAWE」）', input: { title: '华为HUAWEI MatePad 11' }, expect: '华为' },

  // ===== 兜底分支 =====
  { name: '清洗后只剩套话 → 用分类名兜底', input: { title: '出售！！！', categoryName: '数码电子' }, expect: '数码电子' },
  { name: '全空 → 用类型名兜底', input: { title: '', categoryName: '', type: 'want' }, expect: '求购' },
  { name: '技能服务优先用技能分类名', input: { title: '高中数学一对一辅导', type: 'skill', skillName: '家教辅导' }, expect: '家教辅导' },
  { name: '技能无技能名 → 退回标题', input: { title: '摄影修图 接单', type: 'skill', skillName: '' }, expect: '摄影修图' },

  // ===== 已知边界（单字套话的保护）=====
  { name: '「收纳盒」不被误伤（单字套话需剩余≥3字）', input: { title: '收纳盒 全新' }, expect: '收纳盒' }
];

// ===== 辅助函数单独用例 =====
const UNIT_CASES = [
  { name: 'cleanTitle 去 emoji', fn: () => cleanTitle('🌙 台灯 🌙'), expect: '台灯' },
  { name: 'cleanTitle 压缩连续空格与标点', fn: () => cleanTitle('台灯！！！   九成新'), expect: '台灯 九成新' },
  { name: 'truncateNice 不破坏英文词', fn: () => truncateNice('华为HUAWEI MatePad', 6), expect: '华为' },
  { name: 'truncateNice 末词只剩 1 字则丢弃', fn: () => truncateNice('高等数学 上册', 6), expect: '高等数学' },
  { name: 'truncateNice 短于上限原样返回', fn: () => truncateNice('台灯', 6), expect: '台灯' },
  { name: 'isMeaningful 整句套话为 false', fn: () => isMeaningful('出售'), expect: false },
  { name: 'isMeaningful 真实词为 true', fn: () => isMeaningful('二手自行车'), expect: true }
];

function run() {
  let pass = 0;
  const fails = [];

  CASES.forEach(c => {
    const actual = buildDisplayKeyword(c.input);
    if (actual === c.expect) {
      pass += 1;
    } else {
      fails.push(`[buildDisplayKeyword] ${c.name}\n    输入: ${JSON.stringify(c.input)}\n    期望: ${c.expect}\n    实际: ${actual}`);
    }
  });

  UNIT_CASES.forEach(c => {
    const actual = c.fn();
    if (actual === c.expect) {
      pass += 1;
    } else {
      fails.push(`[unit] ${c.name}\n    期望: ${c.expect}\n    实际: ${actual}`);
    }
  });

  const total = CASES.length + UNIT_CASES.length;
  console.log(`\n气泡短标题规则测试：${pass}/${total} 通过`);
  if (fails.length) {
    console.log('\n失败用例：');
    fails.forEach(f => console.log('  ✗ ' + f));
  } else {
    console.log('全部通过 ✅');
  }
  return fails.length === 0;
}

if (typeof module !== 'undefined' && require.main === module) {
  const ok = run();
  if (typeof process !== 'undefined' && process.exit) process.exit(ok ? 0 : 1);
}

module.exports = { CASES, UNIT_CASES, run };
