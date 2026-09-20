# -*- coding: utf-8 -*-
"""
tools/theme-rename-aliases.py —— 把历史变量名收敛到新令牌名（一次性）

theme.wxss 里为兼容存量页面保留了一批历史别名（--accent / --danger / --want /
--exchange / --skill / --sun / --primary-soft …），它们的值与新令牌完全相同，
只是名字叫法不同。本脚本把全站引用改成规范名，之后就能把别名从令牌表里删掉，
让「色板对照表」只剩一套名字。

用法：python tools/theme-rename-aliases.py [--write]
"""
import io
import os
import sys

# 顺序无关：匹配时带右括号，'var(--want)' 不会误伤 'var(--want-grad)'
RENAME = [
    ('--accent-grad', '--price-grad'),
    ('--accent-soft', '--price-soft'),
    ('--accent', '--price'),
    ('--danger-soft', '--error-soft'),
    ('--danger', '--error'),
    ('--want-grad', '--type-wanted-grad'),
    ('--want-soft', '--type-wanted-soft'),
    ('--want-deep-grad', '--type-wanted-deep-grad'),
    ('--want-deep-soft', '--type-wanted-deep-soft'),
    ('--want-deep', '--type-wanted-deep'),
    ('--want', '--type-wanted-text'),
    ('--exchange-grad', '--type-exchange-grad'),
    ('--exchange-soft', '--type-exchange-soft'),
    ('--exchange', '--type-exchange-text'),
    ('--skill-grad', '--type-skill-grad'),
    ('--skill-soft', '--type-skill-soft'),
    ('--skill', '--type-skill-text'),
    ('--sun-grad', '--warning-grad'),
    ('--sun', '--warning'),
    ('--primary-soft', '--primary-light'),
]

SKIP = {'styles/theme.wxss'}


def main():
    write = '--write' in sys.argv
    changed = 0
    hits = 0
    for dirpath, _dirs, files in os.walk('miniprogram'):
        for fn in files:
            if not fn.endswith(('.wxss', '.wxml')):
                continue
            path = os.path.join(dirpath, fn)
            rel = os.path.relpath(path, 'miniprogram').replace(os.sep, '/')
            if rel in SKIP:
                continue
            with io.open(path, encoding='utf-8') as f:
                src = f.read()
            out = src
            n = 0
            for old, new in RENAME:
                key = 'var(%s)' % old
                n += out.count(key)
                out = out.replace(key, 'var(%s)' % new)
            if out != src:
                changed += 1
                hits += n
                if write:
                    with io.open(path, 'w', encoding='utf-8', newline='') as f:
                        f.write(out)
    print('%s：%d 个文件、%d 处引用' % ('已写入' if write else '预演（未写入）', changed, hits))


if __name__ == '__main__':
    main()
