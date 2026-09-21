import * as THREE from 'three'
import { geoMercator } from 'd3-geo'

// 侧面扫光 Shader（借鉴 threemap 方案）：沿拉伸高度方向做一条循环流动的亮带
const sideVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const sideFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uGlow;
  varying vec2 vUv;
  void main() {
    // vUv.y 沿拉伸高度（0=底, 1=顶），让亮带循环上下扫描
    float t = fract(vUv.y - uTime * 0.18);
    float band = exp(-pow((t - 0.5) * 7.0, 2.0));
    vec3 col = mix(uColor, uGlow, band);
    float intensity = 0.5 + band * 0.85;
    gl_FragColor = vec4(col * intensity, 1.0);
  }
`

// 把一个 feature 的几何（Polygon / MultiPolygon）转成 THREE.Shape 列表
// 投影采用 d3 geoMercator.fitSize，并把墨卡托 y（向下）翻转，使北在上方
function buildShapes(feature, projection, W, H) {
  const geom = feature.geometry
  if (!geom) return []
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  const shapes = []
  for (const poly of polys) {
    const [outer, ...holes] = poly
    const shape = new THREE.Shape()
    outer.forEach(([lon, lat], i) => {
      const p = projection([lon, lat])
      if (!p) return
      const x = p[0] - W / 2
      const y = H / 2 - p[1] // 翻转 y，保证北在上
      if (i === 0) shape.moveTo(x, y)
      else shape.lineTo(x, y)
    })
    shape.closePath()
    for (const hole of holes) {
      const hp = new THREE.Path()
      hole.forEach(([lon, lat], i) => {
        const p = projection([lon, lat])
        if (!p) return
        const x = p[0] - W / 2
        const y = H / 2 - p[1]
        if (i === 0) hp.moveTo(x, y)
        else hp.lineTo(x, y)
      })
      hp.closePath()
      shape.holes.push(hp)
    }
    shapes.push(shape)
  }
  return shapes
}

// 手动计算 GeoJSON 的平面经纬度包围盒
// 注意：不能用 d3 的 fitSize/geoBounds —— 它们按"球面多边形"语义解析环方向，
// DataV 数据的 winding 与之相反，会把每个 feature 当作覆盖全球，导致地图缩成一小条
function computeLonLatBBox(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return // 丢弃异常占位坐标
      if (lon < minX) minX = lon
      if (lon > maxX) maxX = lon
      if (lat < minY) minY = lat
      if (lat > maxY) maxY = lat
    } else {
      for (const c of coords) walk(c)
    }
  }
  ;(geojson.features || []).forEach((f) => f.geometry && walk(f.geometry.coordinates))
  return [
    [minX, minY],
    [maxX, maxY]
  ]
}

// 墨卡托投影手动适配：将 bbox 缩放居中到 [0,W]×[0,H]
function createFittedProjection(geojson, W, H) {
  const raw = geoMercator().scale(1).translate([0, 0])
  const clampLat = (lat) => Math.max(-85, Math.min(85, lat))
  const [[minLon, minLat], [maxLon, maxLat]] = computeLonLatBBox(geojson)

  const corners = [
    raw([minLon, clampLat(maxLat)]),
    raw([maxLon, clampLat(minLat)])
  ]
  const x0 = corners[0][0], x1 = corners[1][0]
  const y0 = corners[0][1], y1 = corners[1][1] // mercator y 越北越小

  const k = Math.min(W / (x1 - x0), H / (y1 - y0))
  const tx = W / 2 - (k * (x0 + x1)) / 2
  const ty = H / 2 - (k * (y0 + y1)) / 2
  return geoMercator().scale(k).translate([tx, ty])
}

// 把 GeoJSON FeatureCollection 拉伸为 3D 地图组
// 返回 { group, sideMaterials, featureGroups }
export function createExtrudedMap(geojson, opts = {}) {
  const W = opts.width || 1024
  const H = opts.height || 1024
  const depth = opts.depth || 70

  const projection = createFittedProjection(geojson, W, H)

  const group = new THREE.Group()
  // rotX = -90°：拉伸的局部 +z 变为世界 +y（向上立起），地图平铺在 xz 平面
  group.rotation.x = -Math.PI / 2

  const sideMaterials = []
  const featureGroups = []
  const features = geojson.features || []

  features.forEach((feature, idx) => {
    const shapes = buildShapes(feature, projection, W, H)
    if (!shapes.length) return

    // 科技蓝青色系：色相在 190~235 间小幅错开，饱和度/亮度统一
    const hue = 190 + (idx * 13) % 45
    const baseColor = new THREE.Color().setHSL(hue / 360, 0.68, 0.55)

    const capMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: baseColor.clone().multiplyScalar(0.18),
      metalness: 0.2,
      roughness: 0.55,
      transparent: true,
      opacity: 1
    })

    const sideMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: baseColor.clone() },
        uGlow: { value: new THREE.Color(0x9ffcff) }
      },
      vertexShader: sideVertexShader,
      fragmentShader: sideFragmentShader
    })
    sideMaterials.push(sideMat)

    const featureGroup = new THREE.Group()
    shapes.forEach((shape) => {
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: false,
        steps: 1
      })
      // ExtrudeGeometry 材质组约定：0 = 顶/底盖（cap），1 = 侧面（side）
      const mesh = new THREE.Mesh(geo, [capMat, sideMat])
      mesh.userData.feature = feature
      featureGroup.add(mesh)
    })

    // 记录区域中心的世界坐标（用于点击聚焦 / 飞线 / 脉冲）
    const c = feature.properties.center || feature.properties.centroid
    if (c) {
      const p = projection(c)
      if (p) {
        const lx = p[0] - W / 2
        const ly = H / 2 - p[1]
        featureGroup.userData.centerWorld = new THREE.Vector3(lx, depth * 0.5, -ly)
      }
    }

    featureGroup.userData.feature = feature
    featureGroup.userData.capMat = capMat
    featureGroup.userData.sideMat = sideMat
    featureGroup.userData.baseColor = baseColor
    group.add(featureGroup)
    featureGroups.push(featureGroup)
  })

  return { group, sideMaterials, featureGroups }
}
