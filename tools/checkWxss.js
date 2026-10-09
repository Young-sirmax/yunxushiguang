// tools/checkWxss.js —— WXSS 语法自查
//
// 起因：一次批量配色替换脚本在注释后留下了多余的分号：
//     color: var(--warning);   /* 注释 */;
// 标准 CSS 会忽略这个多余分号，**但 WXSS 的严格解析器直接报
// `unexpected token ;`**，属于编译级致命错误 —— 整个样式表挂掉，页面白屏，
// 而开发者工具的「问题」面板不一定显示出来。
//
// 用法：node tools/checkWxss.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.wxss')) out.push(p);
  });
  return out;
}

const files = walk(ROOT, []);
const problems = [];

files.forEach(f => {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8');

  // 1) 注释后又跟分号（同行）—— 就是害我们白屏的那条
  src.split(/\r?\n/).forEach((ln, i) => {
    if (/;\s*\/\*.*\*\/\s*;/.test(ln)) {
      problems.push(`${rel}:${i + 1}  注释后多余分号 → ${ln.trim()}`);
    }
  });

  // 2) 注释后跟分号（跨行）
  [...src.matchAll(/\*\/\s*\n\s*;/g)].forEach(m => {
    const line = src.slice(0, m.index).split('\n').length;
    problems.push(`${rel}:${line}  注释后多余分号（跨行）`);
  });

  // 3) 连续两个分号
  [...src.matchAll(/;;/g)].forEach(m => {
    const line = src.slice(0, m.index).split('\n').length;
    problems.push(`${rel}:${line}  连续分号`);
  });

  // 4) 花括号平衡
  const o = (src.match(/\{/g) || []).length;
  const c = (src.match(/\}/g) || []).length;
  if (o !== c) problems.push(`${rel}  花括号不平衡 {=${o} }=${c}`);

  // 5) @import 目标存在性
  [...src.matchAll(/@import\s+["']([^"']+)["']\s*;/g)].forEach(m => {
    const target = m[1].startsWith('/')
      ? path.join(ROOT, m[1])
      : path.resolve(path.dirname(f), m[1]);
    if (!fs.existsSync(target)) problems.push(`${rel}  @import 目标不存在 → ${m[1]}`);
  });
});

if (problems.length) {
  problems.forEach(p => console.log('❌ ' + p));
  console.log(`\n共 ${problems.length} 处问题（检查 ${files.length} 个 wxss）`);
  process.exit(1);
}
console.log(`全部通过（共检查 ${files.length} 个 wxss）`);
