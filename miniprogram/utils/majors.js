// utils/majors.js —— 图书专区：适用学院 / 专业数据
// 数据来源：中国石油大学（北京）北京校本部 · 2026 年本科招生专业（阳光高考）
// 说明：不含克拉玛依校区；地球物理学 2026 起停招，已剔除；含塔尔萨国际能源学院（2026 首届招生）

// 公共课分组名称（不针对具体专业的通用教材）
const PUBLIC_COLLEGE = '公共课 / 通用';

// 学院 → 专业
const COLLEGE_MAJORS = [
  { college: '地球科学学院', majors: ['资源勘查工程', '地质学'] },
  { college: '石油工程学院', majors: ['石油工程', '海洋油气工程', '油气储运工程'] },
  { college: '化学工程与环境学院', majors: ['化学工程与工艺', '能源化学工程', '环境工程', '环境科学'] },
  { college: '机械与储运工程学院', majors: ['机械设计制造及其自动化', '机器人工程', '能源与动力工程'] },
  { college: '地球物理学院', majors: ['勘查技术与工程'] },
  { college: '安全与海洋工程学院', majors: ['安全工程'] },
  { college: '新能源与材料学院', majors: ['新能源科学与工程', '储能科学与工程', '材料科学与工程', '过程装备与控制工程'] },
  { college: '人工智能学院', majors: ['计算机科学与技术', '自动化', '电子信息工程', '人工智能'] },
  { college: '理学院', majors: ['数学与应用数学', '统计学', '应用化学'] },
  { college: '经济管理学院', majors: ['会计学', '财务管理', '市场营销', '信息管理与信息系统', '能源经济', '金融学'] },
  { college: '外国语学院', majors: ['英语'] },
  { college: '马克思主义学院', majors: ['思想政治教育'] },
  { college: '未来能源学院', majors: ['石油工程（未来能源创新班）', '碳储科学与工程'] },
  { college: '塔尔萨国际能源学院', majors: ['石油工程（中外合作办学）', '化学工程与工艺（中外合作办学）', '数据科学与大数据技术（中外合作办学）', '能源经济（中外合作办学）'] },
  { college: PUBLIC_COLLEGE, majors: ['高等数学', '大学英语', '四六级', '考研公共课', '思想政治理论', '大学物理', '大学化学', '计算机基础', '其他通用'] }
];

// 全部学院名称
const COLLEGE_LIST = COLLEGE_MAJORS.map(item => item.college);

// 全部专业（扁平，用于校验与全量匹配）
const ALL_MAJORS = COLLEGE_MAJORS.reduce((acc, item) => acc.concat(item.majors), []);

/**
 * 按学院取专业列表
 * @param {string} college 学院名称
 * @returns {string[]}
 */
function getMajorsByCollege(college) {
  const found = COLLEGE_MAJORS.find(item => item.college === college);
  return found ? found.majors.slice() : [];
}

/**
 * 反查某专业所属学院（用于编辑回填）
 * @param {string} major 专业名称
 * @returns {string} 学院名称，未找到返回空串
 */
function getCollegeByMajor(major) {
  if (!major) return '';
  const found = COLLEGE_MAJORS.find(item => item.majors.indexOf(major) > -1);
  return found ? found.college : '';
}

/**
 * 判断分类是否为"图书/教材"类，从而决定是否展示专业筛选。
 * 采用模糊匹配，避免依赖后端 category 集合里的准确名称（"书籍教材"/"教材书籍"/"图书教材"等均可命中）
 * @param {string} categoryName 分类名称
 * @returns {boolean}
 */
function isBookCategoryName(categoryName) {
  const name = (categoryName || '').trim();
  if (!name) return false;
  return name.indexOf('书') >= 0 || name.indexOf('教材') >= 0;
}

module.exports = {
  PUBLIC_COLLEGE,
  COLLEGE_MAJORS,
  COLLEGE_LIST,
  ALL_MAJORS,
  getMajorsByCollege,
  getCollegeByMajor,
  isBookCategoryName
};
