// 数值格式化工具

// 人口输入单位为“万人”
export function formatPopulation(wan) {
  if (wan == null || isNaN(wan)) return '—'
  if (wan >= 10000) return (wan / 10000).toFixed(2) + ' 亿人'
  return wan.toFixed(1) + ' 万人'
}

// 面积输入单位为 km²
export function formatArea(km2) {
  if (km2 == null || isNaN(km2)) return '—'
  if (km2 >= 10000) return (km2 / 10000).toFixed(2) + ' 万 km²'
  return Number(km2).toLocaleString('zh-CN') + ' km²'
}

export function formatNumber(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString('zh-CN')
}
