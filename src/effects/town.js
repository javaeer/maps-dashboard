// 镇级点位渲染：在已渲染的「区县所属上级地图」之上叠加乡镇/街道标记
// 每个标记 = 竖直光柱 + 发光点 Sprite + 文字标签 Sprite
// 坐标复用当前地图的墨卡托投影，保证点位精确落在对应区县范围内
import * as THREE from 'three'

let _dotTex = null
function dotTexture() {
  if (_dotTex) return _dotTex
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(94,234,212,0.95)')
  g.addColorStop(1, 'rgba(94,234,212,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  _dotTex = new THREE.CanvasTexture(c)
  return _dotTex
}

function labelTexture(text) {
  const w = 256
  const h = 64
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.font = 'bold 30px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = 6
  ctx.fillStyle = '#d7fff6'
  ctx.fillText(text, w / 2, h / 2)
  return new THREE.CanvasTexture(c)
}

// 把 (lng,lat) 投影到与地图一致的世界坐标（顶面 y = depth）
export function geoToWorld(projection, W, depth, lng, lat) {
  const p = projection([lng, lat])
  if (!p) return null
  const x = p[0] - W / 2
  const y = W / 2 - p[1]
  return new THREE.Vector3(x, depth, -y)
}

// ---------- 合成坐标的县域内重新铺开 ----------
// build-towns.mjs 生成的坐标 = 区县质心 + 微抖动，叠在市图上看不出问题，
// 但渲染县级底图后会挤在县中心一小团。此处运行时检测：若点位分布范围
// 明显小于县域（< 45% 半对角线），则用「网格 + 抖动」在县多边形内重新
// 铺开（射线法做点内多边形判断），使点位均匀覆盖全县。手工精修的真实
// 坐标（分布范围大）不会被改动。

function pointInRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const hit =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

function pointInGeometry(lng, lat, geometry) {
  const polys =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []
  for (const poly of polys) {
    if (!pointInRing(lng, lat, poly[0])) continue
    let inHole = false
    for (let h = 1; h < poly.length; h++) {
      if (pointInRing(lng, lat, poly[h])) {
        inHole = true
        break
      }
    }
    if (!inHole) return true
  }
  return false
}

export function spreadTowns(feature, towns) {
  if (!feature || !feature.geometry || !towns || towns.length < 3) return towns

  // 县域 bbox
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minLng) minLng = c[0]
      if (c[0] > maxLng) maxLng = c[0]
      if (c[1] < minLat) minLat = c[1]
      if (c[1] > maxLat) maxLat = c[1]
    } else {
      for (const x of c) walk(x)
    }
  }
  walk(feature.geometry.coordinates)

  const cx = (minLng + maxLng) / 2
  const cy = (minLat + maxLat) / 2
  const K = 0.82 // 1° 经度 ≈ 0.82 × 1° 纬度的地面距离（按 35°N 估）
  const halfDiag = Math.hypot((maxLng - minLng) * K, maxLat - minLat) / 2

  // 合成坐标检测：点位最远距离 < 45% 半对角线 → 视为聚堆，需重铺
  const maxDist = Math.max(
    ...towns.map((t) => Math.hypot((t.lng - cx) * K, t.lat - cy))
  )
  if (maxDist > halfDiag * 0.45) return towns

  // 「网格 + 抖动」候选点（加密 4 倍），射线法过滤出县域内的点
  const n = towns.length
  const aspect = ((maxLng - minLng) * K) / Math.max(maxLat - minLat, 1e-9)
  const cols = Math.max(2, Math.round(Math.sqrt(n / Math.max(aspect, 0.2))))
  const rows = Math.max(2, Math.ceil(n / cols))
  let seed = (n * 2654435761) % 2147483647
  const rnd = () => {
    seed = (seed * 48271) % 2147483647
    return seed / 2147483647
  }
  const C = cols * 4
  const R = rows * 4
  const pts = []
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const u = (c + 0.15 + rnd() * 0.7) / C
      const v = (r + 0.15 + rnd() * 0.7) / R
      const lng = minLng + u * (maxLng - minLng)
      const lat = minLat + v * (maxLat - minLat)
      if (pointInGeometry(lng, lat, feature.geometry)) pts.push([lng, lat])
    }
  }
  if (pts.length < n) return towns // 候选不足，保守不动

  // 确定性洗牌后按序分配，保证每次渲染结果一致
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = pts[i]
    pts[i] = pts[j]
    pts[j] = tmp
  }
  return towns.map((t, i) =>
    pts[i] ? { ...t, lng: pts[i][0], lat: pts[i][1] } : t
  )
}

// 乡镇名标签（悬停/选中时显示）。world 为世界坐标（已含县顶面偏移）
export function createTownLabel(text, world) {
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: labelTexture(text),
      transparent: true,
      depthWrite: false,
      depthTest: false
    })
  )
  label.scale.set(150, 38, 1)
  if (world) label.position.copy(world).add(new THREE.Vector3(0, 30, 0))
  label.renderOrder = 5
  // 标签只是装饰，必须排除出射线检测：它浮在乡镇上方，会先于多边形被命中，
  // 而其父级是 townGroup（不是要素组），导致点击上溯不到 userData.town 而落空。
  // 注：three r160 的 raycast 不跳过 visible=false 的对象，光靠隐藏标签无效。
  label.raycast = () => {}
  return label
}

// 生成单个镇标记 Group；town = { name, lng, lat, ... }
export function createTownMarker(town, projection, W, depth) {
  const world = geoToWorld(projection, W, depth, town.lng, town.lat)
  if (!world) return null

  const g = new THREE.Group()
  g.position.copy(world)

  const pillarH = depth + 26
  const pg = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, pillarH, 0)
  ])
  const line = new THREE.Line(
    pg,
    new THREE.LineBasicMaterial({
      color: 0x5eead4,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  g.add(line)

  const dot = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: dotTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  )
  // 缩小光点：一个区县常有几十个镇，过大 + 加色混合 + 辉光会糊成白色光斑
  dot.scale.set(9, 9, 1)
  dot.position.set(0, pillarH + 4, 0)
  g.add(dot)

  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: labelTexture(town.name),
      transparent: true,
      depthWrite: false
    })
  )
  label.scale.set(100, 25, 1)
  label.position.set(0, pillarH + 22, 0)
  label.visible = false // 标签默认隐藏，悬停/选中时显示，避免密集区县标签全部叠加
  label.raycast = () => {} // 同上：装饰性标签不参与拾取
  g.add(label)

  g.userData.town = town
  g.userData.dot = dot
  g.userData.label = label
  return g
}
