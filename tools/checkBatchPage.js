// tools/checkBatchPage.js —— 批量上架 v2 页面静态自查
// 用途：核对 wxml 中引用的事件处理函数是否在 js 里定义、样式类是否在 wxss 里有定义。
// 用法：node tools/checkBatchPage.js
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'miniprogram');
const GLOBALS = [path.join(BASE, 'app.wxss'), path.join(BASE, 'styles', 'theme.wxss')];

function read(f) {
  try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; }
}

function check(name, wxmlPath, jsPath, wxssFiles) {
  const wxml = read(wxmlPath);
  const js = read(jsPath);
  const css = wxssFiles.map(read).join('\n');

  const handlers = [...wxml.matchAll(/\b(?:bind|catch):?[a-zA-Z]+="([a-zA-Z_$][\w$]*)"/g)].map(m => m[1]);
  const missingHandlers = [...new Set(handlers)].filter(
    h => !new RegExp('(^|\\s)' + h + '\\s*\\(').test(js)
  );

  // 类名提取：先剥离 {{...}} 数据绑定，再从中只取带引号的字面量类名，
  // 避免把 `{{tab === 'a' ? 'b' : ''}}` 里的 === / ? / : 当成类名。
  const classes = [...wxml.matchAll(/class="([^"]*)"/g)].flatMap(m => {
    // 数据绑定里的 `tab === 'drafts'` 是状态值不是类名，先把比较表达式整段剔除
    const raw = m[1].replace(/[=!]==?\s*'[^']*'/g, ' ');
    const literals = [...raw.matchAll(/'([^']*)'/g)].map(x => x[1]);
    const bare = raw.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/);
    return bare.concat(literals);
  }).filter(c => c && !c.includes('{') && !c.includes('}') && !c.includes('(') && !c.includes('.'));

  const missingClasses = [...new Set(classes)].filter(c => !css.includes('.' + c));

  console.log('--- ' + name + ' ---');
  console.log('  事件处理函数缺失: ' + (missingHandlers.length ? missingHandlers.join(', ') : '无'));
  console.log('  样式类缺失: ' + (missingClasses.length ? missingClasses.join(', ') : '无'));
  return missingHandlers.length + missingClasses.length;
}

let bad = 0;
bad += check('admin_batch',
  path.join(BASE, 'pages/admin_batch/admin_batch.wxml'),
  path.join(BASE, 'pages/admin_batch/admin_batch.js'),
  GLOBALS.concat([path.join(BASE, 'pages/admin_batch/admin_batch.wxss')]));

bad += check('batch_invite',
  path.join(BASE, 'pages/batch_invite/batch_invite.wxml'),
  path.join(BASE, 'pages/batch_invite/batch_invite.js'),
  GLOBALS.concat([path.join(BASE, 'pages/batch_invite/batch_invite.wxss')]));

console.log(bad === 0 ? '\n全部通过' : '\n共 ' + bad + ' 处缺失');
process.exit(bad === 0 ? 0 : 1);
