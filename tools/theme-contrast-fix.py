# -*- coding: utf-8 -*-
"""
tools/theme-contrast-fix.py —— 按对比度走查结果做的定点修复（一次性）

逐色替换只能保证「颜色值对」，保证不了「文字在它的底上读得清」。
本脚本按规则块判断，做三类定点修复：

  A. 浅底 + 同色文字（对比度 < 2.0，几乎糊成一片）
     → 文字改用同语义的「深档」令牌（--warning-dark / --success-dark）
  B. 白字 + 极浅的类型渐变底（对比度 < 2.0）
     → 底色改用类型色的深档（--type-*-text），白字对比度升到 3.7~5.0
  C. 禁用态白字压浅灰底
     → 文字改 --text-light（与全局 .btn-primary[disabled] 一致）

用法：python tools/theme-contrast-fix.py [--write]
"""
import io
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'miniprogram')
BLOCK = re.compile(r'([^{}]*?)\{([^{}]*)\}', re.S)

# B：白字压在这些浅渐变上读不清，底色换成同色相的深档
LIGHT_GRAD_TO_DARK = {
    'var(--type-skill-grad)': 'var(--type-skill-text)',
    'var(--type-wanted-grad)': 'var(--type-wanted-text)',
    'var(--type-idle-grad)': 'var(--type-idle-text)',
    'var(--type-exchange-grad)': 'var(--type-exchange-text)',
}

# C：禁用态白字压浅灰底，逐个文件定点
DISABLED_SELECTORS = {
    'pages/commodity_release/commodity_release.wxss': ['.publish-btn[disabled]'],
}


def fix(path, write):
    with io.open(path, encoding='utf-8') as f:
        css = f.read()
    stats = {'A': 0, 'B': 0, 'C': 0}
    rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
    disabled_sels = DISABLED_SELECTORS.get(rel, [])

    def sub(m):
        sel, body = m.group(1), m.group(2)
        selname = re.sub(r'\s+', ' ', sel).strip()
        bg = re.search(r'background(?:-color)?\s*:\s*([^;]+);', body)
        co = re.search(r'(?<![-\w])color\s*:\s*([^;]+);', body)
        if not bg or not co:
            return m.group(0)
        bgv = bg.group(1).strip()
        cov = co.group(1).strip()

        # A：warning / success 浅底上的同色文字 → 深档
        if bgv == 'var(--warning-soft)' and cov == 'var(--warning)':
            body = body.replace('color: var(--warning)', 'color: var(--warning-dark)')
            stats['A'] += 1
            return sel + '{' + body + '}'
        if bgv == 'var(--success-soft)' and cov in ('var(--success)', 'var(--primary)'):
            body = body.replace('color: ' + cov, 'color: var(--success-dark)')
            stats['A'] += 1
            return sel + '{' + body + '}'

        # B：白字 + 极浅类型渐变 → 换深档底
        if cov == 'var(--white)' and bgv in LIGHT_GRAD_TO_DARK:
            body = body.replace('background: ' + bgv,
                                'background: ' + LIGHT_GRAD_TO_DARK[bgv])
            stats['B'] += 1
            return sel + '{' + body + '}'

        # C：指定的禁用态选择器
        if selname in disabled_sels and cov == 'var(--white)':
            body = body.replace('color: var(--white)', 'color: var(--text-light)')
            stats['C'] += 1
            return sel + '{' + body + '}'

        return m.group(0)

    out = BLOCK.sub(sub, css)
    if out != css and write:
        with io.open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
    return stats, out != css


def main():
    write = '--write' in sys.argv
    total = {'A': 0, 'B': 0, 'C': 0}
    files = 0
    for dirpath, _dirs, fns in os.walk(ROOT):
        for fn in fns:
            if not fn.endswith('.wxss'):
                continue
            p = os.path.join(dirpath, fn)
            if 'styles' in p.replace(os.sep, '/'):
                continue
            st, changed = fix(p, write)
            if changed:
                files += 1
                for k in total:
                    total[k] += st[k]
                print('  %-52s A%d B%d C%d' % (os.path.relpath(p, ROOT), st['A'], st['B'], st['C']))
    print('%s：%d 个文件｜浅底深档 %d / 浅渐变底换深档 %d / 禁用态 %d'
          % ('已写入' if write else '预演（未写入）', files, total['A'], total['B'], total['C']))


if __name__ == '__main__':
    main()
