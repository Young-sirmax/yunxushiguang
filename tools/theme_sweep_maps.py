# -*- coding: utf-8 -*-
"""
tools/theme_sweep_maps.py —— 配色收敛的映射表（色板对照表的唯一数据源）

被两个脚本共用：
  theme-sweep.py   按这张表做替换
  theme-report.py  按这张表生成 docs/06-色板对照表.md
"""

import re


def norm_hex(h):
    """#abc -> #aabbcc，便于统一比对"""
    h = h.lower()
    if len(h) == 4:
        return '#' + h[1] * 2 + h[2] * 2 + h[3] * 2
    return h



GRADIENT_MAP = {
    # 主色
    ('#00c17e', '#3be6ad'): 'var(--primary-grad)',
    ('#3be6ad', '#00c17e'): 'var(--primary-grad)',
    ('#3be6ad', '#00c17e', '#00b3a3'): 'var(--primary-grad)',
    ('#3ce8b2', '#00c17e', '#00a9c4'): 'var(--primary-grad-vivid)',
    ('#43e97b', '#38d9f9'): 'var(--primary-grad)',
    # 价格 / 错误（同源）
    ('#f43f5e', '#ff7a8a'): 'var(--error-grad)',
    ('#f43f5e', '#ff8a80'): 'var(--error-grad)',
    ('#f43f5e', '#ff7a80'): 'var(--error-grad)',
    ('#f5402f', '#ff6a52'): 'var(--error-grad)',
    ('#ff6b35', '#ff9900'): 'var(--price-grad)',
    ('#ff7a59', '#ffb347'): 'var(--price-grad)',
    ('#ff7a59', '#ff8a00', '#ffb347'): 'var(--price-grad)',
    # 技能蓝（含旧的信息蓝、青蓝）
    ('#4facfe', '#00c6fb'): 'var(--type-skill-grad)',
    ('#84c1ff', '#a1c4fd'): 'var(--type-skill-grad)',
    ('#a1c4fd', '#84c1ff'): 'var(--type-skill-grad)',
    ('#d3e2ff', '#dfeaff'): 'linear-gradient(135deg, var(--type-skill-soft) 0%, var(--bg) 100%)',
    # 易物橙
    ('#ff9a76', '#ffd194'): 'var(--type-exchange-grad)',
    ('#ff9a76', '#ffd194', '#ffd194'): 'var(--type-exchange-grad)',
    ('#ffdcc9', '#ffe6d8'): 'linear-gradient(135deg, var(--type-exchange-soft) 0%, var(--bg) 100%)',
    # 求购紫
    ('#a18cd1', '#fbc2eb'): 'var(--type-wanted-grad)',
    ('#a18cd1', '#7c6cf0'): 'var(--type-wanted-grad)',
    ('#9d7ee0', '#6a4bc4'): 'var(--want-deep-grad)',
    # 闲置绿青
    ('#00a8a0', '#2dd8c0'): 'var(--type-idle-grad)',
    # 警告黄（旧阳光黄也归到这里，不再另立色相）
    ('#ffb020', '#ffd968'): 'var(--warning-grad)',
    ('#ff9a3c', '#ffd93d'): 'var(--warning-grad)',
    ('#ff9a3c', '#ffd166'): 'var(--warning-grad)',
    # 中性（骨架 / 图片占位 / 禁用）
    ('#8b98ab', '#b8c2d0'): 'var(--img-ph-grad)',
    ('#e8e8ef', '#f5f7fa'): 'var(--img-ph-grad)',
    ('#e9f2ee', '#f4f8f6'): 'var(--img-ph-grad)',
    ('#b8e6cc', '#c8e6d4'): 'linear-gradient(135deg, var(--fill-strong) 0%, var(--fill) 100%)',
    ('#b7dfdb', '#c6e6e2'): 'linear-gradient(135deg, var(--type-idle-soft) 0%, var(--bg) 100%)',
    # 极浅品牌底
    ('#d5f2e6', '#e5f8f1'): 'linear-gradient(135deg, var(--primary-light) 0%, var(--bg) 100%)',
    ('#e0f8ef', '#eef5f1'): 'linear-gradient(135deg, var(--primary-light) 0%, var(--bg) 100%)',
    ('#e8f8ef', '#f0faf3'): 'linear-gradient(135deg, var(--primary-light) 0%, var(--bg) 100%)',
    ('#e5f8f1', '#f0f7f3'): 'linear-gradient(135deg, var(--primary-light) 0%, var(--bg) 100%)',
    ('#e8f8ef', '#f0f9f4'): 'linear-gradient(135deg, var(--primary-light) 0%, var(--bg) 100%)',
    ('#f0fbf6', '#f5f7fa'): 'linear-gradient(180deg, var(--primary-light) 0%, var(--bg) 360rpx)',
    ('#f2fdf8', '#ffffff'): 'linear-gradient(180deg, var(--primary-light) 0%, var(--white) 70%)',
    # 极浅警告底
    ('#ffe0b2', '#fff3e0'): 'linear-gradient(135deg, var(--warning-soft) 0%, var(--bg) 100%)',
    ('#fff3e0', '#fff8f0'): 'linear-gradient(135deg, var(--warning-soft) 0%, var(--bg) 100%)',
    ('#ffe0c0', '#fff3e0'): 'linear-gradient(135deg, var(--warning-soft) 0%, var(--bg) 100%)',
    ('#fffdf5', '#ffffff'): 'linear-gradient(180deg, var(--warning-soft) 0%, var(--white) 60%)',
}

RGB_MAP = {
    '0,193,126': 'var(--primary-rgb)',
    '7,193,96': 'var(--primary-rgb)',
    '34,176,125': 'var(--primary-rgb)',
    '0,157,117': 'var(--primary-rgb)',
    # 深绿墨色：主色按钮底下的投影，按墨色处理
    '0,40,25': 'var(--text-rgb)',
    '0,60,40': 'var(--text-rgb)',
    '15,27,45': 'var(--text-rgb)',
    '31,35,41': 'var(--text-rgb)',
    '10,22,38': 'var(--text-rgb)',
    # 价格 / 错误
    '244,63,94': 'var(--price-rgb)',
    '245,64,47': 'var(--price-rgb)',
    '255,77,79': 'var(--price-rgb)',
    '255,107,53': 'var(--price-rgb)',
    # 警告
    '255,176,32': 'var(--warning-rgb)',
    '255,197,61': 'var(--warning-rgb)',
    '255,213,104': 'var(--warning-rgb)',
    '245,166,35': 'var(--warning-rgb)',
    '255,138,0': 'var(--warning-rgb)',
    # 类型色
    '161,140,209': 'var(--type-wanted-rgb)',
    '124,92,191': 'var(--type-wanted-rgb)',
    '132,193,255': 'var(--type-skill-rgb)',
    '74,144,226': 'var(--type-skill-rgb)',
    '255,154,118': 'var(--type-exchange-rgb)',
    '78,205,196': 'var(--type-idle-rgb)',
    # 旧主色的浅端（首页光斑）
    '60,232,190': 'var(--primary-rgb)',
    '64,255,190': 'var(--primary-rgb)',
}

RGB_KEEP = {
    '255,255,255', '0,0,0',
}

HEX_MAP = {
    # ---- 品牌主色 ----
    '#00c17e': 'var(--primary)', '#22b07d': 'var(--primary)',
    '#00a76b': 'var(--primary-dark)', '#14915f': 'var(--primary-dark)',
    '#3be6ad': 'var(--primary)', '#3ce8b2': 'var(--primary)',
    '#35c592': 'var(--primary)', '#2fc08d': 'var(--primary)',
    '#00b3a3': 'var(--primary-dark)', '#00a9c4': 'var(--primary-dark)',
    '#cde7d8': 'var(--fill-strong)', '#c2e2d0': 'var(--fill-strong)',
    # 主色浅底
    '#e0f8ef': 'var(--primary-light)', '#e9f7f0': 'var(--primary-light)',
    '#e5f8f1': 'var(--primary-light)', '#f0fbf6': 'var(--primary-light)',
    '#f0f7f3': 'var(--primary-light)', '#e8f8ef': 'var(--primary-light)',
    '#f2fdf8': 'var(--primary-light)', '#f2fbf7': 'var(--primary-light)',
    '#f0faf3': 'var(--primary-light)', '#f0f9f4': 'var(--primary-light)',
    '#eef5f1': 'var(--primary-light)', '#e9f2ee': 'var(--primary-light)',
    '#d5f2e6': 'var(--primary-light)', '#b8e6cc': 'var(--primary-light)',
    '#c8e6d4': 'var(--primary-light)', '#e6f7f2': 'var(--type-idle-soft)',
    '#d7f5e9': 'var(--primary-light)',
    # ---- 闲置绿青（类型色）----
    '#7ee8c7': 'var(--type-idle-from)', '#4ecdc4': 'var(--type-idle-to)',
    '#00a8a0': 'var(--type-idle-text)', '#00b3a6': 'var(--type-idle-text)',
    '#2dd8c0': 'var(--type-idle-text)', '#00a89b': 'var(--type-idle-text)',
    '#e0f7f5': 'var(--type-idle-soft)', '#c6e6e2': 'var(--type-idle-soft)',
    '#b7dfdb': 'var(--type-idle-soft)',
    # ---- 价格 / 错误（同源）----
    '#ff7a59': 'var(--price)', '#ff6b35': 'var(--price)',
    '#f5402f': 'var(--price)', '#ff9900': 'var(--price)',
    '#ff8a00': 'var(--price)', '#ff9a3c': 'var(--price)',
    '#e65100': 'var(--price)', '#bf360c': 'var(--price)',
    '#c2410c': 'var(--price)', '#b45309': 'var(--price)',
    '#7a4a00': 'var(--price)', '#7a4d00': 'var(--price)',
    '#e08c00': 'var(--price)',
    '#f43f5e': 'var(--error)', '#ef4444': 'var(--error)',
    '#e11d48': 'var(--error)', '#ff7a8a': 'var(--error)',
    '#ff8a80': 'var(--error)', '#ff7a80': 'var(--error)',
    '#fff1ec': 'var(--price-soft)', '#fdeef1': 'var(--error-soft)',
    # 价格浅底
    '#fff3e0': 'var(--price-soft)', '#ffe0b2': 'var(--price-soft)',
    '#fff8f0': 'var(--price-soft)', '#fff2e6': 'var(--price-soft)',
    '#ffe0c0': 'var(--price-soft)',
    # ---- 警告黄 ----
    '#ffb020': 'var(--warning)', '#f5a623': 'var(--warning)',
    '#f59e0b': 'var(--warning)', '#ffc53d': 'var(--warning)',
    '#ffd93d': 'var(--warning)', '#ffd968': 'var(--warning)',
    '#ffd166': 'var(--warning)', '#ffb347': 'var(--warning)',
    '#ffb74d': 'var(--warning)', '#ffd700': 'var(--warning)',
    '#ffe08a': 'var(--warning)',
    '#fff7e6': 'var(--warning-soft)', '#fef3c7': 'var(--warning-soft)',
    '#fff8e6': 'var(--warning-soft)', '#fff8e1': 'var(--warning-soft)',
    '#fff6d9': 'var(--warning-soft)', '#fffdf5': 'var(--warning-soft)',
    '#ffeaa7': 'var(--warning-soft)',
    # ---- 求购紫（类型色）----
    '#c7b9ff': 'var(--type-wanted-from)', '#c9beff': 'var(--type-wanted-from)',
    '#a18cd1': 'var(--type-wanted-to)', '#a78bfa': 'var(--type-wanted-to)',
    '#f1ecfd': 'var(--type-wanted-soft)', '#f1ecfe': 'var(--type-wanted-soft)',
    '#f6f3ff': 'var(--type-wanted-soft)',
    '#7c5cbf': 'var(--want-deep)', '#9d7ee0': 'var(--want-deep)',
    '#ece5fa': 'var(--want-deep-soft)',
    # ---- 易物橙（类型色）----
    '#ffd194': 'var(--type-exchange-from)', '#ffb37b': 'var(--type-exchange-to)',
    '#ff9a76': 'var(--type-exchange-to)', '#e8734a': 'var(--type-exchange-text)',
    '#c4763c': 'var(--type-exchange-text)',
    '#fff3e8': 'var(--type-exchange-soft)', '#ffe6d8': 'var(--type-exchange-soft)',
    '#ffdcc9': 'var(--type-exchange-soft)',
    # ---- 技能蓝 / 信息蓝（类型色）----
    '#a1c4fd': 'var(--type-skill-from)', '#84c1ff': 'var(--type-skill-to)',
    '#7fb3ff': 'var(--type-skill-to)', '#4a90e2': 'var(--type-skill-text)',
    '#4facfe': 'var(--type-skill-text)', '#00c6fb': 'var(--type-skill-text)',
    '#38d9f9': 'var(--type-skill-text)', '#4c86d9': 'var(--type-skill-text)',
    '#3b82f6': 'var(--info)', '#7c6cf0': 'var(--type-wanted-to)',
    '#eaf3ff': 'var(--type-skill-soft)', '#ebf3ff': 'var(--type-skill-soft)',
    '#edf4ff': 'var(--info-soft)', '#e7f2fc': 'var(--type-skill-soft)',
    '#d3e2ff': 'var(--type-skill-soft)', '#dfeaff': 'var(--type-skill-soft)',
    # ---- 中性：文字 ----
    '#0f1b2d': 'var(--text)', '#1a1a2e': 'var(--text)', '#14202f': 'var(--text)',
    '#1f2329': 'var(--text)',
    '#5a6b7f': 'var(--text-secondary)', '#555566': 'var(--text-secondary)',
    '#4a5a6e': 'var(--text-secondary)', '#3e4e62': 'var(--text-secondary)',
    '#7b8a9c': 'var(--text-secondary)', '#646a73': 'var(--text-secondary)',
    '#7c8ba1': 'var(--text-secondary)',
    '#94a3b8': 'var(--text-light)', '#9999aa': 'var(--text-light)',
    '#777788': 'var(--text-light)', '#b0b0c0': 'var(--text-light)',
    '#9aa0a6': 'var(--text-light)', '#98a4b3': 'var(--text-light)',
    '#aeb8c4': 'var(--text-light)', '#b8c2d0': 'var(--text-light)',
    '#8b98ab': 'var(--text-light)', '#aaa': 'var(--text-light)',
    '#bbb': 'var(--text-light)', '#999': 'var(--text-light)',
    '#666': 'var(--text-secondary)', '#555': 'var(--text-secondary)',
    '#9ca3af': 'var(--text-light)',
    # ---- 中性：背景 / 填充 / 分割线 ----
    '#ffffff': 'var(--white)', '#fff': 'var(--white)',
    '#f5f7fa': 'var(--bg)', '#fafafa': 'var(--bg)', '#f8f8f8': 'var(--bg)',
    '#f7f9fc': 'var(--bg)', '#f7f9fb': 'var(--bg)', '#fafbfd': 'var(--bg)',
    '#f8f9fb': 'var(--bg)', '#f8f8fa': 'var(--bg)', '#f6f8fb': 'var(--bg)',
    '#f6f7f9': 'var(--bg)',
    '#f1f5f9': 'var(--fill)', '#eef1f5': 'var(--fill)',
    '#f2f4f7': 'var(--fill)', '#f5f5fa': 'var(--fill)',
    '#f3f5f8': 'var(--fill)', '#f0f3f7': 'var(--fill)',
    '#f0f0f5': 'var(--fill)', '#e8e8ef': 'var(--fill)',
    '#eff0f2': 'var(--border)',
    '#eef2f6': 'var(--fill-strong)', '#e8ecf1': 'var(--fill-strong)',
    '#e5e7eb': 'var(--fill-strong)', '#e2e8f0': 'var(--fill-strong)',
    '#d8dee8': 'var(--fill-strong)', '#d7dee8': 'var(--fill-strong)',
    '#dde4ec': 'var(--fill-strong)', '#d7dee6': 'var(--fill-strong)',
    '#c8d0dc': 'var(--fill-strong)', '#d0d0d8': 'var(--fill-strong)',
    '#cccce0': 'var(--fill-strong)', '#e0e0e0': 'var(--fill-strong)',
    '#f0f0f0': 'var(--fill-strong)', '#c0c0c0': 'var(--fill-strong)',
    '#f8fafc': 'var(--bg)', '#f4f8f6': 'var(--bg)',
    '#555555': 'var(--text-secondary)', '#666666': 'var(--text-secondary)',
    '#aaaaaa': 'var(--text-light)', '#bbbbbb': 'var(--text-light)',
    '#b0b8c4': 'var(--text-light)', '#7c7a99': 'var(--text-light)',
    '#4b3f8f': 'var(--want-deep)',
    '#6d4fdc': 'var(--type-wanted-to)',
    '#d97706': 'var(--warning)',
}
