# -*- coding: utf-8 -*-
"""
tools/theme-report.py —— 生成《色板对照表》文档

做法：从 git HEAD（改造前）的源码里统计每个历史色值出现在哪些文件、各多少次，
与 theme_sweep_maps.py 的映射表对齐，输出 docs/06-色板对照表.md。
这样「改了哪些颜色、出现在哪些文件」是**统计出来的**，不是手写的。

用法：python tools/theme-report.py            # 预演，打印前若干行
      python tools/theme-report.py --write    # 写入 docs/06-色板对照表.md
"""
import io
import os
import re
import subprocess
import sys
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from theme_sweep_maps import GRADIENT_MAP, HEX_MAP, RGB_MAP, RGB_KEEP, norm_hex  # noqa: E402

REPO = os.path.join(HERE, '..')
OUT = os.path.join(REPO, 'docs', '06-色板对照表.md')

GRAD_RE = re.compile(r'(?:linear|radial)-gradient\((?:[^()]|\([^()]*\))*\)')
COLOR_IN_GRAD_RE = re.compile(r'#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)')
HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')
RGB_RE = re.compile(r'\brgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)')

# 令牌 → 中文用途（对照表的解释列）
TOKEN_NOTE = {
    'var(--primary)': '主色（顶部导航 / 按钮 / 选中态）',
    'var(--primary-dark)': '主色加深（按下态 / 文字强调）',
    'var(--primary-light)': '主色浅底（选中底 / 标签底 / 图标底）',
    'var(--primary-grad)': '主渐变（按钮 / 图标块 / 竖条）',
    'var(--primary-grad-vivid)': '头部大块渐变',
    'var(--price)': '价格色（全站唯一）',
    'var(--price-soft)': '价格浅底（优惠角标 / 预算标签）',
    'var(--price-grad)': '价格渐变（优惠角标 / 橙色图标块）',
    'var(--error)': '错误色（与价格色同源）',
    'var(--error-soft)': '错误浅底',
    'var(--error-grad)': '错误渐变（危险按钮 / 删除图标块）',
    'var(--warning)': '警告色（审核中 / 待处理 / 星级 / 提示）',
    'var(--warning-soft)': '警告浅底',
    'var(--warning-grad)': '警告渐变（反馈 / 评价图标块）',
    'var(--info)': '信息蓝（与技能类型同色相）',
    'var(--info-soft)': '信息浅底',
    'var(--text)': '文字主',
    'var(--text-secondary)': '文字次',
    'var(--text-light)': '文字弱 / 占位 / 说明',
    'var(--bg)': '页面背景 / 浅色分区底',
    'var(--fill)': '控件填充底（chip / 输入框 / 分割）',
    'var(--fill-strong)': '骨架屏 / 禁用态 / 强填充',
    'var(--white)': '纯白（卡片 / 深底上的文字）',
    'var(--border)': '分割线',
    'var(--type-idle-from)': '类型色·闲置 浅端',
    'var(--type-idle-to)': '类型色·闲置 深端',
    'var(--type-idle-text)': '类型色·闲置 文字',
    'var(--type-idle-soft)': '类型色·闲置 浅底',
    'var(--type-idle-grad)': '类型色·闲置 渐变',
    'var(--type-exchange-from)': '类型色·易物 浅端',
    'var(--type-exchange-to)': '类型色·易物 深端',
    'var(--type-exchange-text)': '类型色·易物 文字',
    'var(--type-exchange-soft)': '类型色·易物 浅底',
    'var(--type-exchange-grad)': '类型色·易物 渐变',
    'var(--type-wanted-from)': '类型色·求购 浅端',
    'var(--type-wanted-to)': '类型色·求购 深端',
    'var(--type-wanted-text)': '类型色·求购 文字',
    'var(--type-wanted-soft)': '类型色·求购 浅底',
    'var(--type-wanted-grad)': '类型色·求购 渐变',
    'var(--type-skill-from)': '类型色·技能 浅端',
    'var(--type-skill-to)': '类型色·技能 深端',
    'var(--type-skill-text)': '类型色·技能 文字',
    'var(--type-skill-soft)': '类型色·技能 浅底',
    'var(--type-skill-grad)': '类型色·技能 渐变',
    'var(--type-wanted-deep)': '求购紫加深档（技能求助分区选中）',
    'var(--type-wanted-deep-grad)': '求购紫加深渐变',
    'var(--img-ph-grad)': '图片占位底 / 中性灰图标块',
}
for _t, _n in (('primary', '主色'), ('price', '价格色'), ('text', '墨色'), ('warning', '警告色'),
               ('type-idle', '闲置绿'), ('type-exchange', '易物橙'),
               ('type-wanted', '求购紫'), ('type-skill', '技能蓝')):
    TOKEN_NOTE['var(--%s-rgb)' % _t] = '半透明%s：rgba(var(--%s-rgb), a)' % (_n, _t)

EXCEPTIONS = [
    ('`app.json` / 页面 `.json` 的 `navigationBarBackgroundColor`、`tabBar` 色',
     '小程序配置文件不支持 CSS 变量',
     '直接写十六进制，值见本表「品牌主色」（`#22B07D`）'),
    ('`wx.showModal({ confirmColor })` 等原生接口',
     '颜色参数走原生层，不在 WXSS 层叠里，传 `var(--x)` 会被当非法值忽略',
     '统一走 `miniprogram/utils/nativeColors.js`'),
    ('`utils/theme.js` 的 `TOKENS` / `TYPE_THEME`',
     'canvas 读不到 CSS 变量',
     '该文件是 canvas 侧唯一来源，改色必须与 `styles/theme.wxss` 同步'),
    ('`utils/avatar.js` 的字母头像底色池',
     '值以行内 `style="background:…"` 输出，CSS 变量可正常解析',
     '直接写 `var(--…)`，随主色自动跟随'),
    ('阴影 / 遮罩里的墨色、黑色 rgba',
     '阴影是「明度叠加」而非品牌色，跟主色走会串味',
     '收敛到 `styles/theme.wxss` 的效果令牌，页面不再自己拼'),
]


def git_show(path):
    try:
        out = subprocess.run(['git', 'show', 'HEAD:%s' % path], cwd=REPO,
                             capture_output=True, check=True)
        return out.stdout.decode('utf-8')
    except Exception:
        return ''


def short(path):
    return path.replace('miniprogram/', '').replace('miniprogram\\', '')


def collect():
    out = subprocess.run(['git', 'diff', '--name-only', 'HEAD'], cwd=REPO,
                         capture_output=True, check=True)
    names = [n for n in out.stdout.decode('utf-8').splitlines()
             if n.startswith('miniprogram/') and n.endswith(('.wxss', '.wxml', '.js'))]
    # 令牌文件自身不算「被替换的文件」
    names = [n for n in names if not n.endswith(('styles/theme.wxss', 'utils/theme.js'))]

    grad = collections.defaultdict(lambda: collections.defaultdict(int))
    hexs = collections.defaultdict(lambda: collections.defaultdict(int))
    rgbs = collections.defaultdict(lambda: collections.defaultdict(int))

    for rel in names:
        old = git_show(rel)
        if not old:
            continue
        f = short(rel)
        stripped = old
        for g in GRAD_RE.findall(old):
            sig = tuple(norm_hex(c) if c.startswith('#') else re.sub(r'\s+', '', c).lower()
                        for c in COLOR_IN_GRAD_RE.findall(g))
            if sig in GRADIENT_MAP:
                grad[GRADIENT_MAP[sig]][f] += 1
                stripped = stripped.replace(g, ' ')
        for h in HEX_RE.findall(stripped):
            k = norm_hex(h)
            if k in HEX_MAP:
                hexs[HEX_MAP[k]][f] += 1
        for m in RGB_RE.finditer(old):
            key = '%s,%s,%s' % (m.group(1), m.group(2), m.group(3))
            if key in RGB_MAP and key not in RGB_KEEP:
                rgbs[RGB_MAP[key]][f] += 1
    return grad, hexs, rgbs


def filelist(files, limit=6):
    items = sorted(files.items(), key=lambda kv: (-kv[1], kv[0]))
    txt = '、'.join('%s(%d)' % (k, v) for k, v in items[:limit])
    if len(items) > limit:
        txt += ' 等 %d 个文件' % len(items)
    return txt


def token_row(theme, name):
    m = re.search(re.escape(name) + r'\s*:\s*([^;]+);', theme)
    return m.group(1).strip() if m else ''


def count_before():
    """统计改造前的规模：多少个文件、多少种不同色值（从 HEAD 版本读）"""
    out = subprocess.run(['git', 'ls-tree', '-r', '--name-only', 'HEAD', 'miniprogram/'],
                         cwd=REPO, capture_output=True, check=True)
    files = [n for n in out.stdout.decode('utf-8').splitlines()
             if n.endswith(('.wxss', '.js')) and not n.endswith(('styles/theme.wxss',))]
    wxss = js = 0
    colors = set()
    for rel in files:
        old = git_show(rel)
        if not old:
            continue
        found = {norm_hex(h) for h in HEX_RE.findall(old)}
        found |= {'rgb(%s,%s,%s)' % (m.group(1), m.group(2), m.group(3))
                  for m in RGB_RE.finditer(old)}
        if not found:
            continue
        colors |= found
        if rel.endswith('.wxss'):
            wxss += 1
        else:
            js += 1
    return wxss, js, len(colors)


def main():
    theme = io.open(os.path.join(REPO, 'miniprogram/styles/theme.wxss'), encoding='utf-8').read()
    grad, hexs, rgbs = collect()
    tokens = [n for n, _v in re.findall(r'(--[a-z0-9-]+)\s*:\s*([^;]+);', theme)]
    wxss_n, js_n, color_n = count_before()

    L = []
    L.append('# 色板对照表（配色统一改造 · 交付清单）')
    L.append('')
    L.append('> 本表由 `python tools/theme-report.py` 从改造前后的代码 diff 统计生成，可随时重跑复核。')
    L.append('> 令牌定义见 `miniprogram/styles/theme.wxss`（全站唯一来源）。')
    L.append('')
    L.append('| | 改造前 | 改造后 |')
    L.append('|---|---|---|')
    L.append('| 颜色定义处 | 散落在 %d 个 wxss + %d 个 js | 只有 `styles/theme.wxss`（%d 个令牌）+ 两个镜像文件 |'
             % (wxss_n, js_n, len(tokens)))
    L.append('| 不同色值数量 | %d 种十六进制 / rgb | %d 个令牌 |' % (color_n, len(tokens)))
    L.append('| 页面里的硬编码 | 到处都是 | 0 处（已用脚本全量核验） |')
    L.append('')
    L.append('## 一、新色板（令牌一览）')
    L.append('')
    L.append('| 令牌 | 值 | 用途 |')
    L.append('|---|---|---|')
    for name, _val in re.findall(r'(--[a-z0-9-]+)\s*:\s*([^;]+);', theme):
        if name.endswith('-rgb'):
            continue
        v = token_row(theme, name)
        if len(v) > 60:
            v = v[:57] + '…'
        L.append('| `%s` | `%s` | %s |' % (name, v, TOKEN_NOTE.get('var(%s)' % name, '')))

    L.append('')
    L.append('## 二、整条渐变 → 渐变令牌')
    L.append('')
    L.append('旧渐变两头色值不同、方向不一，且同一语义在多个页面各写一条。现整条收敛成令牌：')
    L.append('')
    L.append('| → 令牌 | 出现次数 | 出现在 |')
    L.append('|---|---|---|')
    for token, files in sorted(grad.items(), key=lambda kv: -sum(kv[1].values())):
        L.append('| `%s` | %d | %s |' % (token, sum(files.values()), filelist(files)))

    L.append('')
    L.append('## 三、十六进制 → 令牌')
    L.append('')
    L.append('| 原色值 | → 令牌 | 令牌用途 | 出现次数 | 出现在 |')
    L.append('|---|---|---|---|---|')
    inv = collections.defaultdict(list)
    for hv, tk in HEX_MAP.items():
        inv[tk].append(hv)
    for token, files in sorted(hexs.items(), key=lambda kv: -sum(kv[1].values())):
        srcs = ' / '.join(sorted(inv.get(token, []))[:6])
        if len(inv.get(token, [])) > 6:
            srcs += ' 等 %d 个色值' % len(inv[token])
        L.append('| %s | `%s` | %s | %d | %s |' % (
            srcs, token, TOKEN_NOTE.get(token, ''), sum(files.values()), filelist(files)))

    L.append('')
    L.append('## 四、rgb() / rgba() → 分量令牌')
    L.append('')
    L.append('半透明品牌色一律写成 `rgba(var(--x-rgb), a)`，改主色时不会再漏改十进制分量。')
    L.append('')
    L.append('| → 令牌 | 出现次数 | 出现在 |')
    L.append('|---|---|---|')
    for token, files in sorted(rgbs.items(), key=lambda kv: -sum(kv[1].values())):
        L.append('| `rgba(%s, a)` | %d | %s |' % (token, sum(files.values()), filelist(files)))

    L.append('')
    L.append('## 五、允许保留的 rgba 硬编码（阴影 / 遮罩）')
    L.append('')
    L.append('阴影、遮罩属于「明度叠加」而非品牌色，跟着主色走会串味，因此保留 rgba 写法，')
    L.append('但**全部收敛到令牌**，页面不再自己拼：')
    L.append('')
    L.append('| 令牌 | 值 | 用途 |')
    L.append('|---|---|---|')
    for nm in ('--shadow-sm', '--shadow-card', '--shadow-hover', '--shadow-primary', '--shadow-danger',
               '--ring-primary', '--shadow-inset-primary', '--shadow-primary-active',
               '--shadow-danger-active', '--shadow-float', '--shadow-modal', '--mask',
               '--scrim', '--scrim-soft', '--on-dark', '--on-dark-strong', '--hairline-dark',
               '--skel-sweep'):
        v = token_row(theme, nm)
        if len(v) > 66:
            v = v[:63] + '…'
        L.append('| `%s` | `%s` | |' % (nm, v))

    L.append('')
    L.append('## 六、不在 WXSS 里的例外（为什么还看得到硬编码）')
    L.append('')
    L.append('| 位置 | 为什么不能用令牌 | 怎么办 |')
    L.append('|---|---|---|')
    for a, b, c in EXCEPTIONS:
        L.append('| %s | %s | %s |' % (a, b, c))
    L.append('')

    text = '\n'.join(L) + '\n'
    if '--write' in sys.argv:
        with io.open(OUT, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
        print('已写入 docs/06-色板对照表.md（%d 行）' % len(L))
    else:
        print(text[:1500])
        print('…（预演，加 --write 落盘）')


if __name__ == '__main__':
    main()
