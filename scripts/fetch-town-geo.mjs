#!/usr/bin/env node
// 批量下载「真实乡镇边界多边形」到 public/geo/towns/<adcode>_geo.json
// 数据源：rooma1989/china_geo_data（省/市/geo_县.json），坐标系与 DataV 县底图一致，无需转换
//
// 用法：
//   node scripts/fetch-town-geo.mjs            # 全国（约 2840 个县）
//   node scripts/fetch-town-geo.mjs 62         # 仅甘肃省
//   node scripts/fetch-town-geo.mjs 6204       # 仅白银市
//   node scripts/fetch-town-geo.mjs 620422     # 仅会宁县
//
// 特性：断点续传（已存在文件跳过）、并发控制、Douglas-Peucker 简化、失败重试
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const TOWNS_DIR = path.join(ROOT, 'public/geo/towns')
const INDEX_PATH = path.join(ROOT, 'public/geo/town_geo_index.json')
const BASE = 'https://cdn.jsdelivr.net/gh/rooma1989/china_geo_data@main'
const MIRROR = 'https://gitee.com/rooma1989/china_geo_data/raw/main'

const CONCURRENCY = Number(process.env.CONCURRENCY || 8)
const TOL = Number(process.env.TOL || 0.0009) // 简化容差 ~90m
const RETRY = 2

fs.mkdirSync(TOWNS_DIR, { recursive: true })

// ---------- Douglas-Peucker 简化 ----------
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
    const left = dp(pts.slice(0, idx + 1), tol)
    const right = dp(pts.slice(idx), tol)
    return left.slice(0, -1).concat(right)
  }
  return [a, b]
}

// 简化单个环：GeoJSON 外环是闭合的（首尾同点），直接跑 DP 会退化——
// 首尾连线长度为 0 导致所有点距离都算成 0，结果只剩 2 个点。
// 因此先拆掉闭合点、简化后再补回去。
function simplifyRing(ring, tol) {
  if (!ring || ring.length < 5) return ring
  const a = ring[0]
  const b = ring[ring.length - 1]
  const closed = a[0] === b[0] && a[1] === b[1]
  const pts = closed ? ring.slice(0, -1) : ring.slice()
  const s = dp(pts, tol)
  if (s.length < 3) return ring // 简化退化，保留原环
  return closed ? s.concat([[s[0][0], s[0][1]]]) : s
}

function simplifyGeom(geom, tol) {
  const simpPoly = (poly) =>
    poly && poly.length
      ? [simplifyRing(poly[0], tol)].concat(poly.slice(1))
      : poly
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: simpPoly(geom.coordinates) }
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map(simpPoly)
    }
  }
  return geom
}

// ---------- 下载（curl 兜底，沙箱内 node fetch 对 CDN 也 OK，但 curl 更稳） ----------
async function fetchJSON(url) {
  const { stdout } = await execFileP(
    'curl',
    ['-sSL', '--max-time', '60', '-w', '\n%{http_code}', url],
    { maxBuffer: 64 * 1024 * 1024 }
  )
  const idx = stdout.lastIndexOf('\n')
  const body = stdout.slice(0, idx)
  const code = stdout.slice(idx + 1).trim()
  if (code !== '200') throw new Error('HTTP ' + code)
  return JSON.parse(body)
}

async function downloadOne(adcode, relPath) {
  const dest = path.join(TOWNS_DIR, `${adcode}_geo.json`)
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100) {
    return { adcode, status: 'skip' }
  }
  const encoded = relPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  let lastErr = null
  for (let attempt = 0; attempt <= RETRY; attempt++) {
    for (const base of [BASE, MIRROR]) {
      try {
        const raw = await fetchJSON(`${base}/${encoded}`)
        const list = Array.isArray(raw) ? raw : raw.features || []
        if (!list.length) throw new Error('空数据')
        const features = []
        for (const f of list) {
          const p = f.properties || {}
          const geom = simplifyGeom(f.geometry, TOL)
          if (geom.type === 'Polygon' && (!geom.coordinates[0] || geom.coordinates[0].length < 3)) continue
          features.push({
            type: 'Feature',
            properties: {
              name: p['乡'] || p['镇'] || p.name || '',
              province: p['省'],
              city: p['市'],
              county: p['县'] || p['区']
            },
            geometry: geom
          })
        }
        if (!features.length) throw new Error('简化后无有效要素')
        fs.writeFileSync(
          dest,
          JSON.stringify({ type: 'FeatureCollection', features })
        )
        return { adcode, status: 'ok', n: features.length, size: fs.statSync(dest).size }
      } catch (e) {
        lastErr = e.message || String(e)
        // CDN 瞬时限流（403）时退避重试，避免并发过高被持续拒绝
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
      }
    }
  }
  return { adcode, status: 'fail', err: lastErr }
}

// ---------- 主流程 ----------
const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'))
const scope = (process.argv[2] || '').trim()

let targets = Object.entries(index)
if (scope) {
  targets = targets.filter(([ad]) => ad.startsWith(scope))
}

console.log(`目标区县数：${targets.length}${scope ? `（过滤 ${scope}）` : '（全国）'}`)
console.log(`并发 ${CONCURRENCY} · 简化容差 ${TOL} · 输出 ${TOWNS_DIR}`)

let done = 0
let ok = 0
let skip = 0
let fail = 0
const fails = []
const queue = targets.slice()

async function worker() {
  while (queue.length) {
    const [adcode, relPath] = queue.shift()
    const r = await downloadOne(adcode, relPath)
    done++
    if (r.status === 'ok') ok++
    else if (r.status === 'skip') skip++
    else {
      fail++
      if (fails.length < 15) fails.push(r)
    }
    if (done % 50 === 0 || done === targets.length) {
      console.log(`进度 ${done}/${targets.length}  新增:${ok} 跳过:${skip} 失败:${fail}`)
    }
  }
}

const t0 = Date.now()
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
const secs = ((Date.now() - t0) / 1000).toFixed(1)

console.log('\n==== 完成 ====')
console.log(`耗时 ${secs}s · 新增 ${ok} · 已存在 ${skip} · 失败 ${fail}`)
if (fails.length) {
  console.log('失败样例（前 15）：')
  fails.forEach((f) => console.log(`  ${f.adcode} — ${f.err}`))
}
