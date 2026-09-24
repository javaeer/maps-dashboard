// 地图配色主题
// 同一套几何在不同场合需要不同气质：科技蓝青（展厅大屏）、多彩极光（展示用）、暖色（党政汇报）
// 所有主题统一饱和度/明度，仅拉开色相跨度，保证"丰富而不杂乱"。
// 色相分配使用黄金角（137.508°）递增，使相邻要素色差最大化，避免连片同色。

export const GOLDEN_ANGLE = 137.508

export const THEMES = {
  // 科技蓝青：色域窄、克制的经典大屏配色
  tech: {
    label: '科技蓝青',
    county: { h0: 190, h1: 235, sat: 0.68, lit: 0.55 },
    town: { h0: 150, h1: 205, sat: 0.6, lit: 0.55 },
    countyGlow: 0x6fd8ff,
    townGlow: 0x7cffb0,
    border: 0x9ffcff,
    townBorder: 0xcfffe9
  },
  // 极光多彩：覆盖青绿→蓝→紫→品红的宽色域，色彩最丰富
  aurora: {
    label: '极光多彩',
    county: { h0: 195, h1: 330, sat: 0.62, lit: 0.56 },
    town: { h0: 120, h1: 330, sat: 0.64, lit: 0.56 },
    countyGlow: 0xa8e0ff,
    townGlow: 0xd6ffe9,
    border: 0xbdf0ff,
    townBorder: 0xe6fff2
  },
  // 暖橙霞光：暖色为主，适合偏正式的汇报场景
  sunset: {
    label: '暖橙霞光',
    county: { h0: 330, h1: 410, sat: 0.6, lit: 0.58 },
    town: { h0: 340, h1: 470, sat: 0.62, lit: 0.58 },
    countyGlow: 0xffd0a8,
    townGlow: 0xffe8c0,
    border: 0xffdcbc,
    townBorder: 0xfff0d8
  }
}

export const DEFAULT_THEME = 'aurora'

export function getTheme(name) {
  return THEMES[name] || THEMES[DEFAULT_THEME]
}

// 读取当前主题：优先 URL 参数 ?palette=tech|aurora|sunset，便于现场切换演示
export function resolveTheme() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      const q = new URLSearchParams(window.location.search).get('palette')
      if (q && THEMES[q]) return q
    }
  } catch {
    /* 忽略（非浏览器环境） */
  }
  return DEFAULT_THEME
}

// 按序号生成色相：用黄金比低差异序列（0.618…）在 [h0, h1) 内均匀铺开。
// 注意：不能对窄色域用「黄金角取模」——span 较小时 (idx*137.508)%span 会塌缩成
// 两三个值来回震荡（实测 tech 主题 span=55 只剩 2 种色相）。低差异序列对任意
// span 都能保持均匀分散，且相邻序号的色差足够大。
export function themeColor(spec, idx) {
  const span = (spec.h1 - spec.h0) || 360
  const frac = (idx * 0.618033988749895) % 1
  const h = (spec.h0 + frac * span) % 360
  // 明度做微小错层，让平面更有层次（不影响主色相）
  const lit = spec.lit + ((idx % 3) - 1) * 0.02
  return { h: h / 360, s: spec.sat, l: lit }
}
