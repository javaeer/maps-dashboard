/**
 * 军事要素图层：把导入的驻军 / 布防 / 行军路线等要素画到地图上。
 *
 * 画法遵循兵要地志的符号体系（纸质主题下）：墨线勾符号、朱砂标要地、折线带行进箭头。
 * 电子主题下同一套几何换成亮色描边，保持大屏可读性。
 *
 * 定位一律走经纬度投影，与行政区划图层同源；换层级（下钻 / 返回）后只要重投影即可，
 * 不需要重新导入。
 *
 * 尺寸口径：军标是「图面符号」不是「地面物体」——符号、标牌、线宽、箭头全部按
 * 屏幕像素标定（unitPerPx 换算成世界单位），缩放 / 下钻后图面观感一致，
 * 不会出现"全国视图一面旗盖住半个省、县级视图又小成一粒墨点"的比例失调。
 */
import * as THREE from 'three'
import { geoToWorld } from '../effects/town.js'
import { milKind } from '../utils/militarySchema.js'

/** 图面尺寸基准（屏幕像素）：符号 / 标牌 / 线宽都从这里换算 */
const SYM_PX = 38       // 军标符号（贴图含留白，视觉约 28px）
const SYM_TEX = 256     // 符号贴图分辨率（4x 超采样，缩到 38px 仍锐利）
const SYM_DRAW = 0.72   // 符号在贴图中的占比（其余留白给描边与呼吸感）
const LIFT_PX = 4       // 符号底部离地（像素）
const LABEL_CHAR_PX = 13 // 标牌主名字号（像素）
const LABEL_GAP_PX = 5  // 标牌与符号顶的间距（像素）
const LINE_PX = 4       // 折线带宽（像素）
const ARROW_PX = 11     // 行进箭头尺寸（像素）
const ARROW_GAP_PX = 78 // 箭头沿线间距（像素，不足则至少摆 2 个）
const FALLBACK_UPP = 1.75 // 拿不到相机参数时的兜底（≈ 全国视图的量级）

/** 十六进制色值 → CSS 字符串 */
function css(hex) {
  return '#' + Number(hex).toString(16).padStart(6, '0')
}

function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + rr, y)
  g.lineTo(x + w - rr, y)
  g.quadraticCurveTo(x + w, y, x + w, y + rr)
  g.lineTo(x + w, y + h - rr)
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  g.lineTo(x + rr, y + h)
  g.quadraticCurveTo(x, y + h, x, y + h - rr)
  g.lineTo(x, y + rr)
  g.quadraticCurveTo(x, y, x + rr, y)
  g.closePath()
}

/* ------------------------------------------------------------------ */
/* 军标符号                                                            */
/* ------------------------------------------------------------------ */

/** 符号贴图缓存：同类型同主题只画一次（几十个要素共用几张 256px 贴图） */
const texCache = new Map()

/**
 * 按类型画符号。纸质主题=纸色衬底 + 墨线朱砂；电子主题=深色衬底 + 亮色描边。
 * 衬底（halo）是地图注记的标准做法：符号压在晕渲 / 河流上仍然清晰，
 * 不会和底图线条糊成一片。
 * @param {string} kindKey
 * @param {object|null} paper 兵要地志的纸感配置
 */
function symbolTexture(kindKey, paper) {
  const k = milKind(kindKey)
  const key = `${k.key}|${paper ? 'p' : 'e'}`
  const hit = texCache.get(key)
  if (hit) return hit

  const s = SYM_TEX
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')
  const cx = s / 2
  const cy = s / 2
  const R = s * SYM_DRAW * 0.5
  const main = paper ? css(k.color) : '#ffd9a0'
  const line = paper ? css(paper.ink) : '#e8f6ff'
  // 贴图是 4x 超采样：线宽按同比例放大，缩到屏幕 38px 后约 1.9px，细而不糊
  const lw = s * 0.055
  const haloW = lw * 2.1
  const halo = paper ? 'rgba(253, 247, 230, 0.9)' : 'rgba(6, 16, 32, 0.85)'

  g.lineJoin = 'round'
  g.lineCap = 'round'

  // 每个符号拆成若干「零件」：零件自带路径构造，统一走
  // 衬底 → 填色 → 墨线 三遍（衬底把符号和底图的晕渲 / 河线隔开，这是地图注记的标准做法）
  const parts = []
  const line_ = (draw) => parts.push({ draw, fill: false, stroke: true })
  const solid = (draw) => parts.push({ draw, fill: true, stroke: true })
  const blob = (draw) => parts.push({ draw, fill: true, stroke: false })

  switch (k.key) {
    case 'garrison': {
      // 驻军：旗杆 + 燕尾旗（军标里最典型的"驻"符号），杆脚一枚圆座钉在图上
      line_(() => {
        g.beginPath()
        g.moveTo(cx - R * 0.42, cy + R)
        g.lineTo(cx - R * 0.42, cy - R)
      })
      blob(() => {
        g.beginPath()
        g.arc(cx - R * 0.42, cy + R, lw * 0.85, 0, Math.PI * 2)
      })
      solid(() => {
        g.beginPath()
        g.moveTo(cx - R * 0.42, cy - R)
        g.lineTo(cx + R * 0.92, cy - R * 0.55)
        g.lineTo(cx + R * 0.1, cy - R * 0.08)
        g.lineTo(cx + R * 0.92, cy + R * 0.42)
        g.lineTo(cx - R * 0.42, cy + R * 0.82)
        g.closePath()
      })
      break
    }
    case 'command': {
      // 指挥所：旗杆 + 小三角旗 + 底部横杠，与驻军的大旗面区分
      line_(() => {
        g.beginPath()
        g.moveTo(cx - R * 0.42, cy + R)
        g.lineTo(cx - R * 0.42, cy - R)
      })
      solid(() => {
        g.beginPath()
        g.moveTo(cx - R * 0.42, cy - R)
        g.lineTo(cx + R * 0.86, cy - R * 0.42)
        g.lineTo(cx - R * 0.42, cy + R * 0.1)
        g.closePath()
      })
      line_(() => {
        g.beginPath()
        g.moveTo(cx - R, cy + R)
        g.lineTo(cx + R, cy + R)
      })
      break
    }
    case 'defense': {
      // 布防：盾形（上宽下尖）
      solid(() => {
        g.beginPath()
        g.moveTo(cx - R, cy - R * 0.85)
        g.lineTo(cx + R, cy - R * 0.85)
        g.lineTo(cx + R, cy + R * 0.25)
        g.quadraticCurveTo(cx, cy + R * 1.15, cx - R, cy + R * 0.25)
        g.closePath()
      })
      break
    }
    case 'pass': {
      // 关隘：城门（两柱 + 横梁），像"关口"
      line_(() => {
        g.beginPath()
        g.moveTo(cx - R * 0.66, cy + R)
        g.lineTo(cx - R * 0.66, cy - R * 0.15)
        g.moveTo(cx + R * 0.66, cy + R)
        g.lineTo(cx + R * 0.66, cy - R * 0.15)
      })
      solid(() => {
        g.beginPath()
        g.moveTo(cx - R, cy - R * 0.12)
        g.lineTo(cx + R, cy - R * 0.12)
        g.lineTo(cx + R * 0.62, cy - R * 0.62)
        g.lineTo(cx - R * 0.62, cy - R * 0.62)
        g.closePath()
      })
      break
    }
    case 'fort': {
      // 堡寨：带垛口的方块
      solid(() => {
        g.beginPath()
        g.moveTo(cx - R, cy + R)
        g.lineTo(cx - R, cy - R * 0.4)
        g.lineTo(cx - R * 0.6, cy - R * 0.4)
        g.lineTo(cx - R * 0.6, cy - R * 0.8)
        g.lineTo(cx - R * 0.2, cy - R * 0.8)
        g.lineTo(cx - R * 0.2, cy - R * 0.4)
        g.lineTo(cx + R * 0.2, cy - R * 0.4)
        g.lineTo(cx + R * 0.2, cy - R * 0.8)
        g.lineTo(cx + R * 0.6, cy - R * 0.8)
        g.lineTo(cx + R * 0.6, cy - R * 0.4)
        g.lineTo(cx + R, cy - R * 0.4)
        g.lineTo(cx + R, cy + R)
        g.closePath()
      })
      break
    }
    case 'camp': {
      // 营地：三角帐篷
      solid(() => {
        g.beginPath()
        g.moveTo(cx, cy - R)
        g.lineTo(cx + R * 0.92, cy + R * 0.75)
        g.lineTo(cx - R * 0.92, cy + R * 0.75)
        g.closePath()
      })
      break
    }
    case 'battle': {
      // 战场：交叉双箭
      for (const sgn of [1, -1]) {
        line_(() => {
          g.beginPath()
          g.moveTo(cx - R * sgn, cy - R)
          g.lineTo(cx + R * sgn, cy + R)
        })
        blob(() => {
          g.beginPath()
          g.moveTo(cx + R * sgn, cy + R)
          g.lineTo(cx + R * sgn * 0.25, cy + R)
          g.lineTo(cx + R * sgn, cy + R * 0.25)
          g.closePath()
        })
      }
      break
    }
    case 'supply': {
      // 补给：方框 + 十字
      solid(() => {
        g.beginPath()
        g.rect(cx - R * 0.88, cy - R * 0.88, R * 1.76, R * 1.76)
      })
      line_(() => {
        g.beginPath()
        g.moveTo(cx - R * 0.44, cy)
        g.lineTo(cx + R * 0.44, cy)
        g.moveTo(cx, cy - R * 0.44)
        g.lineTo(cx, cy + R * 0.44)
      })
      break
    }
    default: {
      // 未分类：空心圆 + 中心点，不假装知道它是什么
      solid(() => {
        g.beginPath()
        g.arc(cx, cy, R * 0.85, 0, Math.PI * 2)
      })
      parts.push({
        draw: () => {
          g.beginPath()
          g.arc(cx, cy, lw * 0.8, 0, Math.PI * 2)
        },
        fill: true,
        stroke: false,
        fillStyle: line
      })
      break
    }
  }

  // 1) 衬底：粗描一圈，把底图隔开
  g.save()
  g.strokeStyle = halo
  g.lineWidth = haloW
  for (const p of parts) { p.draw(); g.stroke() }
  g.restore()
  // 2) 填色
  for (const p of parts) {
    if (!p.fill) continue
    g.save()
    g.globalAlpha = paper ? 0.94 : 0.62
    g.fillStyle = p.fillStyle || main
    p.draw()
    g.fill()
    g.restore()
  }
  // 3) 墨线
  g.save()
  g.strokeStyle = line
  g.lineWidth = lw
  for (const p of parts) {
    if (!p.stroke) continue
    p.draw()
    g.stroke()
  }
  g.restore()

  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  texCache.set(key, tex)
  return tex
}

/* ------------------------------------------------------------------ */
/* 名称标牌                                                            */
/* ------------------------------------------------------------------ */

/**
 * 名称标牌：只写名称——类型由符号的形状与颜色表达（图例里也有），
 * 标牌里再抄一遍类型只会把牌子撑大一圈，图面立刻变吵。
 * 纸质=墨框纸底宋体；电子=深色玻璃底板。字号按屏幕像素标定（见 scaleLabel）。
 */
function labelTexture(name, paper) {
  const FONT = 44
  const padX = 24
  const text = String(name || '').slice(0, 18)
  const w = Math.max(150, Math.ceil(text.length * FONT * 0.62 + padX * 2))
  const h = 76
  const tail = 12

  const c = document.createElement('canvas')
  c.width = w
  c.height = h + tail
  const g = c.getContext('2d')

  if (paper) {
    g.shadowColor = 'rgba(70, 52, 30, 0.28)'
    g.shadowBlur = 5
    g.shadowOffsetY = 2
    roundRectPath(g, 4, 4, w - 8, h - 8, 5)
    g.fillStyle = 'rgba(253, 247, 230, 0.94)'
    g.fill()
    g.shadowColor = 'transparent'
    g.shadowBlur = 0
    g.shadowOffsetY = 0
    g.beginPath()
    g.moveTo(w / 2 - 7, h - 6)
    g.lineTo(w / 2 + 7, h - 6)
    g.lineTo(w / 2, h + tail - 3)
    g.closePath()
    g.fillStyle = 'rgba(253, 247, 230, 0.94)'
    g.fill()
    roundRectPath(g, 4, 4, w - 8, h - 8, 5)
    g.lineWidth = 3
    g.strokeStyle = 'rgba(43, 43, 40, 0.88)'
    g.stroke()
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `600 ${FONT}px "Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif`
    g.fillStyle = '#2b2b28'
    g.fillText(text, w / 2, h / 2 + 1)
  } else {
    g.shadowColor = 'rgba(8, 20, 38, 0.9)'
    g.shadowBlur = 10
    roundRectPath(g, 5, 5, w - 10, h - 10, 12)
    g.fillStyle = 'rgba(9, 22, 42, 0.85)'
    g.fill()
    g.shadowColor = 'transparent'
    g.shadowBlur = 0
    g.beginPath()
    g.moveTo(w / 2 - 8, h - 7)
    g.lineTo(w / 2 + 8, h - 7)
    g.lineTo(w / 2, h + tail - 3)
    g.closePath()
    g.fillStyle = 'rgba(9, 22, 42, 0.85)'
    g.fill()
    roundRectPath(g, 5, 5, w - 10, h - 10, 12)
    g.lineWidth = 2
    g.strokeStyle = 'rgba(255, 217, 160, 0.75)'
    g.stroke()
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `600 ${FONT}px "PingFang SC", "Microsoft YaHei", sans-serif`
    g.fillStyle = '#ffe9c8'
    g.fillText(text, w / 2, h / 2 + 1)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return { tex, w: c.width, h: c.height, tail }
}

/* ------------------------------------------------------------------ */
/* 折线：三角带 + 行进箭头                                              */
/* ------------------------------------------------------------------ */

/** 世界坐标折线 → 平铺三角带（LineBasicMaterial 的 linewidth 在多数平台无效，只能自己铺面） */
function ribbon(pts, halfW) {
  if (pts.length < 2) return null
  const pos = []
  const idx = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[i - 1] || pts[i]
    const next = pts[i + 1] || pts[i]
    let dx = next.x - prev.x
    let dz = next.z - prev.z
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    // 平面内法向：绕 Y 轴转 90°
    const nx = -dz * halfW
    const nz = dx * halfW
    const p = pts[i]
    pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz)
    if (i > 0) {
      const a = (i - 1) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/** 沿折线摆箭头：直接把三角形顶点写进 XZ 平面，朝向由切线决定（Sprite 做不到这点） */
function arrows(pts, size, gap) {
  if (pts.length < 2) return null
  // 累计弧长，按间距均匀取点（含方向）
  const segs = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    if (d < 1e-6) continue
    segs.push({ a, b, d, s: total })
    total += d
  }
  if (!segs.length || total < 1e-6) return null
  const n = Math.max(2, Math.round(total / gap))
  const pos = []
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * (total / n)
    const sg = segs.find((s) => t >= s.s && t <= s.s + s.d) || segs[segs.length - 1]
    const k = Math.min(1, Math.max(0, (t - sg.s) / sg.d))
    const x = sg.a.x + (sg.b.x - sg.a.x) * k
    const z = sg.a.z + (sg.b.z - sg.a.z) * k
    const y = sg.a.y + (sg.b.y - sg.a.y) * k
    let dx = sg.b.x - sg.a.x
    let dz = sg.b.z - sg.a.z
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const px = -dz
    const pz = dx
    pos.push(
      x + dx * size, y, z + dz * size,
      x - dx * size * 0.4 + px * size * 0.62, y, z - dz * size * 0.4 + pz * size * 0.62,
      x - dx * size * 0.4 - px * size * 0.62, y, z - dz * size * 0.4 - pz * size * 0.62
    )
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeBoundingSphere()
  return g
}

/**
 * 构建军事要素图层。
 * @param {Object[]} features 要素（含 shape / point{lng,lat} / path[{lng,lat}]）
 * @param {Function} projection 当前视图的投影函数
 * @param {number} W 地图宽度（与 geoToWorld 口径一致）
 * @param {number} y 基准高度（要素顶面之上）
 * @param {object|null} paper 纸感配置
 * @param {boolean} labels 是否显示名称标牌
 * @param {number} unitPerPx 当前视图下 1 屏幕像素 = 多少世界单位（图面尺寸的换算基准）
 * @returns {{group, pickables, count, dispose, setLabels, setScreenScale}}
 */
export function createMilitaryLayer({
  features = [], projection, W = 1024, y = 0, paper = null, labels = true,
  unitPerPx = FALLBACK_UPP
} = {}) {
  const group = new THREE.Group()
  group.name = 'military-layer'
  const pickables = []
  const disposables = []
  let count = 0
  let upp = unitPerPx > 0 ? unitPerPx : FALLBACK_UPP

  /** 屏幕像素 → 世界单位 */
  const px = (n) => n * upp
  /** 符号的世界尺寸与离地高度（随视角变化，由 setScreenScale 重标定） */
  const symWorld = () => px(SYM_PX)
  const symLift = () => px(LIFT_PX + (SYM_PX * SYM_DRAW) / 2)
  const labelWorldH = () => px(((76 + 12) * LABEL_CHAR_PX) / 44)

  const labelItems = []
  const symItems = []

  /**
   * 标牌定位：图像底部（含小尾巴）对齐到锚点上方 ——
   * 点要素锚在符号视觉顶，线要素锚在路径中点上方固定抬升处。
   */
  const labelCenterY = (anchorY, isPoint) => {
    const top = isPoint
      ? anchorY + symLift() + px((SYM_PX * SYM_DRAW) / 2)
      : anchorY + px(30)
    return top + px(LABEL_GAP_PX) + labelWorldH() / 2
  }

  const addLabel = (text, world, isPoint) => {
    if (!labels) return
    const { tex, w, h } = labelTexture(text, paper)
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false // 标牌浮在要素之上，不被前面的板块切掉
      })
    )
    const wh = labelWorldH()
    sp.scale.set((w / h) * wh, wh, 1)
    sp.position.set(world.x, labelCenterY(world.y, isPoint), world.z)
    sp.renderOrder = 16
    sp.raycast = () => {}
    sp.userData.isLabel = true
    sp.userData.anchorY = world.y
    sp.userData.anchorLine = !isPoint
    group.add(sp)
    labelItems.push(sp)
    disposables.push(tex, sp.material)
  }

  for (const f of features) {
    const k = milKind(f.kind)
    if (f.shape === 'line' && Array.isArray(f.path) && f.path.length >= 2) {
      const pts = []
      for (const p of f.path) {
        const v = geoToWorld(projection, W, y, p.lng, p.lat)
        if (v) pts.push(v)
      }
      if (pts.length < 2) continue

      const color = new THREE.Color(paper ? k.color : 0xffd9a0)
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: paper ? 0.95 : 0.85,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      disposables.push(mat)

      const body = ribbon(pts, px(LINE_PX) / 2)
      if (body) {
        const mesh = new THREE.Mesh(body, mat)
        mesh.userData.milFeature = f
        mesh.renderOrder = 13
        group.add(mesh)
        pickables.push(mesh)
        disposables.push(body)
      }
      const ag = arrows(pts, px(ARROW_PX), px(ARROW_GAP_PX))
      if (ag) {
        const am = new THREE.Mesh(ag, mat)
        am.renderOrder = 14
        am.raycast = () => {}
        group.add(am)
        disposables.push(ag)
      }
      // 标牌落在路径中点
      const mid = pts[Math.floor(pts.length / 2)]
      addLabel(f.name, mid, false)
      count++
      continue
    }

    // --- 点要素 ---
    const p = f.point
    if (!p) continue
    const world = geoToWorld(projection, W, y, p.lng, p.lat)
    if (!world) continue
    const tex = symbolTexture(f.kind, paper)
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        // 纸质主题下符号是"盖在纸上的墨印"，不能加色混合（会把纸烧白）
        blending: paper ? THREE.NormalBlending : THREE.AdditiveBlending,
        opacity: paper ? 1 : 0.95
      })
    )
    sp.scale.set(symWorld(), symWorld(), 1)
    sp.position.set(world.x, world.y + symLift(), world.z)
    sp.renderOrder = 15
    sp.userData.milFeature = f
    sp.userData.anchorY = world.y
    group.add(sp)
    pickables.push(sp)
    symItems.push(sp)
    // 符号贴图来自模块级缓存（同类型共用），dispose 时不能销毁它，只销毁材质
    disposables.push(sp.material)
    addLabel(f.name, world, true)
    count++
  }

  /** 视角变化后重标定符号与标牌的屏幕尺寸（锚点不动，只改 scale / 高度） */
  const applyScale = () => {
    const sw = symWorld()
    const wh = labelWorldH()
    for (const sp of symItems) {
      sp.scale.set(sw, sw, 1)
      sp.position.y = sp.userData.anchorY + symLift()
    }
    for (const sp of labelItems) {
      const img = sp.material.map && sp.material.map.image
      if (!img) continue
      sp.scale.set((img.width / img.height) * wh, wh, 1)
      sp.position.y = labelCenterY(sp.userData.anchorY, !sp.userData.anchorLine)
    }
  }

  const out = {
    group,
    pickables,
    count,
    /** 名称标牌显隐：符号与线本体保持显示，只收标牌 */
    setLabels(v) {
      for (const sp of labelItems) sp.visible = !!v
    },
    /**
     * 视角变化后按新的 unitPerPx 重标定图面尺寸。
     * @param {number} nextUpp 世界单位 / 屏幕像素
     */
    setScreenScale(nextUpp) {
      if (!(nextUpp > 0)) return
      const prev = upp
      upp = nextUpp
      // 变化太小就不折腾（滚轮微缩时避免每帧重算几何）
      if (Math.abs(nextUpp - prev) / prev < 0.02) { upp = prev; return }
      applyScale()
    },
    dispose() {
      for (const d of disposables) {
        if (d && typeof d.dispose === 'function') d.dispose()
      }
      disposables.length = 0
      pickables.length = 0
      labelItems.length = 0
      symItems.length = 0
      group.clear()
    }
  }
  out.setLabels(labels)
  return out
}
