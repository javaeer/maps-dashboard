import * as THREE from 'three'

/**
 * 路径管道：点击乡镇依次追加路径点 → 分段构建发光管道 → 供相机沿路径巡航跟拍。
 *
 * 设计要点：
 *  - 分段追加：每段是独立 TubeGeometry，追加新点只重建末尾段，
 *    历史管段不会因为新点加入而整体变形抖动（整体重建 CatmullRom 会）。
 *  - 切线连续：每段用 [p(i-1), p(i), p(i+1), p(i+2)] 四点 CatmullRom 取中间区间，
 *    保证段与段接缝处切线方向一致，看不出拼接痕迹。
 *  - 巡航采样：另用一条覆盖全部路径点的全局 CatmullRom 做弧长参数化采样，
 *    只服务于相机，不参与渲染，因此不受分段影响。
 */

// 管道流动光带：uv.x 沿管道轴向，用 fract 做循环条纹
const routeVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const routeFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uGlow;
  uniform float uSpeed;
  uniform float uRepeat;   // 条纹条数 = 段长 / 条纹物理长度，保证各段条纹密度一致
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    // 沿轴向流动的能量带
    float f = fract(vUv.x * uRepeat - uTime * uSpeed);
    float head = smoothstep(0.0, 0.10, f) * (1.0 - smoothstep(0.10, 0.46, f));
    // 菲涅尔：管道轮廓边缘更亮，正对镜头处通透，避免变成实心塑料管
    float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.0);
    float base = 0.26 + fres * 0.5;
    vec3 col = mix(uColor, uGlow, head);
    float a = (base + head * 0.75) * uOpacity;
    gl_FragColor = vec4(col * (base + head * 1.25), a);
  }
`

const STRIPE_LEN = 90   // 单条光带的物理长度（世界单位）

// 多条路径的配色轮转表：序号 % 长度 决定颜色，保证相邻路径色差足够大
export const ROUTE_COLORS = [
  { label: '青', color: 0x22d3ee, glow: 0xa5f3fc, joint: 0x7dd3fc },
  { label: '橙', color: 0xfb923c, glow: 0xfed7aa, joint: 0xfdba74 },
  { label: '紫', color: 0xa78bfa, glow: 0xddd6fe, joint: 0xc4b5fd },
  { label: '绿', color: 0x34d399, glow: 0xa7f3d0, joint: 0x6ee7b7 },
  { label: '粉', color: 0xf472b6, glow: 0xfbcfe8, joint: 0xf9a8d4 },
  { label: '黄', color: 0xfacc15, glow: 0xfef08a, joint: 0xfde047 }
]

// 纸质主题（兵要地志）的路径配色：朱砂、靛青、赭石…取自传统颜料的低饱和色，
// 不用荧光色——荧光在宣纸底上会立刻跳出来，破坏整张图的调子。
export const ROUTE_COLORS_PAPER = [
  { label: '朱砂', color: 0xa83232, glow: 0xd96464, joint: 0x8f2b2b },
  { label: '靛青', color: 0x2f4858, glow: 0x5b7f92, joint: 0x27384a },
  { label: '赭石', color: 0x9a6b3f, glow: 0xc79a6a, joint: 0x7d5432 },
  { label: '墨绿', color: 0x3f5d43, glow: 0x6f8f74, joint: 0x334a37 },
  { label: '紫檀', color: 0x6b4a6b, glow: 0x9a7f9a, joint: 0x563a56 },
  { label: '藤黄', color: 0xb08d2e, glow: 0xd8b962, joint: 0x8f7225 }
]

/** 按序号取一套配色（超出表长则轮转）；纸质主题走低饱和的颜料色 */
export function routeColorAt(i, paper = null) {
  const table = paper ? ROUTE_COLORS_PAPER : ROUTE_COLORS
  return table[((i % table.length) + table.length) % table.length]
}

// 兵锋线箭头贴图：白色实心箭头 + 描边，用路径自身的颜色染色
let _arrowTex = null
function arrowTexture() {
  if (_arrowTex) return _arrowTex
  const w = 128
  const h = 64
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  const path = new Path2D('M14 32 L52 8 L52 22 L114 22 L114 42 L52 42 L52 56 Z')
  g.fillStyle = '#ffffff'
  g.fill(path)
  g.lineWidth = 4
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  g.stroke(path)
  _arrowTex = new THREE.CanvasTexture(c)
  return _arrowTex
}

/**
 * 段曲线：对一条四点 CatmullRom 取 [1/3, 2/3] 子区间（即 c1 → c2）。
 * 直接映射原始曲线而非重采样成新曲线——重采样会在接缝处引入几度的切线偏差，
 * 发光管道上表现为可见折角。
 */
class SegmentCurve extends THREE.Curve {
  constructor(full, a = 1 / 3, b = 2 / 3) {
    super()
    this.full = full
    this.a = a
    this.b = b
  }
  getPoint(t, target = new THREE.Vector3()) {
    const u = this.a + (this.b - this.a) * THREE.MathUtils.clamp(t, 0, 1)
    return this.full.getPoint(u, target)
  }
}

/** 段 i 的曲线：连接 points[i] → points[i+1]，切线受前后邻居影响 */
function buildSegmentCurve(points, i) {
  const c0 = points[i - 1] || points[i]
  const c1 = points[i]
  const c2 = points[i + 1]
  const c3 = points[i + 2] || points[i + 1]
  const full = new THREE.CatmullRomCurve3([c0, c1, c2, c3])
  return new SegmentCurve(full)
}

/** 序号标签：canvas 贴图 Sprite */
function createIndexSprite(index) {
  const c = document.createElement('canvas')
  c.width = c.height = 96
  const g = c.getContext('2d')
  g.beginPath()
  g.arc(48, 48, 34, 0, Math.PI * 2)
  g.fillStyle = 'rgba(8, 22, 42, 0.92)'
  g.fill()
  g.lineWidth = 5
  g.strokeStyle = '#38bdf8'
  g.stroke()
  g.font = 'bold 44px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#e6f0ff'
  g.fillText(String(index), 48, 50)
  const tex = new THREE.CanvasTexture(c)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  const sp = new THREE.Sprite(mat)
  sp.scale.set(38, 38, 1)
  sp.renderOrder = 20
  return sp
}

export class RoutePath {
  constructor({
    scene,
    radius = 5.5,
    lift = 58,
    color = 0x22d3ee,
    glow = 0xa5f3fc,
    joint = 0x7dd3fc,
    name = '',
    paper = null
  } = {}) {
    this.scene = scene
    this.radius = radius
    this.lift = lift
    this.name = name
    // 纸质主题：管道弱化流动光带并沿线摆兵锋箭头（进攻方向一目了然）
    this.paper = paper
    this.arrowsOn = !!(paper && paper.arrows)
    this.color = new THREE.Color(color)
    this.glow = new THREE.Color(glow)
    this.jointColor = new THREE.Color(joint)

    // points 是「当前投影下」的世界坐标；stops 保存的是地理定位（经纬度 + 层级）。
    // 下钻 / 返回会换投影，届时用 stops 重算 points，路径才能跨层级继续存在。
    this.points = []      // 世界坐标路径点（含抬升）
    this.stops = []       // 每个点的元信息 { name, adcode, level, lngLat }
    this.segments = []    // 管段 { curve, mesh, geo, mat, length }
    this.joints = []      // 关节球 + 序号标签
    this.spline = null    // 全局巡航曲线（弧长参数化）
    this.totalLength = 0
    this.arrows = []      // 兵锋箭头（仅纸质主题）

    this.group = new THREE.Group()
    this.group.renderOrder = 5
    if (scene) scene.add(this.group)
    this._t = 0
  }

  get count() {
    return this.points.length
  }

  /**
   * 该点是否已在路径中（避免重复点击堆点）。
   * 只按名称判重会把「市→区→镇」链式下钻里的同名不同级要素误判为重复
   * （例如同名街道与同名镇），因此带上 adcode：两者都相同才算同一个点。
   */
  has(name, adcode = null) {
    const a = adcode != null ? String(adcode) : null
    return this.stops.some(s => s.name === name && (!a || s.adcode === a))
  }

  /**
   * 追加一个路径点。
   * @param {THREE.Vector3} center 要素中心的世界坐标
   * @param {object} meta  { name, adcode, level, lngLat }
   *                       lngLat 为 [经度, 纬度]，投影变化后据此重算世界坐标
   * @returns {{added:boolean, index:number, reason?:string}}
   */
  addPoint(center, meta = {}) {
    const a = meta.adcode != null ? String(meta.adcode) : null
    if (meta.name && this.has(meta.name, meta.adcode)) {
      const at = this.stops.findIndex(s => s.name === meta.name && (!a || s.adcode === a))
      return { added: false, index: at, reason: '已在路径中' }
    }
    const p = center.clone()
    p.y += this.lift
    this.points.push(p)
    this.stops.push({
      name: meta.name || '',
      adcode: meta.adcode != null ? String(meta.adcode) : null,
      level: meta.level || '',
      lngLat: meta.lngLat || null
    })
    this._addJoint(p, this.points.length)

    if (this.points.length >= 2) {
      const i = this.points.length - 2
      // 新点会改变倒数第一、二段的切线，重建这两段；更早的段已定型
      this._rebuildSegment(i)
      if (i - 1 >= 0) this._rebuildSegment(i - 1)
    }
    this._rebuildSpline()
    return { added: true, index: this.points.length - 1 }
  }

  /** 移除最后一个路径点 */
  removeLast() {
    if (!this.points.length) return false
    this.points.pop()
    this.stops.pop()
    const j = this.joints.pop()
    if (j) {
      this.group.remove(j.group)
      j.dispose()
    }
    // 删掉最后一段
    const seg = this.segments.pop()
    if (seg) {
      this.group.remove(seg.mesh)
      seg.geo.dispose()
      seg.mat.dispose()
    }
    if (this.segments.length) this._rebuildSegment(this.segments.length - 1)
    this._rebuildSpline()
    return true
  }

  clear() {
    for (const s of this.segments) {
      this.group.remove(s.mesh)
      s.geo.dispose()
      s.mat.dispose()
    }
    for (const j of this.joints) {
      this.group.remove(j.group)
      j.dispose()
    }
    this._clearArrows()
    this.segments = []
    this.joints = []
    this.points = []
    this.stops = []
    this.spline = null
    this.totalLength = 0
    this._t = 0
  }

  /** 沿整条路径按弧长比例 t∈[0,1] 采样（供相机巡航） */
  sampleAt(t) {
    if (!this.spline || this.points.length < 2) {
      const p = this.points[0]
      return p ? { position: p.clone(), tangent: new THREE.Vector3(0, 0, -1) } : null
    }
    const tt = THREE.MathUtils.clamp(t, 0, 1)
    return {
      position: this.spline.getPointAt(tt),
      tangent: this.spline.getTangentAt(tt).normalize()
    }
  }

  /** 弧长比例 → 已走过的距离（用于 HUD 显示） */
  distanceAt(t) {
    return this.totalLength * THREE.MathUtils.clamp(t, 0, 1)
  }

  update(dt) {
    this._t += dt
    for (const s of this.segments) s.mat.uniforms.uTime.value = this._t
  }

  dispose() {
    this.clear()
    if (this.scene) this.scene.remove(this.group)
  }

  // ---------- 内部 ----------

  _addJoint(p, index) {
    const geo = new THREE.SphereGeometry(this.radius * 1.9, 16, 12)
    const mat = new THREE.MeshBasicMaterial({
      color: this.jointColor,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const ball = new THREE.Mesh(geo, mat)
    ball.position.copy(p)
    const label = createIndexSprite(index)
    label.position.copy(p).add(new THREE.Vector3(0, this.radius * 4.2, 0))
    const g = new THREE.Group()
    g.add(ball)
    g.add(label)
    this.group.add(g)
    // 记下 ball / label：重投影后要同步挪动它们（二者用的是绝对世界坐标）
    this.joints.push({
      group: g,
      ball,
      label,
      dispose() {
        geo.dispose()
        mat.dispose()
        label.material.map.dispose()
        label.material.dispose()
      }
    })
  }

  /** 重建全部管段（投影变化时调用：所有点的世界坐标都变了） */
  _rebuildAllSegments() {
    for (const s of this.segments) {
      this.group.remove(s.mesh)
      s.geo.dispose()
      s.mat.dispose()
    }
    this.segments = []
    for (let i = 0; i + 1 < this.points.length; i++) this._rebuildSegment(i)
  }

  /**
   * 投影变化后重算全部路径点的世界坐标。
   * 关键约束：只要有一个点定位失败就整条路径原样保留（不重投影），
   * 避免 points 与 stops 索引错位导致管道连错地方。
   * @param {(stop:{name,adcode,level,lngLat}) => THREE.Vector3|null} mapFn 地理定位 → 世界坐标
   * @returns {{ok:boolean, reason?:string}}
   */
  reproject(mapFn) {
    if (!this.stops.length || typeof mapFn !== 'function') return { ok: true }
    const next = []
    for (const s of this.stops) {
      const w = mapFn(s)
      if (!w) return { ok: false, reason: `「${s.name || s.adcode || '未命名'}」在当前视图中无法定位` }
      next.push(w)
    }
    for (let i = 0; i < next.length; i++) {
      const p = next[i].clone()
      p.y += this.lift
      this.points[i] = p
      const j = this.joints[i]
      if (j) {
        j.ball.position.copy(p)
        j.label.position.copy(p).add(new THREE.Vector3(0, this.radius * 4.2, 0))
      }
    }
    this._rebuildAllSegments()
    this._rebuildSpline()
    return { ok: true }
  }

  /** 换配色（多条路径用不同颜色区分）；只改 uniform，不重建几何 */
  setColors({ color, glow, joint } = {}) {
    if (color != null) this.color.set(color)
    if (glow != null) this.glow.set(glow)
    if (joint != null) this.jointColor.set(joint)
    for (const s of this.segments) {
      s.mat.uniforms.uColor.value.copy(this.color)
      s.mat.uniforms.uGlow.value.copy(this.glow)
    }
    for (const j of this.joints) {
      if (j.ball) j.ball.material.color.copy(this.jointColor)
    }
    for (const a of this.arrows) a.mat.color.copy(this.color)
  }

  setVisible(v) {
    this.group.visible = !!v
  }

  _rebuildSegment(i) {
    if (i < 0 || i + 1 >= this.points.length) return
    const curve = buildSegmentCurve(this.points, i)
    const len = curve.getLength()
    const tubular = Math.max(14, Math.round(len / 6))
    const geo = new THREE.TubeGeometry(curve, tubular, this.radius, 10, false)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: this._t },
        uColor: { value: this.color.clone() },
        uGlow: { value: this.glow.clone() },
        // 纸面上的"流动光带"要几乎停住：跑动的光是现代大屏语言，作战图上是静止的线
        uSpeed: { value: this.paper ? 0.18 : 0.55 },
        // 条纹条数按段长换算，保证相邻段条纹物理长度一致
        uRepeat: { value: Math.max(2, Math.round(len / STRIPE_LEN)) },
        uOpacity: { value: this.paper ? 0.92 : 1 }
      },
      vertexShader: routeVertexShader,
      fragmentShader: routeFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
    const mesh = new THREE.Mesh(geo, mat)

    // 替换已存在的段，否则新增
    if (this.segments[i]) {
      const old = this.segments[i]
      this.group.remove(old.mesh)
      old.geo.dispose()
      old.mat.dispose()
      this.segments[i] = { curve, mesh, geo, mat, length: len }
    } else {
      this.segments.push({ curve, mesh, geo, mat, length: len })
    }
    this.group.add(mesh)
  }

  _rebuildSpline() {
    if (this.points.length < 2) {
      this.spline = null
      this.totalLength = 0
      return
    }
    const s = new THREE.CatmullRomCurve3(this.points.map(p => p.clone()))
    s.arcLengthDivisions = 800
    this.spline = s
    this.totalLength = s.getLength()
    // 段长合计（与 spline 略有差异，以 spline 为准用于巡航）
    // 路径形状变了，兵锋箭头要跟着重排
    this._buildArrows()
  }

  /** 兵锋箭头：沿路径均匀摆开，箭头所指即进攻方向 */
  _buildArrows() {
    this._clearArrows()
    if (!this.arrowsOn || !this.spline || this.points.length < 2) return
    // 短路径也要至少两个箭头（一个看不出方向），长路径封顶 12 个免得糊成一片
    const n = Math.max(2, Math.min(12, Math.round(this.totalLength / 110)))
    for (let i = 0; i < n; i++) {
      const t = THREE.MathUtils.clamp((i + 0.5) / n, 0.02, 0.98)
      const p = this.spline.getPointAt(t)
      const tan = this.spline.getTangentAt(t)
      const geo = new THREE.PlaneGeometry(54, 27)
      const mat = new THREE.MeshBasicMaterial({
        map: arrowTexture(),
        color: this.color.clone(),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false, // 箭头是符号，浮在管道之上，不能被管道切一半
        side: THREE.DoubleSide
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(p)
      mesh.position.y += 1
      // YXZ 顺序下 y 是最外层的世界轴：先转向切线方向，再绕 X 躺平贴地
      mesh.rotation.order = 'YXZ'
      mesh.rotation.y = Math.atan2(tan.x, tan.z)
      mesh.rotation.x = -Math.PI / 2
      mesh.raycast = () => {}
      mesh.renderOrder = 6
      this.group.add(mesh)
      this.arrows.push({ mesh, geo, mat })
    }
  }

  _clearArrows() {
    for (const a of this.arrows) {
      this.group.remove(a.mesh)
      a.geo.dispose()
      // 箭头贴图是模块级共享的，不能在这里 dispose map
      a.mat.dispose()
    }
    this.arrows = []
  }
}
