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
    joint = 0x7dd3fc
  } = {}) {
    this.scene = scene
    this.radius = radius
    this.lift = lift
    this.color = new THREE.Color(color)
    this.glow = new THREE.Color(glow)
    this.jointColor = new THREE.Color(joint)

    this.points = []      // 世界坐标路径点（含抬升）
    this.stops = []       // 每个点的元信息 { name, adcode }
    this.segments = []    // 管段 { curve, mesh, geo, mat, length }
    this.joints = []      // 关节球 + 序号标签
    this.spline = null    // 全局巡航曲线（弧长参数化）
    this.totalLength = 0

    this.group = new THREE.Group()
    this.group.renderOrder = 5
    if (scene) scene.add(this.group)
    this._t = 0
  }

  get count() {
    return this.points.length
  }

  /** 该乡镇是否已在路径中（避免重复点击堆点） */
  has(name) {
    return this.stops.some(s => s.name === name)
  }

  /**
   * 追加一个路径点。
   * @param {THREE.Vector3} center 乡镇中心世界坐标
   * @param {object} meta  { name, adcode }
   * @returns {{added:boolean, index:number, reason?:string}}
   */
  addPoint(center, meta = {}) {
    if (meta.name && this.has(meta.name)) {
      return { added: false, index: this.stops.findIndex(s => s.name === meta.name), reason: '已在路径中' }
    }
    const p = center.clone()
    p.y += this.lift
    this.points.push(p)
    this.stops.push({ name: meta.name || '', adcode: meta.adcode || null })
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
    this.joints.push({
      group: g,
      dispose() {
        geo.dispose()
        mat.dispose()
        label.material.map.dispose()
        label.material.dispose()
      }
    })
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
        uSpeed: { value: 0.55 },
        // 条纹条数按段长换算，保证相邻段条纹物理长度一致
        uRepeat: { value: Math.max(2, Math.round(len / STRIPE_LEN)) },
        uOpacity: { value: 1 }
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
  }
}
