/**
 * 区域树匹配
 *
 * 用途：把用户导入的业务数据 adcode 与平台内置 GeoJSON 做核对（导入向导第 5 步），
 *       确认「哪些 adcode 能在地图上找到对应区域」。
 *
 * 数据复用 public/geo 下已有的 DataV 几何文件（不再新增自己的区域表）：
 *   省级   100000_full.json
 *   市级   {省码}0000_full.json          例：620000_full.json 含甘肃各市
 *   区县级 {市码}00_full.json            例：620400_full.json 含白银各区县
 *   镇级   towns/{区县码}.json            例：towns/620422.json 含会宁 28 镇点位
 *
 * 按需加载 + 内存缓存：同一批数据通常集中在一个省，实际只拉取少量文件。
 */
import { normalizeAdcode, inferLevelByAdcode, inferParentAdcode } from './dataParser.js'

// public/geo 的访问前缀，跟随 vite 的 base 配置（部署到子路径时也成立）
const GEO_BASE = `${import.meta.env.BASE_URL}geo/`

/** @type {Map<string, Promise<Map<string, {name:string, level:string, parentAdcode:string}>>>} */
const cache = new Map()

/** 已加载过的文件名，便于在 UI 上向用户回显「本次核对用了哪些内置数据」 */
const loadedFiles = new Set()

/**
 * 带缓存地加载一个 GeoJSON 文件并转成 adcode → 信息 的映射
 * @param {string} file 文件名（相对 geo/）
 * @param {(json:any)=>Array<{adcode:string,name:string}>} pick 从 GeoJSON 里取出区域列表
 * @param {string} level
 */
function loadIndex(file, level, pick) {
  if (cache.has(file)) return cache.get(file)

  const task = fetch(GEO_BASE + file)
    .then((r) => {
      if (!r.ok) throw new Error(`${file} 加载失败（HTTP ${r.status}）`)
      return r.json()
    })
    .then((json) => {
      loadedFiles.add(file)
      const map = new Map()
      for (const item of pick(json)) {
        const code = normalizeAdcode(item.adcode)
        if (!code) continue
        map.set(code, {
          name: item.name || '',
          level,
          parentAdcode: inferParentAdcode(code)
        })
      }
      return map
    })
    .catch((e) => {
      // 关键：失败结果也要留在缓存里。
      // 若在这里删除缓存，同一份缺失的文件会被每个未命中 adcode 各拉一次，
      // 批量未命中时会产生成百上千个重复请求（控制台刷屏 + 卡慢）。
      // 缓存 rejected promise 后，后续再用到该文件会立即失败，不再发网络请求。
      throw e
    })

  cache.set(file, task)
  return task
}

/** DataV *_full.json 的 feature 抽取 */
function pickFeatures(json) {
  return (json.features || []).map((f) => ({
    adcode: f.properties && f.properties.adcode,
    name: f.properties && f.properties.name
  }))
}

/** towns/{adcode}.json 是纯数组，元素形如 { name, adcode, lng, lat, type } */
function pickTowns(json) {
  const arr = Array.isArray(json) ? json : json.towns || []
  return arr.map((t) => ({ adcode: t.adcode, name: t.name }))
}

/** 省级索引 */
const provinceIndex = () => loadIndex('100000_full.json', 'province', pickFeatures)
/** 市级索引：入参为 2 位省码 */
const cityIndex = (p) => loadIndex(`${p}0000_full.json`, 'city', pickFeatures)
/** 区县级索引：入参为 4 位市码 */
const districtIndex = (c) => loadIndex(`${c}00_full.json`, 'district', pickFeatures)
/** 镇级索引：入参为 6 位区县码 */
const townIndex = (d) => loadIndex(`towns/${d}.json`, 'town', pickTowns)

/**
 * 单个 adcode 对应的索引来源
 * @param {string} code
 * @param {string} level 已判定的层级
 */
function sourceFor(code, level) {
  if (level === 'province') return provinceIndex()
  if (level === 'city') return cityIndex(code.slice(0, 2))
  if (level === 'district') return districtIndex(code.slice(0, 4))
  if (level === 'town') return townIndex(code.slice(0, 6))
  return null
}

/**
 * 批量匹配 adcode
 * @param {string[]} adcodes 已规范化的编码列表
 * @param {'auto'|'province'|'city'|'district'|'town'|'village'} levelMode
 *        层级指定模式；auto 时按 adcode 长度与结构自动判定
 * @param {(msg:string)=>void} [onProgress] 进度回调
 * @returns {Promise<{matched: Map<string,{name:string,level:string,parentAdcode:string}>, missing: Array<{adcode:string,reason:string}>, loadedFiles: string[]}>}
 */
export async function matchAdcodes(adcodes, levelMode = 'auto', onProgress) {
  const matched = new Map()
  const missing = []
  const uniq = Array.from(new Set(adcodes.filter(Boolean)))

  // 村级：DataV 与本项目均未提供几何，直接给出原因，避免无谓的网络请求
  const village = uniq.filter((c) => (levelMode === 'village' ? true : inferLevelByAdcode(c) === 'village'))
  for (const c of village) {
    missing.push({ adcode: c, reason: '村级暂无内置几何，无法核对' })
  }

  // 按层级分组，逐组加载对应索引（同一省份的文件会被缓存复用）
  const groups = new Map()
  for (const code of uniq) {
    if (village.includes(code)) continue
    const level = levelMode === 'auto' ? inferLevelByAdcode(code) : levelMode
    if (level === 'unknown') {
      missing.push({ adcode: code, reason: '编码位数异常，无法判定层级' })
      continue
    }
    if (!groups.has(level)) groups.set(level, [])
    groups.get(level).push(code)
  }

  let done = 0
  for (const [level, codes] of groups) {
    for (const code of codes) {
      try {
        const index = await sourceFor(code, level)
        if (!index) throw new Error('无对应层级数据')
        const hit = index.get(code)
        if (hit) matched.set(code, hit)
        else missing.push({ adcode: code, reason: '内置数据中查无此编码' })
      } catch (e) {
        const msg = (e && e.message) || ''
        missing.push({
          adcode: code,
          reason: /加载失败/.test(msg) ? `缺少内置文件（${msg}）` : `核对失败：${msg}`
        })
      }
      done++
      if (onProgress) onProgress(`已核对 ${done}/${uniq.length}`)
    }
  }

  return {
    matched,
    missing,
    loadedFiles: Array.from(loadedFiles)
  }
}

/**
 * 取某 adcode 的内置名称；查不到或文件缺失时返回空串
 * 用于校验环节把「内置名称」回显给用户对照
 * @param {string} adcode
 * @param {string} [level] 层级，缺省时按编码自动判定
 */
export async function lookupName(adcode, level) {
  const code = normalizeAdcode(adcode)
  if (!code) return ''
  const lv = level || inferLevelByAdcode(code)
  try {
    const index = await sourceFor(code, lv)
    const hit = index && (await index).get(code)
    return hit ? hit.name : ''
  } catch (e) {
    return ''
  }
}

/** 清空内存缓存（切换数据集或需要强制刷新内置数据时调用） */
export function clearTreeCache() {
  cache.clear()
  loadedFiles.clear()
}
