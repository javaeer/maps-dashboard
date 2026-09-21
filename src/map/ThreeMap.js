import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createComposer } from '../effects/bloom.js'
import { createExtrudedMap } from './extrude.js'
import { loadGeoJSON } from './geoLoader.js'
import { createRipple } from '../effects/ripple.js'
import { createFlyLine } from '../effects/flyLine.js'

const MAP_W = 1024
// 拉伸高度取地图宽度的 ~7%，避免区域变成"通天柱"
const DEPTH = 70

export class ThreeMap {
  constructor(container, { onSelect, onBreadcrumb } = {}) {
    this.container = container
    this.onSelect = onSelect || (() => {})
    this.onBreadcrumb = onBreadcrumb || (() => {})

    this.adcodeStack = ['100000']
    this.nameMap = { 100000: '中国' }
    this.mapGroup = null
    this.featureGroups = []
    this.sideMaterials = []
    this.selected = null
    this.ripples = []
    this.flyLines = []
    this.focusTarget = null
    this.focusPos = null
    this.clock = new THREE.Clock()

    this._init()
    this._bindEvents()
    this._tick = () => this._animate()
    requestAnimationFrame(this._tick)
  }

  _init() {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x05080f, 0.00009)

    this.camera = new THREE.PerspectiveCamera(45, w / h, 1, 30000)
    this.camera.position.set(0, 1050, 1400)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.container.appendChild(this.renderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 200
    this.controls.maxDistance = 5000
    this.controls.maxPolarAngle = Math.PI * 0.49

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65))
    const dir = new THREE.DirectionalLight(0x9fd8ff, 1.1)
    dir.position.set(400, 900, 600)
    this.scene.add(dir)
    const point = new THREE.PointLight(0x38bdf8, 0.9, 6000)
    point.position.set(0, 800, 0)
    this.scene.add(point)

    const grid = new THREE.GridHelper(5000, 50, 0x1b3a5b, 0x0e2138)
    grid.position.y = -12
    this.scene.add(grid)

    const { composer } = createComposer(this.renderer, this.scene, this.camera, w, h)
    this.composer = composer

    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
  }

  async load(adcode) {
    const target = adcode || this.adcodeStack[this.adcodeStack.length - 1]
    // 重置到顶层时清空名称缓存
    if (target === '100000') this.nameMap = { 100000: '中国' }

    this._clearMap()
    this.onSelect(null) // 切换层级时关闭信息面板

    const geo = await loadGeoJSON(target)
    this.geo = geo
    geo.features.forEach((f) => {
      const p = f.properties || {}
      if (p.adcode != null) this.nameMap[p.adcode] = p.name || p.adcode
    })

    const built = createExtrudedMap(geo, { width: MAP_W, height: MAP_W, depth: DEPTH })
    this.mapGroup = built.group
    this.featureGroups = built.featureGroups
    this.sideMaterials = built.sideMaterials
    this.scene.add(this.mapGroup)

    this._resetCamera()
    this.onBreadcrumb(this.adcodeStack.map((a) => this.nameMap[a] || a))
  }

  drill(feature) {
    const p = feature.properties || {}
    if (p.childrenNum > 0 && p.adcode != null) {
      this.adcodeStack.push(String(p.adcode))
      this.load()
    }
  }

  back() {
    if (this.adcodeStack.length > 1) {
      this.adcodeStack.pop()
      this.load()
    }
  }

  goToLevel(index) {
    if (index >= 0 && index < this.adcodeStack.length - 1) {
      this.adcodeStack = this.adcodeStack.slice(0, index + 1)
      this.load()
    }
  }

  _resetCamera() {
    this._focus(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1050, 1400))
  }

  _focus(target, pos) {
    this.focusTarget = target.clone()
    this.focusPos = pos.clone()
  }

  _pick(e) {
    if (!this.mapGroup) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.mapGroup.children, true)
    for (const h of hits) {
      if (h.object.userData && h.object.userData.feature) {
        this._select(h.object.parent, h.object.userData.feature)
        break
      }
    }
  }

  _select(featureGroup, feature) {
    this._clearHighlight()
    this._highlight(featureGroup)
    this.selected = featureGroup

    const cw = featureGroup.userData.centerWorld
    if (cw) {
      this._focus(cw.clone(), cw.clone().add(new THREE.Vector3(0, 620, 880)))
      this._clearEffects()
      this.ripples.push(createRipple(cw.clone()))
      this.flyLines.push(createFlyLine(cw.clone(), new THREE.Vector3(0, DEPTH * 0.6, 0)))
    }
    this.onSelect(feature)
  }

  _highlight(sel) {
    // 不透明顶盖：未选中 = 调暗颜色（而非半透明），选中 = 提亮自发光
    this.featureGroups.forEach((fg) => {
      const cap = fg.userData.capMat
      const base = fg.userData.baseColor
      if (fg === sel) {
        cap.color.copy(base)
        cap.emissive.copy(base).multiplyScalar(0.55)
      } else {
        cap.color.copy(base).multiplyScalar(0.35)
        cap.emissive.copy(base).multiplyScalar(0.03)
      }
    })
  }

  _clearHighlight() {
    this.featureGroups.forEach((fg) => {
      const cap = fg.userData.capMat
      cap.color.copy(fg.userData.baseColor)
      cap.emissive.copy(fg.userData.baseColor).multiplyScalar(0.18)
    })
    this.selected = null
  }

  _clearEffects() {
    this.ripples.forEach((r) => {
      this.scene.remove(r.mesh)
      r.dispose()
    })
    this.flyLines.forEach((f) => {
      this.scene.remove(f.mesh)
      f.dispose()
    })
    this.ripples = []
    this.flyLines = []
  }

  _bindEvents() {
    const el = this.renderer.domElement
    this._onClick = (e) => this._pick(e)
    this._onDblClick = (e) => {
      this._pick(e)
      if (this.selected && this.selected.userData.feature) {
        this.drill(this.selected.userData.feature)
      }
    }
    this._onContext = (e) => {
      e.preventDefault()
      this.back()
    }
    this._onResize = () => this._resize()
    el.addEventListener('click', this._onClick)
    el.addEventListener('dblclick', this._onDblClick)
    el.addEventListener('contextmenu', this._onContext)
    window.addEventListener('resize', this._onResize)
  }

  _resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
  }

  _clearMap() {
    if (this.mapGroup) {
      this.mapGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          mats.forEach((m) => m.dispose && m.dispose())
        }
      })
      this.scene.remove(this.mapGroup)
      this.mapGroup = null
    }
    this.featureGroups = []
    this.sideMaterials = []
    this._clearEffects()
    this.selected = null
  }

  _animate() {
    const dt = this.clock.getDelta()
    const el = this.clock.elapsedTime
    this.sideMaterials.forEach((m) => {
      m.uniforms.uTime.value = el
    })
    this.controls.update()

    if (this.focusTarget) {
      this.controls.target.lerp(this.focusTarget, 0.08)
      this.camera.position.lerp(this.focusPos, 0.08)
      if (this.camera.position.distanceTo(this.focusPos) < 6) {
        this.focusTarget = null
        this.focusPos = null
      }
    }

    this.ripples = this.ripples.filter((r) => {
      const alive = r.update(dt)
      if (!alive) {
        this.scene.remove(r.mesh)
        r.dispose()
      }
      return alive
    })
    this.flyLines.forEach((f) => f.update(dt))

    this.composer.render()
    requestAnimationFrame(this._tick)
  }

  dispose() {
    window.removeEventListener('resize', this._onResize)
    const el = this.renderer.domElement
    el.removeEventListener('click', this._onClick)
    el.removeEventListener('dblclick', this._onDblClick)
    el.removeEventListener('contextmenu', this._onContext)
    this._clearMap()
    this.controls.dispose()
    this.renderer.dispose()
    if (el.parentNode) el.parentNode.removeChild(el)
  }
}
