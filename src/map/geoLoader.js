// 从阿里 DataV.GeoAtlas 按 adcode 加载 GeoJSON
// 文档：https://datav.aliyun.com/portal/school/atlas/area_selector
// 接口约定：{adcode}_full.json 包含该行政区的下一级子区域，可支持下钻
const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound'

export async function loadGeoJSON(adcode = '100000') {
  const url = `${BASE}/${adcode}_full.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`地图数据加载失败 adcode=${adcode} (HTTP ${res.status})`)
  }
  return res.json()
}
