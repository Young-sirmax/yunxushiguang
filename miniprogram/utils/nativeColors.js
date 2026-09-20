// utils/nativeColors.js —— 原生 API 专用色值（令牌的十六进制镜像）
//
// 为什么这里又出现了十六进制：
//   wx.showModal({ confirmColor }) / wx.setNavigationBarColor 等**原生接口**
//   的颜色参数走的是原生层，不在 WXSS 的层叠里，**不认 CSS 变量**，
//   传 'var(--error)' 会被当成非法色值直接忽略（按钮颜色退化成默认色）。
//   所以这些位置必须写真实色值。
//
// 约定：本文件是原生 API 侧的唯一色值来源，值必须与 miniprogram/styles/theme.wxss
// 的同名令牌保持一致；改主色时两处一起改。
const NATIVE_COLORS = {
  primary: '#22B07D',   // = --primary
  primaryDark: '#14915F', // = --primary-dark
  error: '#F5402F',     // = --error（与 --price 同源）
  warning: '#F5A623'    // = --warning
};

module.exports = NATIVE_COLORS;
