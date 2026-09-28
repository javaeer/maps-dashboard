// 水系图层：把真实河流水系画成「双线河 + 水面淡染 + 湖泊水域」。
//
// 数据来源（都可查可溯，图注里要标出来）：
//   rivers_china.json / lakes_china.json —— Natural Earth 10m（公有领域）
//   {adcode}_water.json                  —— OpenStreetMap 经 Overpass API（ODbL）
// 数据由 /tmp/build-hydro.py 裁剪抽稀后落到 public/geo/hydro/，本文件只负责渲染。

import * as THREE from 'three'
import { geoToWorld } from '../effects/town.js'

/** 图上标注用的来源说明，随图层一起交给 UI */
export const HYDRO_SOURCES = {
  naturalearth: 'Natural Earth 10m（公有领域）',
  osm: 'OpenStreetMap / Overpass（ODbL）'
}

const cache = new Map()

/** 读一份水系数据；失败也进缓存，避免反复 404 */
export async function loadHydro(url) {
  if (cache.has(url)) return cache.get(url)
  let data = null
  try {
    const res = await fetch(url)
    if (res.ok) {
      const j = await res.json()
      if (j && Array.isArray(j.features)) data = j
    }
  } catch (e) {
    /* 缺数据不是错误：地图上本来就有无河可画的层级 */
  }
  cache.set(url, data)
  return data
}

/** 按当前层级挑水系数据：县级优先用该县自己的 OSM 数据，没有就回退全国数据 */
export function hydroUrls(mode, adcode) {
  if (mode === 'town' || mode === 'village') {
    return [`geo/hydro/${adcode}_water.json`, 'geo/hydro/rivers_china.json', 'geo/hydro/lakes_china.json']
  }
  return ['geo/hydro/rivers_china.json', 'geo/hydro/lakes_china.json']
}

/**
 * 生成一条沿折线的带子（ribbon）。
 * Three.js 的 LineBasicMaterial.linewidth 在多数平台被忽略（永远是 1px），
 * 想要「有宽度的河」只能自己铺三角带。
 * @param {THREE.Vector3[]} pts 同一高度上的折线顶点
 * @param {number} halfW 带子半宽（世界单位）
 * @param {number} offset 相对中心线的横向偏移（画双线时用）
 */
function ribbon(pts, halfW, offset = 0) {
  const n = pts.length
  if (n < 2) return null
  const pos = new Float32Array(n * 2 * 3)
  const idx = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    // 切向用前后点差分；端点退化成单边差分
    const prev = pts[i - 1] || p
    const next = pts[i + 1] || p
    a.subVectors(next, prev).setY(0)
    if (a.lengthSq() < 1e-9) a.set(1, 0, 0)
    a.normalize()
    // XZ 平面内的法向
    b.set(-a.z, 0, a.x)
    const c1 = offset - halfW
    const c2 = offset + halfW
    const o = i * 6
    pos[o] = p.x + b.x * c1
    pos[o + 1] = p.y
    pos[o + 2] = p.z + b.z * c1
    pos[o + 3] = p.x + b.x * c2
    pos[o + 4] = p.y
    pos[o + 5] = p.z + b.z * c2
    if (i < n - 1) {
      const k = i * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * 经纬度折线 → 世界坐标折线。
 * 全国水系数据在下钻到县时绝大多数点在视野外，若不裁剪照样会生成三角带
 * （几何量巨大、还会甩出画面外的长条），这里按视图范围切开，只留下视野内的段。
 */
function toWorldSegments(coords, projection, W, y, margin = W * 0.06) {
  const lim = W / 2 + margin
  const segs = []
  let cur = []
  for (const c of coords) {
    const p = geoToWorld(projection, W, y, c[0], c[1])
    const inside = p && Math.abs(p.x) <= lim && Math.abs(p.z) <= lim
    if (inside) {
      cur.push(p)
    } else {
      if (cur.length >= 2) segs.push(cur)
      cur = []
    }
  }
  if (cur.length >= 2) segs.push(cur)
  return segs
}

/**
 * 建水系图层。
 * 画法照搬旧舆图：先铺一条淡色「水面」，再沿两岸各压一条墨线 ——
 * 近看是双线河，远看是一条水系，这正是民国地形图的河川符号。
 */
export function createHydroLayer({
  collections = [],
  projection,
  W = 1024,
  y = 0,
  water = 0x2f4858,   // 水面：靛青
  ink = 0x2b2b28,     // 岸线：墨
  scale = 1
} = {}) {
  const group = new THREE.Group()
  group.name = 'hydro'
  const waterMat = new THREE.MeshBasicMaterial({
    color: water,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const bankMat = new THREE.MeshBasicMaterial({
    color: ink,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const lakeMat = new THREE.MeshBasicMaterial({
    color: water,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const lakeEdgeMat = new THREE.LineBasicMaterial({
    color: ink,
    transparent: true,
    opacity: 0.7,
    depthWrite: false
  })

  // 河宽按画面比例给：各级视图里河都保持同样的视觉粗细（舆图是示意性的，
  // 不承诺实际河宽），但保留一点点层级差异，下钻后河看起来更"大"
  const bodyW = W * 0.0052 * scale
  const bankW = W * 0.0011 * scale

  let rivers = 0
  let lakes = 0
  const disposables = []

  for (const col of collections) {
    if (!col || !col.features) continue
    for (const f of col.features) {
      const g = f.geometry
      if (!g) continue
      if (g.type === 'LineString') {
        for (const pts of toWorldSegments(g.coordinates, projection, W, y)) {
          // 水面
          const gb = ribbon(pts, bodyW / 2, 0)
          if (gb) {
            group.add(new THREE.Mesh(gb, waterMat))
            disposables.push(gb)
          }
          // 两岸：双边各一条细墨线，中间留出水的淡色
          const gap = bodyW / 2 + bankW / 2
          for (const off of [-gap, gap]) {
            const gk = ribbon(pts, bankW / 2, off)
            if (gk) {
              group.add(new THREE.Mesh(gk, bankMat))
              disposables.push(gk)
            }
          }
          rivers++
        }
      } else if (g.type === 'Polygon' && g.coordinates && g.coordinates[0]) {
        const ring = g.coordinates[0]
        const segs = toWorldSegments(ring, projection, W, y)
        // 湖泊要整圈都在视野内才画：被切开的多边形没法正确填充
        if (segs.length !== 1 || segs[0].length < 4) continue
        const pts = segs[0]
        // 水域：从首点扇形铺三角
        const pos = new Float32Array((pts.length - 1) * 9)
        let o = 0
        for (let i = 1; i < pts.length - 1; i++) {
          const p0 = pts[0]
          const p1 = pts[i]
          const p2 = pts[i + 1]
          pos[o++] = p0.x; pos[o++] = p0.y; pos[o++] = p0.z
          pos[o++] = p1.x; pos[o++] = p1.y; pos[o++] = p1.z
          pos[o++] = p2.x; pos[o++] = p2.y; pos[o++] = p2.z
        }
        const gl = new THREE.BufferGeometry()
        gl.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        group.add(new THREE.Mesh(gl, lakeMat))
        disposables.push(gl)
        // 岸线
        const ge = new THREE.BufferGeometry().setFromPoints(pts)
        group.add(new THREE.Line(ge, lakeEdgeMat))
        disposables.push(ge)
        lakes++
      }
    }
  }

  return {
    group,
    count: { rivers, lakes },
    dispose() {
      for (const g of disposables) g.dispose()
      waterMat.dispose()
      bankMat.dispose()
      lakeMat.dispose()
      lakeEdgeMat.dispose()
    }
  }
}
