// 地形图层：晕渲（hillshade）+ 山头符号。
//
// 数据源：AWS Terrain Tiles（terrarium 编码，源自 SRTM / GMTED2010 / NED 等公开高程，免密钥）。
// 该桶不返回 CORS 头，浏览器读不到像素，所以高程→晕渲的换算是本机预生成的
// （见 public/geo/terrain/{key}.png 与同名 .json 里的 source 字段）。
// 本文件只负责把预生成的灰度图贴到正确的地理位置上。

import * as THREE from 'three'
import { geoToWorld } from '../effects/town.js'

const cache = new Map()

/**
 * 读一份地形数据：meta(json) + 灰度晕渲(png)。
 * 灰度定义：255 = 受光/平坦，数值越小越暗（阴影越重）。
 */
export async function loadTerrain(url) {
  if (cache.has(url)) return cache.get(url)
  let out = null
  try {
    const res = await fetch(`${url}.json`)
    if (res.ok) {
      const meta = await res.json()
      const tex = await loadShadeTexture(`${url}.png`)
      if (meta && tex) out = { meta, tex }
    }
  } catch (e) {
    /* 缺地形数据不报错，地图上本来就有不需要晕渲的场景 */
  }
  cache.set(url, out)
  return out
}

/** 灰度晕渲 → 只保留「暗部」的 alpha 纹理：受光面一律留白（纸色），只把阴影画上去 */
function loadShadeTexture(pngUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height)
        const px = d.data
        // 平坦面的基准灰度（hillshade 里 sin(45°) 经同样的线性拉伸后的值）
        const BASE = 190
        for (let i = 0; i < px.length; i += 4) {
          const v = px[i]
          let a = 0
          if (v < BASE) a = Math.min(1, ((BASE - v) / BASE) * 1.25)
          px[i] = 255
          px[i + 1] = 255
          px[i + 2] = 255
          px[i + 3] = Math.round(a * 255)
        }
        g.putImageData(d, 0, 0)
        const tex = new THREE.CanvasTexture(c)
        tex.anisotropy = 4
        resolve(tex)
      } catch (e) {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = pngUrl
  })
}

/**
 * 铺晕渲平面。
 * 关键：不能简单按 bbox 四角摆一个矩形 —— 多数投影下经纬网格不是轴对齐矩形。
 * 这里按 UV 逐顶点反算经纬度再投影，保证纹理和行政边界严格对齐。
 */
export function createTerrainMesh({ meta, tex, projection, W = 1024, y = 0, color = 0x6b5a3c, opacity = 0.85 } = {}) {
  const [lon0, lat0, lon1, lat1] = meta.bbox
  const N = 96
  const geo = new THREE.PlaneGeometry(1, 1, N, N)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i)
    const w = uv.getY(i) // uv.y = 1 在顶边（北）
    const lng = lon0 + (lon1 - lon0) * u
    const lat = lat0 + (lat1 - lat0) * w
    const p = geoToWorld(projection, W, y, lng, lat)
    if (p) v.copy(p)
    else v.set(0, y, 0)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  // 平面被重排过，包围球要重算，否则视锥剔除会把它整块裁掉
  geo.computeBoundingSphere()

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.raycast = () => {} // 晕渲层不参与拾取
  mesh.name = 'terrain-shade'
  return { mesh, dispose: () => { geo.dispose(); mat.dispose() } }
}

/** 山头符号纹理：墨色三角（旧舆图的「山」形）+ 高程数字 */
function peakTexture(ele) {
  const w = 128
  const h = 72
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.strokeStyle = '#2b2b28'
  g.lineWidth = 3.5
  g.lineJoin = 'round'
  // 三角形：底边略呈折线，像手绘的山形而不是标准几何三角
  g.beginPath()
  g.moveTo(14, 44)
  g.lineTo(38, 22)
  g.lineTo(52, 32)
  g.lineTo(64, 14)
  g.lineTo(88, 44)
  g.closePath()
  g.stroke()
  g.fillStyle = 'rgba(43,43,40,0.14)'
  g.fill()
  g.font = '600 20px "Songti SC","STSong",serif'
  g.fillStyle = '#2b2b28'
  g.textAlign = 'center'
  g.textBaseline = 'top'
  g.fillText(`${ele}`, 51, 46)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return tex
}

/** 山头点：给一组 {lng,lat,ele} 建 Sprite */
export function createPeakMarks({ peaks = [], projection, W = 1024, y = 0, size = 46, limit = 0 } = {}) {
  const group = new THREE.Group()
  group.name = 'terrain-peaks'
  const made = []
  // 县级视图里山头太密会糊成一片，按高程取前 N 个即可
  const list = limit > 0 ? peaks.slice(0, limit) : peaks
  for (const p of list) {
    const wp = geoToWorld(projection, W, y, p.lng, p.lat)
    if (!wp) continue
    const tex = peakTexture(p.ele)
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
    const s = new THREE.Sprite(mat)
    s.scale.set(size, (size * 72) / 128, 1)
    s.position.copy(wp)
    s.raycast = () => {}
    group.add(s)
    made.push({ tex, mat })
  }
  return {
    group,
    count: made.length,
    dispose() {
      for (const m of made) {
        m.tex.dispose()
        m.mat.dispose()
      }
    }
  }
}
