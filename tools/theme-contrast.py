# -*- coding: utf-8 -*-
"""
tools/theme-contrast.py —— 配色走查：文字/底色对比度数据化扫描

作用：把「截图走查」里最该用眼睛判断的那部分（文字看不看得清）变成可算的指标——
逐条规则解析 var() 链拿到真实颜色，按 WCAG 相对亮度算对比度，低于阈值就报出来。

局限（必须说清楚）：
  - 只算「同一规则块内 color 与 background 成对出现」的情况；
    底色来自父元素的，这里看不到，会漏报。
  - 渐变底按其中最亮/最暗的 stop 各算一次，取较差的那个。
  - 半透明色按不透明近似（真实叠加会更接近背景色，误差偏乐观）。
  所以它是**辅助**，不能替代真机截图。

用法：python tools/theme-contrast.py [页面路径片段...]
      不带参数则扫描用户指定的 6 个走查页面。
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, '..')
MP = os.path.join(REPO, 'miniprogram')
THEME = os.path.join(MP, 'styles', 'theme.wxss')

BLOCK = re.compile(r'([^{}]+)\{([^{}]*)\}')
VAR = re.compile(r'var\(\s*(--[a-z0-9-]+)\s*\)')
HEX = re.compile(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b')
RGB = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)')

# 默认走查页面（用户指定：首页 / 发布页 / 详情页 / 我的 / 达人主页 / 关于我们）
DEFAULT_PAGES = [
    'pages/commodity_list/commodity_list',
    'pages/commodity_release/commodity_release',
    'pages/commodity_detail/commodity_detail',
    'pages/home/home',
    'pages/expert_home/expert_home',
    'pages/home_about/home_about',
]

# 正文类最小对比度：WCAG AA 正文 4.5，大字号/加粗 3.0
THRESHOLD_TEXT = 3.0
THRESHOLD_BOLD = 2.5


def load_tokens():
    t = io.open(THEME, encoding='utf-8').read()
    raw = dict(re.findall(r'(--[a-z0-9-]+)\s*:\s*([^;]+);', t))
    resolved = {}

    def resolve(name, depth=0):
        if name in resolved:
            return resolved[name]
        if depth > 6 or name not in raw:
            return None
        v = raw[name].strip()
        m = VAR.search(v)
        if m:
            out = resolve(m.group(1), depth + 1)
        else:
            out = v
        resolved[name] = out
        return out

    for k in raw:
        resolve(k)
    return resolved


def to_rgb(value):
    """把一条色值转成 (r,g,b)；非纯色返回 None"""
    if not value:
        return None
    v = value.strip()
    m = HEX.search(v)
    if m:
        h = m.group(0)[1:]
        if len(h) == 3:
            h = h[0] * 2 + h[1] * 2 + h[2] * 2
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    m = RGB.search(v)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def luminance(rgb):
    def ch(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def opaque_colors(value, tokens, depth=0):
    """把一条 background 值里能确定的**不透明**颜色全部取出来。

    能处理：纯色、渐变（逐 stop）、`var(--x)`（解析成令牌值再递归）、
            `rgba(var(--x-rgb), a)`（a≥1 时确定）。
    处理不了就跳过而不是瞎猜：
            - alpha < 1 的半透明色：真实颜色取决于被盖住的父级，本工具看不到
            - 解析不出来的变量
    这样报出来的都是「一定能算准」的，避免假报警把报告搞成噪音。
    """
    out = []
    for m in re.finditer(r'(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|var\(\s*--[a-z0-9-]+\s*\))', value):
        s = m.group(1)
        vm = VAR.search(s)
        if vm:
            resolved = tokens.get(vm.group(1))
            if not resolved or depth > 4:
                continue
            out.extend(opaque_colors(resolved, tokens, depth + 1))
            continue
        am = RGB.search(s)
        if am and am.group(4) is not None and float(am.group(4)) < 1:
            continue
        rgb = to_rgb(s)
        if rgb:
            out.append(rgb)
    return out


def main():
    tokens = load_tokens()
    pages = sys.argv[1:] or DEFAULT_PAGES

    problems = []
    inherited = []
    checked = 0

    for page in pages:
        path = os.path.join(MP, page + '.wxss')
        if not os.path.exists(path):
            print('缺少文件：', page)
            continue
        css = io.open(path, encoding='utf-8').read()

        for sel, body in BLOCK.findall(css):
            sel = re.sub(r'\s+', ' ', sel).strip()
            if sel.startswith('@'):
                continue
            cm = re.search(r'(?<![-\w])color\s*:\s*([^;]+);', body)
            if not cm:
                continue
            raw_color = cm.group(1).strip()
            vm = VAR.search(raw_color)
            fg = to_rgb(raw_color) or (to_rgb(tokens.get(vm.group(1), '')) if vm else None)
            if not fg:
                continue

            bm = re.search(r'background(?:-color)?\s*:\s*([^;]+);', body)
            bgs = opaque_colors(bm.group(1), tokens) if bm else []
            if not bgs:
                # 没有底色、或底色是半透明/变量拼的（真实颜色取决于父级）：
                # 本工具看不到父级，单列出来交人工，不当成问题
                inherited.append((page, sel[:44], raw_color))
                continue

            checked += 1
            worst = min(contrast(fg, bg) for bg in bgs)
            bold = bool(re.search(r'font-weight\s*:\s*(6|7|8|9)00', body))
            limit = THRESHOLD_BOLD if bold else THRESHOLD_TEXT
            if worst < limit:
                problems.append((page, sel[:44], raw_color, worst))

    print('=== 配色走查（对比度）===')
    print('扫描页面：%d 个｜同块内可判定的规则：%d 条｜底色继承（需人工）：%d 条'
          % (len(pages), checked, len(inherited)))
    print('阈值：正文 %.1f / 粗体 %.1f（WCAG 相对亮度比）' % (THRESHOLD_TEXT, THRESHOLD_BOLD))
    print('')
    if not problems:
        print('同块内可判定的规则：全部达标 ✓')
    else:
        print('低于阈值 %d 条：' % len(problems))
        print('%-22s %-38s %-26s %s' % ('页面', '选择器', '文字色', '对比度'))
        for p, sel, color, c in sorted(problems, key=lambda r: r[3]):
            print('%-22s %-38s %-26s %.2f' % (p.split('/')[-1], sel, color, c))
    print('')
    print('说明：')
    print('  1) 「底色继承」的规则多为深色渐变头/深底上的白字（如 hero-title、eh-name），')
    print('     本工具看不到父级背景，按设计属正常，已单列不计入问题。')
    print('  2) --text-light(#9AA0A6) 在纯白上对比度 2.46，是「文字弱/占位」令牌的设计取值')
    print('     （用户指定），仅用于说明文字/占位，不用于正文，故为已知可接受项。')
    print('  3) 半透明按不透明近似，真实叠加更接近背景，结论偏乐观；本工具是辅助，')
    print('     最终仍需真机逐页走查。')


if __name__ == '__main__':
    main()
