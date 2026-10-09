// tools/checkWxml.js —— WXML 结构自查（标签闭合 + mustache 配对）
// 用途：小程序编译失败最常见的原因是 wxml 标签未闭合 / 引号不配对。
// 用法：node tools/checkWxml.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');

// wxml 里没有 HTML 那种 void 元素——所有标签要么写成 <x ... /> 自闭合，要么就必须有 </x>。
// 所以这张表只在「写法上允许省略斜杠但仍然不写闭合标签」时才需要，目前为空。
// （早期版本把 canvas 等错误地列进来，导致 <canvas>…</canvas> 被判成不匹配。）
const VOID_TAGS = new Set();

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.wxml')) out.push(p);
  });
  return out;
}

function check(file) {
  let src = fs.readFileSync(file, 'utf8');
  const problems = [];

  // 1) 注释先剔除
  src = src.replace(/<!--[\s\S]*?-->/g, '');

  // 2) mustache 配对（必须在屏蔽尖括号之前数）
  const open = (src.match(/\{\{/g) || []).length;
  const close = (src.match(/\}\}/g) || []).length;
  if (open !== close) problems.push(`mustache 不配对: {{=${open} }}=${close}`);

  // 3) 标签配对（按出现顺序用栈匹配）
  // 先把 {{...}} 里的 < > 换成占位符 —— 否则 `lazy-load="{{index > 0}}"` 里的 `>`
  // 会被当成标签结束，把后面的标签全判成不匹配。
  const masked = src.replace(/\{\{[\s\S]*?\}\}/g, m => m.replace(/>/g, '\u0001').replace(/</g, '\u0002'));
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][\w-]*)([^>]*?)(\/?)\s*>/g;
  src = masked;
  const stack = [];
  let m;
  while ((m = tagRe.exec(src)) !== null) {
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const selfClosing = m[4] === '/';
    const line = src.slice(0, m.index).split('\n').length;

    if (VOID_TAGS.has(name) && !closing) continue;
    if (closing) {
      if (stack.length === 0) {
        problems.push(`第 ${line} 行 </${name}> 多余（没有对应开标签）`);
      } else {
        const top = stack.pop();
        if (top.name !== name) {
          problems.push(`第 ${line} 行 </${name}> 与第 ${top.line} 行 <${top.name}> 不匹配`);
        }
      }
    } else if (!selfClosing) {
      stack.push({ name, line });
    }
  }
  stack.forEach(t => problems.push(`第 ${t.line} 行 <${t.name}> 未闭合`));

  return problems;
}

const files = walk(ROOT, []);
let bad = 0;
files.forEach(f => {
  const p = check(f);
  const rel = path.relative(ROOT, f);
  if (p.length) {
    bad += p.length;
    console.log('❌ ' + rel);
    p.forEach(x => console.log('     ' + x));
  }
});
console.log(bad === 0
  ? `\n全部通过（共检查 ${files.length} 个 wxml）`
  : `\n共 ${bad} 处问题`);
process.exit(bad === 0 ? 0 : 1);
