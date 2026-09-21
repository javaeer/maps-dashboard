// 生成全国「全部乡镇/街道」点位数据到 public/geo/towns/<区县adcode>.json
//
// 数据源：modood/Administrative-divisions-of-China 的 streets.json
//   - 含全国 41,352 个乡级单位（乡镇/街道/民族乡/苏木）的 名称 + 9 位 adcode + 6 位父区县 areaCode
//   - 链接(jsdelivr)：https://cdn.jsdelivr.net/gh/modood/Administrative-divisions-of-China@master/dist/streets.json
//   - 备用(gitee)：   https://gitee.com/modood/Administrative-divisions-of-China/raw/master/dist/streets.json
//
// 坐标策略：DataV 不提供镇级多边形，真实镇 GPS 也无免费权威源。
//   这里用「父区县的 center 质心」作锚点，叠加黄金角螺旋微抖动，使点位大致落在对应区县范围内
//   （近似坐标，仅供点位总览；如需精确坐标，按同格式替换 lng/lat 即可）
//
// 用法：
//   node scripts/build-towns.mjs            # 生成全部（已存在的文件跳过，保留手工精修样例）
//   node scripts/build-towns.mjs --force    # 覆盖全部重新生成
//   node scripts/build-towns.mjs /path/streets.json   # 使用本地 streets.json，避免联网

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const GEO_DIR = join(ROOT, 'public', 'geo')
const TOWNS_DIR = join(GEO_DIR, 'towns')
const STREETS_URLS = [
  'https://cdn.jsdelivr.net/gh/modood/Administrative-divisions-of-China@master/dist/streets.json',
  'https://gitee.com/modood/Administrative-divisions-of-China/raw/master/dist/streets.json'
]

const FORCE = process.argv.includes('--force')
const LOCAL_ARG = process.argv.find((a) => a.endsWith('.json') && existsSync(a))
const MAX_R_DEG = 0.12 // 抖动最大半径（约 13km），保证点位散布在区县尺度内
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

function classify(name) {
  if (name.includes('街道')) return '街道'
  if (name.includes('民族乡') || /族乡$/.test(name)) return '民族乡'
  if (name.endsWith('乡')) return '乡'
  if (name.endsWith('镇')) return '镇'
  return '镇'
}

function jitter(i, n, lat) {
  const r = MAX_R_DEG * Math.sqrt((i + 0.5) / Math.max(n, 1))
  const a = i * GOLDEN
  const dLat = r * Math.sin(a)
  const dLng = (r * Math.cos(a)) / Math.cos((lat * Math.PI) / 180)
  return [dLng, dLat]
}

async function loadStreets() {
  if (LOCAL_ARG) {
    console.log('使用本地 streets.json:', LOCAL_ARG)
    return JSON.parse(readFileSync(LOCAL_ARG, 'utf8'))
  }
  for (const url of STREETS_URLS) {
    try {
      console.log('下载乡镇数据:', url)
      const res = await fetch(url)
      if (!res.ok) {
        console.warn('  HTTP', res.status, '，尝试下一个源')
        continue
      }
      return await res.json()
    } catch (e) {
      console.warn('  失败:', e.message, '，尝试下一个源')
    }
  }
  throw new Error('无法下载 streets.json，请手动传入本地路径：node scripts/build-towns.mjs /path/streets.json')
}

// 从已缓存的市级 GeoJSON 中收集「区县 adcode -> 质心[lng,lat]」
function buildDistrictCentroids() {
  const map = new Map()
  const files = readdirSync(GEO_DIR).filter((f) => f.endsWith('_full.json'))
  for (const f of files) {
    let geo
    try {
      geo = JSON.parse(readFileSync(join(GEO_DIR, f), 'utf8'))
    } catch {
      continue
    }
    for (const feat of geo.features || []) {
      const p = feat.properties
      if (!p || !p.adcode) continue
      const adcode = String(p.adcode)
      if (adcode.length !== 6) continue // 只取区县（6 位）
      const c = p.center || p.centroid
      if (Array.isArray(c) && c.length === 2 && isFinite(c[0]) && isFinite(c[1])) {
        map.set(adcode, c)
      }
    }
  }
  return map
}

async function main() {
  const streets = await loadStreets()
  console.log(`乡镇记录总数: ${streets.length}`)

  const centroids = buildDistrictCentroids()
  console.log(`缓存中可定位的区县质心数: ${centroids.size}`)

  // 按父区县 areaCode 分组
  const byArea = new Map()
  let noCentroid = 0
  for (const s of streets) {
    const area = String(s.areaCode)
    if (!centroids.has(area)) {
      noCentroid++
      continue
    }
    if (!byArea.has(area)) byArea.set(area, [])
    byArea.get(area).push(s)
  }

  if (!existsSync(TOWNS_DIR)) mkdirSync(TOWNS_DIR, { recursive: true })

  let written = 0
  let skipped = 0
  let totalTowns = 0
  for (const [area, list] of byArea) {
    const out = join(TOWNS_DIR, `${area}.json`)
    if (existsSync(out) && !FORCE) {
      skipped++
      continue
    }
    const [clng, clat] = centroids.get(area)
    const towns = list.map((s, i) => {
      const [dlng, dlat] = jitter(i, list.length, clat)
      return {
        name: s.name,
        lng: +(clng + dlng).toFixed(5),
        lat: +(clat + dlat).toFixed(5),
        adcode: s.code,
        type: classify(s.name)
      }
    })
    writeFileSync(out, JSON.stringify(towns, null, 0))
    written++
    totalTowns += towns.length
  }

  console.log(`生成区县文件: ${written}，跳过(已存在): ${skipped}`)
  console.log(`写入镇级点位总数: ${totalTowns}`)
  console.log(`无区县质心、未生成的乡镇: ${noCentroid}`)
  console.log(`输出目录: ${TOWNS_DIR}`)
}

main().catch((e) => {
  console.error('生成失败:', e.message)
  process.exit(1)
})
