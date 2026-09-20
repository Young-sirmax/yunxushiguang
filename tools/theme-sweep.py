# -*- coding: utf-8 -*-
"""
tools/theme-sweep.py —— 全站配色收敛工具（一次性）

作用：把散落在 wxss / js 里的十六进制色值与 rgb()/rgba() 硬编码，
按 miniprogram/styles/theme.wxss 的令牌表统一替换。

为什么要用脚本而不是手改：
  24 个 wxss 共约 200 个不同色值、1000+ 处出现，手改必然漏、必然手抖。
  脚本的映射表就是「色板对照表」本身，可复查、可回滚、可重跑。

替换顺序（顺序不能换）：
  1) 整条渐变 → 单个渐变令牌（否则逐色替换会把渐变拆成同色两端）
  2) rgba() → rgba(var(--x-rgb), a)
  3) 十六进制 → 令牌
  4) 报告剩余未映射色值（人工判断）

用法：python tools/theme-sweep.py            # 预演，只报告不落盘
      python tools/theme-sweep.py --write    # 真正写入
"""
import io
import os
import re
import sys
import collections

from theme_sweep_maps import GRADIENT_MAP, HEX_MAP, RGB_MAP, RGB_KEEP, norm_hex

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'miniprogram')

# ============================================================
# 1) 整条渐变 → 渐变令牌
#    key = 按出现顺序排列的 stop 颜色（小写、去空格）；命中则整条替换
#    只列「含品牌色」的渐变；纯白/纯黑的浮层渐变不在此列，原样保留
# ============================================================

# 双色渐变的 stop 顺序在源码里可能颠倒，签名查询时做一次双向兜底
GRADIENT_MAP_REVERSED = {}
for _k, _v in list(GRADIENT_MAP.items()):
    if len(_k) == 2 and (_k[1], _k[0]) not in GRADIENT_MAP:
        GRADIENT_MAP_REVERSED[(_k[1], _k[0])] = _v
GRADIENT_MAP.update(GRADIENT_MAP_REVERSED)

# ============================================================
# 2) rgb()/rgba() 三分量 → RGB 分量令牌
# ============================================================

# 保持不变的 rgba（白色高光 / 黑色阴影与遮罩）：非品牌色，是明度叠加

# ============================================================
# 3) 十六进制 → 令牌
# ============================================================

GRAD_RE = re.compile(r'(?:linear|radial)-gradient\((?:[^()]|\([^()]*\))*\)')
COLOR_IN_GRAD_RE = re.compile(r'#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)')
RGB_RE = re.compile(r'\brgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)')
HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')


def grad_signature(text):
    """把一条渐变里的颜色按出现顺序取出，作为映射表的 key"""
    colors = []
    for c in COLOR_IN_GRAD_RE.findall(text):
        if c.startswith('#'):
            colors.append(norm_hex(c))
        else:
            colors.append(re.sub(r'\s+', '', c).replace('rgba(', 'rgba(').lower())
    return tuple(colors)


def replace_gradients(text, stats):
    def sub(m):
        raw = m.group(0)
        sig = grad_signature(raw)
        if sig in GRADIENT_MAP:
            stats['gradient'] += 1
            return GRADIENT_MAP[sig]
        return raw
    return GRAD_RE.sub(sub, text)


def replace_rgb(text, stats):
    def sub(m):
        key = '%s,%s,%s' % (m.group(1), m.group(2), m.group(3))
        if key in RGB_KEEP:
            return m.group(0)
        if key not in RGB_MAP:
            return m.group(0)
        stats['rgb'] += 1
        alpha = m.group(4)
        if alpha is None:
            # rgb() 无 alpha：换成 rgb(var(--x-rgb))
            return 'rgb(%s)' % RGB_MAP[key]
        return 'rgba(%s, %s)' % (RGB_MAP[key], alpha)
    return RGB_RE.sub(sub, text)


def replace_hex(text, stats):
    def sub(m):
        h = norm_hex(m.group(0))
        if h not in HEX_MAP:
            return m.group(0)
        stats['hex'] += 1
        return HEX_MAP[h]
    return HEX_RE.sub(sub, text)


def process(path, write):
    with io.open(path, encoding='utf-8') as f:
        src = f.read()
    stats = collections.Counter()
    out = replace_gradients(src, stats)
    out = replace_rgb(out, stats)
    out = replace_hex(out, stats)
    if out == src:
        return None
    if write:
        with io.open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(out)
    return stats, out


def main():
    write = '--write' in sys.argv
    targets = []
    # 令牌文件自身就是色值的定义处，不参与替换
    SKIP = {'styles/theme.wxss', 'utils/theme.js'}
    for dirpath, _dirs, files in os.walk(ROOT):
        for fn in files:
            if not fn.endswith(('.wxss', '.wxml', '.js')):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), ROOT).replace('\\', '/')
            if rel in SKIP:
                continue
            targets.append(os.path.join(dirpath, fn))
    targets.sort()

    total = collections.Counter()
    changed = []
    left = collections.Counter()
    for path in targets:
        res = process(path, write)
        rel = os.path.relpath(path, ROOT)
        # 复扫时看的是「替换后」的内容（预演模式下就是内存里的结果）
        txt = res[1] if res else io.open(path, encoding='utf-8').read()
        for m in HEX_RE.findall(txt):
            left['%s  <- %s' % (norm_hex(m), rel)] += 1
        for m in RGB_RE.findall(txt):
            key = '%s,%s,%s' % (m[0], m[1], m[2])
            if key in RGB_KEEP:
                continue
            left['rgb(%s)  <- %s' % (key, rel)] += 1
        if res:
            stats = res[0]
            total.update(stats)
            changed.append((rel, stats))

    print('=== 替换统计（%d 个文件）===' % len(changed))
    for rel, st in changed:
        print('  %-58s 渐变 %-3d rgba %-3d hex %-3d' % (rel, st['gradient'], st['rgb'], st['hex']))
    print('  合计：渐变 %d / rgba %d / hex %d' % (total['gradient'], total['rgb'], total['hex']))
    if not write:
        print('\n（预演模式，未写入。加 --write 落盘）')

    print('\n=== 剩余未映射色值（需人工判断）===')
    for k, v in sorted(left.items()):
        print('  %-70s x%d' % (k, v))
    if not left:
        print('  （无）')


if __name__ == '__main__':
    main()
