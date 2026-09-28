/**
 * 军事要素（驻军 / 布防 / 行军路线 / 关隘…）的数据模型与导入转换。
 *
 * 一条硬前提：军事态势本身随时代变化——同一处关隘，汉、明、民国、现代的布防
 * 完全不同，不存在"一份永远正确的内置底图数据"。所以这里只定义「结构 + 校验」，
 * **不内置任何史实条目**：要素从哪来、写什么，一律由导入的数据文件决定。
 * 地图只负责把导入的东西按兵要地志的符号体系画出来。
 *
 * 定位有两种，二选一：
 *   1) 直接给经纬度（lng / lat），最准；
 *   2) 只给行政区划代码（adcode），导入时按公开行政区划数据反查中心点补坐标。
 */

/** 要素类型表：shape 决定画法（点符号 / 折线），color 是兵要地志那套墨与朱砂 */
export const MIL_KINDS = [
  { key: 'garrison', label: '驻军', shape: 'point', color: '#a83232', desc: '部队驻地 / 驻防点' },
  { key: 'defense', label: '布防', shape: 'point', color: '#8a5a2b', desc: '防御阵地 / 防线节点' },
  { key: 'march', label: '行军路线', shape: 'line', color: '#a83232', desc: '按序号连成折线，带行进方向箭头' },
  { key: 'frontline', label: '战线', shape: 'line', color: '#6b4a2a', desc: '对峙线 / 防线走向' },
  { key: 'pass', label: '关隘', shape: 'point', color: '#4a4a44', desc: '关隘 / 隘口 / 要冲' },
  { key: 'fort', label: '堡寨', shape: 'point', color: '#5a4630', desc: '堡寨 / 工事 / 碉堡' },
  { key: 'camp', label: '营地', shape: 'point', color: '#7a5a2a', desc: '宿营地 / 集结地' },
  { key: 'battle', label: '战场', shape: 'point', color: '#8c2f2f', desc: '战役 / 交战地点' },
  { key: 'supply', label: '补给', shape: 'point', color: '#3f5a44', desc: '粮秣 / 兵站 / 补给点' },
  { key: 'command', label: '指挥所', shape: 'point', color: '#6a3a5a', desc: '指挥机构 / 司令部' },
  // 导入时类型列认不出来就落到这里：宁可画成中性点，也不替用户猜它是什么
  { key: 'unknown', label: '未分类', shape: 'point', color: '#5c5344', desc: '类型未识别' }
]

const KIND_BY_KEY = new Map(MIL_KINDS.map((k) => [k.key, k]))
// 别名：中英文、常见近义词都收进来，尽量让用户不用改表头
const KIND_ALIASES = new Map()
for (const k of MIL_KINDS) {
  KIND_ALIASES.set(k.key, k.key)
  KIND_ALIASES.set(k.label, k.key)
}
KIND_ALIASES.set('驻防', 'garrison')
KIND_ALIASES.set('驻地', 'garrison')
KIND_ALIASES.set('驻军点', 'garrison')
KIND_ALIASES.set('防守', 'defense')
KIND_ALIASES.set('防线', 'frontline')
KIND_ALIASES.set('防御线', 'frontline')
KIND_ALIASES.set('行军', 'march')
KIND_ALIASES.set('进军', 'march')
KIND_ALIASES.set('路线', 'march')
KIND_ALIASES.set('进军路线', 'march')
KIND_ALIASES.set('隘口', 'pass')
KIND_ALIASES.set('关口', 'pass')
KIND_ALIASES.set('碉堡', 'fort')
KIND_ALIASES.set('工事', 'fort')
KIND_ALIASES.set('堡', 'fort')
KIND_ALIASES.set('宿营', 'camp')
KIND_ALIASES.set('集结', 'camp')
KIND_ALIASES.set('战役', 'battle')
KIND_ALIASES.set('交战', 'battle')
KIND_ALIASES.set('兵站', 'supply')
KIND_ALIASES.set('粮站', 'supply')
KIND_ALIASES.set('补给站', 'supply')
KIND_ALIASES.set('司令部', 'command')
KIND_ALIASES.set('指挥部', 'command')

export function milKind(key) {
  return KIND_BY_KEY.get(key) || KIND_BY_KEY.get('unknown')
}

/** 把用户写的类型文本归一到类型 key；认不出返回 null（由调用方决定怎么提示） */
export function normalizeKind(text) {
  const s = String(text == null ? '' : text).trim().toLowerCase()
  if (!s) return null
  if (KIND_ALIASES.has(s)) return KIND_ALIASES.get(s)
  // 去空格 / 下划线再试一次，兼容「行军 路线」「march_route」
  const t = s.replace(/[\s_\-./]/g, '')
  if (KIND_ALIASES.has(t)) return KIND_ALIASES.get(t)
  for (const [alias, key] of KIND_ALIASES) {
    if (t.includes(alias)) return key
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 字段定义与列自动映射                                                  */
/* ------------------------------------------------------------------ */

export const MIL_FIELDS = [
  { key: 'name', label: '要素名称', required: true, aliases: ['要素名称', '名称', '地名', 'name', 'title'] },
  { key: 'kind', label: '要素类型', required: false, aliases: ['要素类型', '类型', '类别', 'kind', 'type'] },
  { key: 'side', label: '阵营/部队', required: false, aliases: ['阵营', '阵营/部队', '部队', '所属部队', '方面', 'side', 'force'] },
  { key: 'era', label: '时期', required: false, aliases: ['时期', '时代', '年代', '阶段', 'era', 'period'] },
  { key: 'date', label: '时间', required: false, aliases: ['时间', '日期', 'date', 'time'] },
  { key: 'lng', label: '经度', required: false, aliases: ['经度', 'lng', 'lon', 'long', 'longitude', 'x'] },
  { key: 'lat', label: '纬度', required: false, aliases: ['纬度', 'lat', 'latitude', 'y'] },
  { key: 'adcode', label: '行政区划代码', required: false, aliases: ['行政区划代码', '区划代码', '行政代码', '区域编码', '区域代码', 'adcode', 'code'] },
  { key: 'region', label: '所属区域', required: false, aliases: ['所属区域', '区域名称', '行政区划', '区县', '乡镇', 'region'] },
  { key: 'seq', label: '序号', required: false, aliases: ['序号', '顺序', '点序', 'seq', 'order', 'index'] },
  { key: 'strength', label: '兵力', required: false, aliases: ['兵力', '兵员', '人数', '规模', 'strength'] },
  { key: 'commander', label: '指挥官', required: false, aliases: ['指挥官', '主官', '将领', '指挥', 'commander'] },
  { key: 'note', label: '备注', required: false, aliases: ['备注', '说明', '注记', 'note', 'remark', 'desc'] }
]

/** 列名归一：小写 + 去空白与常见符号，用于模糊比对 */
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/[\s_\-()（）]/g, '')
}

/**
 * 按列名自动推断字段映射。
 * 两轮：先精确匹配别名，再退到"包含"匹配（避免「要素经度」这类前缀列名漏掉）。
 * @param {string[]} columns
 * @returns {Record<string, string>} 字段 key → 列名（未识别的字段不出现）
 */
export function guessMilMapping(columns = []) {
  const map = {}
  const used = new Set()
  const list = columns.filter(Boolean)
  for (const f of MIL_FIELDS) {
    let hit = ''
    for (const a of f.aliases) {
      const c = list.find((c) => !used.has(c) && norm(c) === norm(a))
      if (c) { hit = c; break }
    }
    if (!hit) {
      for (const a of f.aliases) {
        const c = list.find((c) => !used.has(c) && norm(c).includes(norm(a)))
        if (c) { hit = c; break }
      }
    }
    if (hit) { map[f.key] = hit; used.add(hit) }
  }
  return map
}

/* ------------------------------------------------------------------ */
/* 取值与校验                                                          */
/* ------------------------------------------------------------------ */

function val(row, col) {
  if (!col) return ''
  const v = row[col]
  return v == null ? '' : String(v).trim()
}

function toNum(text) {
  const s = String(text == null ? '' : text).trim().replace(/[，,\s]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 行政区划代码规范化：Excel 常把 620422 读成 620422.0 / 6.2E+5 */
export function normalizeMilAdcode(raw) {
  if (raw == null) return ''
  let s = String(raw).trim().replace(/[\s\u3000-]/g, '')
  if (!s) return ''
  if (/^\d+\.?0*$/.test(s) && s.includes('.')) s = s.split('.')[0]
  if (/e/i.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) s = String(Math.round(n))
  }
  return /^\d{6}$|^\d{9}$|^\d{2}$|^\d{4}$/.test(s) ? s : ''
}

/**
 * 经纬度合法性：范围之外直接判错；疑似经纬度写反单独提示（很常见的手误）。
 * 注意：中国境内经度普遍在 73~136，经度大于 90 是常态，绝不能当成"写反"拒掉。
 * 真正的写反是纬度跑出 ±90（比如把 105.07 填进了纬度）。
 */
function checkLngLat(lng, lat) {
  if (lng == null || lat == null) return null
  if (lat < -90 || lat > 90) {
    // 纬度越界、经度却还在合理区间 —— 几乎都是把经纬度填反了
    return Math.abs(lng) <= 180 ? '纬度超出 ±90，疑似经纬度写反' : '坐标超出地球范围'
  }
  if (lng < -180 || lng > 180) return '坐标超出地球范围'
  return null
}

/**
 * 行数组 → 军事要素数组。
 *
 * 折线类（行军路线 / 战线）按「名称 + 阵营 + 时期」分组，组内以序号排序连成路径；
 * 点类一行一个要素。无法定位（既无坐标也无区划代码）的行直接丢弃并记 error。
 *
 * @param {Object[]} rows 解析后的行对象
 * @param {Record<string,string>} mapping 字段 key → 列名
 * @param {{setId?: string, setName?: string}} [meta]
 * @returns {{features: Object[], errors: string[], warnings: string[], needAdcode: string[]}}
 *          needAdcode 是待反查坐标的区划代码（去重），交给 resolveAdcodeCenters 补
 */
export function rowsToMilFeatures(rows = [], mapping = {}, meta = {}) {
  const features = []
  const errors = []
  const warnings = []
  const needAdcode = new Set()
  const groups = new Map() // 折线分组

  rows.forEach((row, i) => {
    const lineNo = i + 2 // +2：表头占第 1 行，行号从 1 开始数
    const name = val(row, mapping.name)
    const kindRaw = val(row, mapping.kind)
    const kindKey = normalizeKind(kindRaw) || (kindRaw ? '' : null)
    // 类型列填了却认不出：不猜，标未分类并提示
    if (kindRaw && !kindKey) warnings.push(`第 ${lineNo} 行：类型「${kindRaw}」未识别，按未分类处理`)
    const kind = milKind(kindKey || 'unknown')

    const lng = toNum(val(row, mapping.lng))
    const lat = toNum(val(row, mapping.lat))
    const adcode = normalizeMilAdcode(val(row, mapping.adcode))
    const side = val(row, mapping.side)
    const era = val(row, mapping.era)

    const base = {
      name,
      kind: kind.key,
      side,
      era,
      date: val(row, mapping.date),
      strength: val(row, mapping.strength),
      commander: val(row, mapping.commander),
      note: val(row, mapping.note),
      adcode,
      region: val(row, mapping.region),
      setId: meta.setId || '',
      setName: meta.setName || ''
    }

    // --- 定位 ---
    let point = null
    if (lng != null && lat != null) {
      const bad = checkLngLat(lng, lat)
      if (bad) {
        errors.push(`第 ${lineNo} 行：${bad}（经度 ${lng}、纬度 ${lat}），已跳过`)
        return
      }
      if (lng < 73 || lng > 136 || lat < 3 || lat > 54) {
        warnings.push(`第 ${lineNo} 行：坐标不在中国范围内，请核对`)
      }
      point = { lng, lat }
    } else if (adcode) {
      needAdcode.add(adcode)
    } else if (!name) {
      // 既没名字也没定位：这一行没有任何可用信息
      return
    } else {
      errors.push(`第 ${lineNo} 行：「${name}」既无经纬度也无行政区划代码，无法定位，已跳过`)
      return
    }

    if (!name) {
      warnings.push(`第 ${lineNo} 行：缺少名称，已用「未命名 ${lineNo}」占位`)
    }
    base.name = name || `未命名 ${lineNo}`

    if (kind.shape === 'line') {
      const gk = `${base.name}|${side}|${era}`
      if (!groups.has(gk)) groups.set(gk, [])
      groups.get(gk).push({ base, point, seq: toNum(val(row, mapping.seq)), row: lineNo })
      return
    }

    features.push({ ...base, id: `m${i}_${Math.random().toString(36).slice(2, 7)}`, shape: 'point', point, path: null })
  })

  // --- 折线收口 ---
  for (const [gk, items] of groups) {
    items.sort((a, b) => {
      if (a.seq != null && b.seq != null) return a.seq - b.seq
      if (a.seq != null) return -1
      if (b.seq != null) return 1
      return a.row - b.row
    })
    const pts = []
    for (const it of items) {
      if (!it.point) continue
      const last = pts[pts.length - 1]
      if (last && Math.abs(last.lng - it.point.lng) < 1e-7 && Math.abs(last.lat - it.point.lat) < 1e-7) continue
      pts.push(it.point)
    }
    const head = items[0].base
    if (pts.length >= 2) {
      features.push({ ...head, id: `l${Math.random().toString(36).slice(2, 8)}`, shape: 'line', point: null, path: pts })
    } else if (pts.length === 1) {
      features.push({ ...head, id: `m${Math.random().toString(36).slice(2, 8)}`, shape: 'point', point: pts[0], path: null })
      warnings.push(`「${head.name}」只有 1 个可用点，已按点要素处理（折线至少需 2 点）`)
    } else {
      errors.push(`「${head.name}」没有任何可定位的点，已跳过`)
    }
  }

  return { features, errors, warnings, needAdcode: [...needAdcode] }
}

/* ------------------------------------------------------------------ */
/* 按行政区划代码反查中心点                                              */
/* ------------------------------------------------------------------ */

const adcodeCache = new Map()

/**
 * 没有坐标、只有区划代码时，按公开行政区划数据反查中心点。
 * 数据源与本仓库地图底图同源（public/geo 下 DataV / 乡镇点位文件），
 * 保证模板里能填的 adcode 这里一定查得到。
 * @param {string} adcode
 * @returns {Promise<{lng: number, lat: number} | null>}
 */
export async function resolveAdcodeCenter(adcode) {
  const code = normalizeMilAdcode(adcode)
  if (!code) return null
  if (adcodeCache.has(code)) return adcodeCache.get(code)
  let out = null
  try {
    if (code.length === 9) {
      // 乡镇级：点位文件按区县前 6 位组织
      const res = await fetch(`geo/towns/${code.slice(0, 6)}.json`)
      if (res.ok) {
        const list = await res.json()
        const hit = (Array.isArray(list) ? list : []).find((t) => String(t.adcode) === code)
        if (hit && hit.lng != null && hit.lat != null) out = { lng: Number(hit.lng), lat: Number(hit.lat) }
      }
    } else {
      // 省 / 市 / 区县：单区边界文件的 properties.center 即官方中心点
      const urls = code.length === 6 ? [`geo/${code}.json`, `geo/${code}_full.json`] : [`geo/${code}_full.json`]
      for (const u of urls) {
        const res = await fetch(u)
        if (!res.ok) continue
        const gj = await res.json()
        const f = (gj.features || []).find((x) => String((x.properties || {}).adcode) === code)
        const c = f && (f.properties || {}).center
        if (Array.isArray(c) && c.length >= 2) { out = { lng: Number(c[0]), lat: Number(c[1]) }; break }
      }
    }
  } catch (e) {
    out = null
  }
  adcodeCache.set(code, out)
  return out
}

/** 批量补坐标：返回 { resolved: Map<adcode,{lng,lat}>, failed: string[] } */
export async function resolveAdcodeCenters(list = []) {
  const resolved = new Map()
  const failed = []
  for (const code of list) {
    const p = await resolveAdcodeCenter(code)
    if (p) resolved.set(code, p)
    else failed.push(code)
  }
  return { resolved, failed }
}

/* ------------------------------------------------------------------ */
/* GeoJSON 互转（便于与 GIS 工具交换）                                    */
/* ------------------------------------------------------------------ */

/** 要素数组 → GeoJSON FeatureCollection（导出 / 模板示例共用） */
export function milFeaturesToGeoJSON(features = []) {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      properties: {
        name: f.name || '',
        kind: f.kind || '',
        side: f.side || '',
        era: f.era || '',
        date: f.date || '',
        strength: f.strength || '',
        commander: f.commander || '',
        adcode: f.adcode || '',
        region: f.region || '',
        note: f.note || ''
      },
      geometry:
        f.shape === 'line' && f.path && f.path.length >= 2
          ? { type: 'LineString', coordinates: f.path.map((p) => [p.lng, p.lat]) }
          : { type: 'Point', coordinates: f.point ? [f.point.lng, f.point.lat] : [0, 0] }
    }))
  }
}

/**
 * GeoJSON → 要素数组。
 * 军事要素的字段都挂在 properties 上，直接按属性名取，不再走列映射。
 */
export function geoJsonToMilFeatures(geojson, meta = {}) {
  const list = Array.isArray(geojson) ? geojson : (geojson && geojson.features) || []
  const features = []
  const errors = []
  const warnings = []
  list.forEach((f, i) => {
    if (!f || !f.geometry) { errors.push(`第 ${i + 1} 个要素缺少 geometry，已跳过`); return }
    const p = f.properties || {}
    const g = f.geometry
    const kindKey = normalizeKind(p.kind || p.type || p.类别 || '')
    if ((p.kind || p.type) && !kindKey) warnings.push(`要素 ${i + 1}：类型「${p.kind || p.type}」未识别，按未分类处理`)
    const base = {
      name: String(p.name || p.名称 || ''),
      kind: kindKey || (g.type === 'LineString' || g.type === 'MultiLineString' ? 'march' : 'unknown'),
      side: String(p.side || p.阵营 || p.部队 || ''),
      era: String(p.era || p.时期 || p.period || ''),
      date: String(p.date || p.时间 || ''),
      strength: String(p.strength || p.兵力 || ''),
      commander: String(p.commander || p.指挥官 || ''),
      note: String(p.note || p.备注 || ''),
      adcode: normalizeMilAdcode(p.adcode || p.行政区划代码),
      region: String(p.region || p.所属区域 || ''),
      setId: meta.setId || '',
      setName: meta.setName || ''
    }
    if (!base.name) base.name = `未命名 ${i + 1}`

    if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      const pts = g.coordinates
        .filter((c) => Array.isArray(c) && c.length >= 2)
        .map((c) => ({ lng: Number(c[0]), lat: Number(c[1]) }))
        .filter((c) => Number.isFinite(c.lng) && Number.isFinite(c.lat))
      if (pts.length >= 2) {
        features.push({ ...base, id: `g${i}_${Math.random().toString(36).slice(2, 6)}`, shape: 'line', point: null, path: pts })
        return
      }
      if (pts.length === 1) {
        features.push({ ...base, id: `g${i}`, shape: 'point', point: pts[0], path: null })
        return
      }
      errors.push(`要素 ${i + 1}（${base.name}）：折线没有可用坐标，已跳过`)
      return
    }
    if (g.type === 'Point' && Array.isArray(g.coordinates)) {
      const lng = Number(g.coordinates[0])
      const lat = Number(g.coordinates[1])
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) { errors.push(`要素 ${i + 1}：坐标无效，已跳过`); return }
      features.push({ ...base, id: `g${i}_${Math.random().toString(36).slice(2, 6)}`, shape: 'point', point: { lng, lat }, path: null })
      return
    }
    errors.push(`要素 ${i + 1}：不支持的几何类型 ${g.type}（仅支持 Point / LineString）`)
  })
  return { features, errors, warnings, needAdcode: [] }
}

/** 统计：给 UI 展示「本次导入各类型多少条」 */
export function summarizeMil(features = []) {
  const byKind = {}
  const eras = new Set()
  const sides = new Set()
  for (const f of features) {
    byKind[f.kind] = (byKind[f.kind] || 0) + 1
    if (f.era) eras.add(f.era)
    if (f.side) sides.add(f.side)
  }
  return { total: features.length, byKind, eras: [...eras].sort(), sides: [...sides].sort() }
}
