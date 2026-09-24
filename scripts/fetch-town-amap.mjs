#!/usr/bin/env node
// 用「高德地图 Web 服务 API」补齐 rooma1989 缺失的区县乡镇边界
//
// 为什么需要它：rooma1989/china_geo_data 是旧版区划快照，2018 年后新设 / 撤县设区的
// 区县（如大同市平城区、云冈区、怀仁市、太谷区、潞州区）在源仓库里根本不存在，
// 另有西藏、香港等覆盖不足，共约 272 / 2840 个区县抓不到。
//
// 前置：到 https://console.amap.com/ 注册 → 创建应用 → 添加 Key（服务平台选「Web服务」）
//      个人开发者免费额度 3 万次/日，补 272 个县绰绰有余
//
// 用法：
//   AMAP_KEY=你的key node scripts/fetch-town-amap.mjs          # 自动补全部缺失区县
//   AMAP_KEY=你的key node scripts/fetch-town-amap.mjs 14        # 仅补山西省缺失的
//   AMAP_KEY=你的key node scripts/fetch-town-amap.mjs --all     # 强制重抓全部（覆盖已有）
//
// 坐标系说明：高德返回 GCJ-02；阿里 DataV 与 rooma1989 同为 GCJ-02（已实测对齐，
// 会宁县 bbox 中心差仅 ~0.002°），因此无需坐标转换。若你的底图换成了 WGS84 源，
// 请自行加 GCJ-02 → WGS84 转换。
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const TOWNS_DIR = path.join(ROOT, 'public/geo/towns')
const INDEX_PATH = path.join(ROOT, 'public/geo/town_geo_index.json')
const API = 'https://restapi.amap.com/v3/config/district'

const KEY = process.env.AMAP_KEY || ''
// 若在高德控制台开启了「数字签名」，填私钥即可（AMAP_PRIVATE_KEY），否则留空
const PRIVATE_KEY = process.env.AMAP_PRIVATE_KEY || ''
const CONCURRENCY = Number(process.env.CONCURRENCY || 4)
const TOL = Number(process.env.TOL || 0.0009)

// 高德常见错误码 → 人话解释 + 处置建议
const AMAP_ERRORS = {
  INVALID_USER_KEY:
    'Key 无效或过期。90% 的情况是「服务平台」选错：REST 接口只认【Web服务】，' +
    '选成【Web端(JS API)】/【Android】/【iOS】都会报这个错；其次是 Key 没复制全（应 32 位）。',
  USERKEY_PLAT_NOMATCH:
    'Key 的服务平台与调用接口不匹配。请到控制台把该 Key 的平台类型改为【Web服务】。',
  INVALID_USER_SCODE:
    '数字签名校验失败。若在控制台开启了数字签名，需把私钥填到环境变量 AMAP_PRIVATE_KEY；' +
    '不需要就到控制台关闭数字签名。',
  DAILY_QUERY_OVER_LIMIT: '当日调用量已超限。个人开发者免费额度用完了，明天再试或换 Key。',
  OVER_QUOTA: '超出配额/并发限制。降低 CONCURRENCY（默认 4）后重试。',
  INVALID_PARAMS: '请求参数非法。检查 adcode 是否为 6 位数字。',
  UNKNOWN_ERROR: '未知错误，稍后重试。'
}

function explain(info) {
  return AMAP_ERRORS[info] || `高德返回：${info}`
}

// 数字签名：参数按 key 的字典序拼接后附私钥，取 md5
function sign(params) {
  const raw = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return crypto.createHash('md5').update(raw + PRIVATE_KEY).digest('hex')
}

function buildURL(params) {
  const p = { ...params, key: KEY }
  if (PRIVATE_KEY) p.sig = sign(p)
  const qs = Object.entries(p)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return `${API}?${qs}`
}

// Key 自检：用一个极轻量的请求验证 Key 是否可用于 Web 服务接口
async function checkKey() {
  console.log(`Key 长度: ${KEY.length} 位（高德 Key 应为 32 位）`)
  if (KEY.length !== 32) console.log('⚠️ Key 长度异常，很可能复制不完整')
  const url = buildURL({ keywords: '中国', subdistrict: 0, extensions: 'base' })
  try {
    const res = await getJSON(url)
    if (res.status === '1') {
      console.log('✅ Key 可用（服务平台=Web服务），可以开始补抓')
      console.log(`   验证返回：${(res.districts || [])[0]?.name || '中国'}`)
    } else {
      console.log(`❌ Key 校验失败：${res.info} (${res.infocode})`)
      console.log(`   ${explain(res.info)}`)
    }
  } catch (e) {
    console.log('❌ 请求失败：' + e.message)
  }
}

fs.mkdirSync(TOWNS_DIR, { recursive: true })

// ---------- Douglas-Peucker（与 fetch-town-geo.mjs 一致：先拆闭合点再简化）----------
function dp(pts, tol) {
  if (pts.length < 3) return pts
  const a = pts[0]
  const b = pts[pts.length - 1]
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const norm = Math.hypot(dx, dy) || 1e-12
  let dmax = 0
  let idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]
    const d = Math.abs(dy * px - dx * py + b[0] * a[1] - b[1] * a[0]) / norm
    if (d > dmax) {
      dmax = d
      idx = i
    }
  }
  if (dmax > tol) {
    return dp(pts.slice(0, idx + 1), tol).slice(0, -1).concat(dp(pts.slice(idx), tol))
  }
  return [a, b]
}

function simplifyRing(ring, tol) {
  if (!ring || ring.length < 5) return ring
  const a = ring[0]
  const b = ring[ring.length - 1]
  const closed = a[0] === b[0] && a[1] === b[1]
  const pts = closed ? ring.slice(0, -1) : ring.slice()
  const s = dp(pts, tol)
  if (s.length < 3) return ring
  return closed ? s.concat([[s[0][0], s[0][1]]]) : s
}

// ---------- 高德 polyline 解析 ----------
// 格式：多个地块用 "|" 分隔；地块内点用 ";" 分隔；点内 "lng,lat"
export function parsePolyline(str, tol) {
  if (!str || str === 'EMPTY') return null
  const polys = []
  for (const block of str.split('|')) {
    const pts = []
    for (const p of block.split(';')) {
      const [lng, lat] = p.split(',').map(Number)
      if (Number.isFinite(lng) && Number.isFinite(lat)) pts.push([lng, lat])
    }
    if (pts.length < 3) continue
    // 高德返回的环不一定闭合，补齐首尾
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]])
    const ring = simplifyRing(pts, tol)
    if (ring.length >= 4) polys.push([ring])
  }
  if (!polys.length) return null
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys }
}

async function getJSON(url) {
  const { stdout } = await execFileP('curl', ['-sSL', '--max-time', '45', url], {
    maxBuffer: 64 * 1024 * 1024
  })
  return JSON.parse(stdout)
}

async function fetchCounty(adcode, countyName) {
  const dest = path.join(TOWNS_DIR, `${adcode}_geo.json`)
  const url = buildURL({
    keywords: adcode,
    subdistrict: 1,
    extensions: 'all',
    level: 'district'
  })
  const res = await getJSON(url)
  if (res.status !== '1') {
    return { adcode, status: 'fail', err: res.info || 'API 返回非 1', tip: explain(res.info) }
  }
  const root = (res.districts || [])[0]
  if (!root) return { adcode, status: 'fail', err: '无 districts' }
  const kids = root.districts || []
  const features = []
  for (const k of kids) {
    if (k.level !== 'street' && k.level !== 'district') continue
    const geom = parsePolyline(k.polyline, TOL)
    if (!geom) continue
    features.push({
      type: 'Feature',
      properties: {
        name: k.name,
        county: countyName || root.name,
        // 高德乡镇 adcode 为 9 位，取前 6 位应与父区县一致
        adcode: String(k.adcode || '')
      },
      geometry: geom
    })
  }
  if (!features.length) return { adcode, status: 'fail', err: '无有效乡镇边界' }
  fs.writeFileSync(dest, JSON.stringify({ type: 'FeatureCollection', features }))
  return { adcode, status: 'ok', n: features.length }
}

// ---------- 主流程 ----------
async function main() {
if (!KEY) {
  console.error(
    '缺少环境变量 AMAP_KEY。\n' +
      '请到 https://console.amap.com/ 注册并创建「Web服务」类型的 Key，然后：\n' +
      '  AMAP_KEY=你的key node scripts/fetch-town-amap.mjs [省/市/县前缀 | --all]'
  )
  process.exit(1)
}

const arg = (process.argv[2] || '').trim()

// --check：只做 Key 自检，不抓数据
if (arg === '--check') {
  await checkKey()
  return
}

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'))
let targets
if (arg === '--all') {
  targets = Object.entries(index)
} else {
  targets = Object.entries(index).filter(([ad]) => {
    if (arg && !ad.startsWith(arg)) return false
    // 默认只补缺失的（排除已存在文件的）
    return !fs.existsSync(path.join(TOWNS_DIR, `${ad}_geo.json`))
  })
}

console.log(`待补区县：${targets.length}${arg && arg !== '--all' ? `（前缀 ${arg}）` : ''}`)
let ok = 0
let fail = 0
const fails = []
const queue = targets.slice()
let done = 0

async function worker() {
  while (queue.length) {
    const [adcode, relPath] = queue.shift()
    const countyName = (relPath.split('/').pop() || '').replace(/^geo_/, '').replace(/\.json$/, '')
    try {
      const r = await fetchCounty(adcode, countyName)
      if (r.status === 'ok') ok++
      else {
        fail++
        if (fails.length < 15) fails.push(r)
      }
    } catch (e) {
      fail++
      if (fails.length < 15) fails.push({ adcode, err: e.message, tip: explain(e.message) })
    }
    done++
    if (done % 20 === 0 || done === targets.length) {
      console.log(`进度 ${done}/${targets.length}  成功:${ok} 失败:${fail}`)
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
console.log(`\n==== 完成 ==== 成功 ${ok} · 失败 ${fail}`)
if (fails.length) {
  console.log('失败样例（前 5）：')
  fails.slice(0, 5).forEach((f) => console.log(`  ${f.adcode} — ${f.err || f.info}`))
  // 所有失败通常是同一个原因，只提示一次
  const tip = fails[0] && fails[0].tip
  if (tip) {
    console.log('\n⚠️ 排查建议：')
    console.log(`   ${tip}`)
    if (fails[0].err === 'INVALID_USER_KEY') {
      console.log('   确认 Key 可用后再跑：AMAP_KEY=你的key node scripts/fetch-town-amap.mjs --check')
    }
  }
}
}

// 仅在直接执行时启动主流程（被 import 做单测时不启动）
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (invokedDirectly) await main()
