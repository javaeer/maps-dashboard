// 行政区划 GeoJSON 加载（三级缓存）：
//   1) 本地静态文件 /geo/<adcode>_full.json（构建时由 scripts/fetch-geo.mjs 抓取并提交）
//   2) 浏览器 IndexedDB（运行时缓存，首次看完即离线可用）
//   3) 阿里 DataV.GeoAtlas 在线接口（兜底，失败/叶子返回 null）
//
// 文档：https://datav.aliyun.com/portal/school/atlas/area_selector
// 接口约定：{adcode}_full.json 包含该行政区的下一级子区域（几何面），可用于下钻
// 注意：DataV 在「区/县」(6 位 adcode) 即为几何下限，镇/街道不再提供多边形

const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound'
const LOCAL = '/geo' // Vite 将 public/ 映射到站点根目录

// ---------- 浏览器 IndexedDB 运行时缓存 ----------
const DB_NAME = 'maps-dashboard-geo'
const STORE = 'geojson'
let _dbPromise = null

function openDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return _dbPromise
}

async function idbGet(adcode) {
  const db = await openDB()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, 'readonly').objectStore(STORE).get(adcode)
      t.onsuccess = () => resolve(t.result || null)
      t.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function idbSet(adcode, geo) {
  const db = await openDB()
  if (!db) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(geo, adcode)
  } catch {
    /* 忽略写入失败 */
  }
}

// 加载某行政区的下一级面数据；叶子（无下级）返回 null
export async function loadGeoJSON(adcode = '100000') {
  // 1) 已提交的本地静态缓存
  try {
    const r = await fetch(`${LOCAL}/${adcode}_full.json`)
    if (r.ok) return await r.json()
  } catch {
    /* 本地无该文件，继续 */
  }
  // 2) 浏览器 IndexedDB
  const cached = await idbGet(adcode)
  if (cached) return cached
  // 3) DataV 在线 + 写入缓存
  try {
    const r = await fetch(`${BASE}/${adcode}_full.json`)
    if (!r.ok) return null // 叶子节点（如区/县）无下级面
    const geo = await r.json()
    await idbSet(adcode, geo)
    return geo
  } catch {
    return null
  }
}

// 加载叶子区县自身边界（DataV 无县级 _full.json（404），仅提供不带 _full 的单面文件）
// 用于下钻到县时渲染县级底图；返回单个 Feature 的 GeoJSON
export async function loadCountyGeo(adcode) {
  // 1) 本地静态缓存
  try {
    const r = await fetch(`${LOCAL}/${adcode}.json`)
    if (r.ok) return await r.json()
  } catch {
    /* 本地无该文件，继续 */
  }
  // 2) 浏览器 IndexedDB（key 加 self: 前缀，与 _full 缓存区分）
  const cached = await idbGet(`self:${adcode}`)
  if (cached) return cached
  // 3) DataV 在线 + 写入缓存
  try {
    const r = await fetch(`${BASE}/${adcode}.json`)
    if (!r.ok) return null
    const geo = await r.json()
    await idbSet(`self:${adcode}`, geo)
    return geo
  } catch {
    return null
  }
}

// 加载某区县的「真实乡镇边界」多边形（rooma1989/china_geo_data，按 省/市/geo_县.json 组织）
// 三级缓存：本地 /geo/towns/<adcode>_geo.json → IndexedDB → 在线（jsdelivr 镜像）
// 返回值：FeatureCollection；rooma1989 原始顶层是 Feature 数组，这里统一补成 FeatureCollection
const TOWN_GEO_BASE = 'https://cdn.jsdelivr.net/gh/rooma1989/china_geo_data@main'
let _townIndex = null
async function loadTownIndex() {
  if (_townIndex) return _townIndex
  try {
    const r = await fetch(`${LOCAL}/town_geo_index.json`)
    if (r.ok) {
      _townIndex = await r.json()
      return _townIndex
    }
  } catch {
    /* 本地无索引 */
  }
  return null
}

export async function loadTownGeo(adcode) {
  const key = String(adcode)
  // 1) 本地静态缓存（已简化缓存的县边界）
  try {
    const r = await fetch(`${LOCAL}/towns/${key}_geo.json`)
    if (r.ok) return await r.json()
  } catch {
    /* 本地无该文件 */
  }
  // 2) 浏览器 IndexedDB
  const cached = await idbGet(`towngeo:${key}`)
  if (cached) return cached
  // 3) 在线：rooma1989/china_geo_data（坐标系与 DataV 县底图一致，无需转换）
  const idx = await loadTownIndex()
  const path = idx && idx[key]
  if (path) {
    try {
      const r = await fetch(`${TOWN_GEO_BASE}/${encodeURI(path)}`)
      if (r.ok) {
        const raw = await r.json()
        const fc = Array.isArray(raw)
          ? { type: 'FeatureCollection', features: raw }
          : raw
        await idbSet(`towngeo:${key}`, fc)
        return fc
      }
    } catch {
      /* 在线拉取失败 */
    }
  }
  return null
}

// 加载某区县的镇级点位数据（本地 /geo/towns/<adcode>.json）；缺失返回 null
export async function loadTowns(countyAdcode) {
  try {
    const r = await fetch(`${LOCAL}/towns/${countyAdcode}.json`)
    if (r.ok) return await r.json()
  } catch {
    /* 无镇级数据 */
  }
  return null
}
