// tools/checkPageLoad.js —— 小程序页面/组件真实加载自查
//
// 静态检查（node --check / 标签配对）抓不到的一类问题：模块能解析，但 require 的目标
// 不存在、或在模块顶层就抛错。开发者工具会把它报成「编译失败」。
// 这里用最小桩替掉 wx / Page / App / Component / getApp，把每个页面真实 require 一遍。
//
// 用法：node tools/checkPageLoad.js
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..', 'miniprogram');

// ---- 最小桩：够让页面模块顶层跑完即可 ----
const noop = () => {};
const wxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'getStorageSync') return () => '';
    if (k === 'getSystemInfoSync') return () => ({});
    if (k === 'createSelectorQuery') return () => ({ select: () => ({ fields: () => ({ exec: noop }) }) });
    if (k === 'createOffscreenCanvas') return undefined;
    return noop;
  }
});

const captured = { page: null, app: null, component: null };

global.wx = wxStub;
global.getApp = () => ({ globalData: {}, getAppConfig: async () => ({}), clearAppConfigCache: noop });
global.Page = (o) => { captured.page = o; };
global.Component = (o) => { captured.component = o; };
global.App = (o) => { captured.app = o; };
global.getCurrentPages = () => [];

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  });
  return out;
}

const files = walk(ROOT, []).filter(f => !f.includes('node_modules'));
let bad = 0;

files.forEach(f => {
  const rel = path.relative(ROOT, f);
  captured.page = captured.app = captured.component = null;
  try {
    delete require.cache[require.resolve(path.resolve(f))];
    require(path.resolve(f));
  } catch (err) {
    bad++;
    console.log('❌ ' + rel);
    console.log('     ' + (err && err.message ? err.message.split('\n')[0] : err));
    if (err && err.stack) {
      const line = err.stack.split('\n').find(l => l.includes(rel.replace(/\\/g, '\\')));
      if (line) console.log('     ' + line.trim());
    }
  }
});

console.log(bad === 0
  ? `\n全部可加载（共 ${files.length} 个 js）`
  : `\n共 ${bad} 个文件加载失败`);
process.exit(bad === 0 ? 0 : 1);
