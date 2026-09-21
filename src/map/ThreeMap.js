import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createComposer } from '../effects/bloom.js'
import { createExtrudedMap, createTownMap } from './extrude.js'
import { loadGeoJSON, loadTowns, loadCountyGeo, loadTownGeo } from './geoLoader.js'
import { createRipple } from '../effects/ripple.js'
import { createFlyLine } from '../effects/flyLine.js'
import { createTownMarker, createTownLabel, geoToWorld } from '../effects/town.js'

const MAP_W = 1024
// 拉伸高度取地图宽度的 ~7%，避免区域变成"通天柱"
const DEPTH = 70
// 乡镇子图层薄浮雕高度（坐在县顶面之上）
const TOWN_DEPTH = 12

export class ThreeMap {
  constructor(container, { onSelect, onBreadcrumb, onSelectTown, onTownEmpty } = {}) {
    this.container = container
    this.onSelect = onSelect || (() => {})
    this.onBreadcrumb = onBreadcrumb || (() => {})
    this.onSelectTown = onSelectTown || (() => {})
    this.onTownEmpty = onTownEmpty || (() => {})

    this.adcodeStack = ['100000']
    this.nameMap = { 100000: '中国' }
    this.mapGroup = null
    this.featureGroups = []
    this.sideMaterials = []
    this.projection = null
    this.selected = null
    this.selectedTown = null
    this.hoveredTown = null
    this.townGroup = null
    this.townAdcode = null
    this.townSideMaterials = []
    this.townFeatureGroups = []
    this.mode = 'region' // 'region' | 'town'
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
    // 空闲自动旋转（大屏 turntable 效果），选中/下钻时由动画循环关闭
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.5

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

  // 渲染某个行政区的面地图；geo 为 null 表示加载失败
  async load(adcode) {
    const target = adcode || this.adcodeStack[this.adcodeStack.length - 1]
    if (target === '100000') this.nameMap = { 100000: '中国' }

    this._clearMap()
    this._clearTowns()
    this.mode = 'region'
    this.onSelect(null)

    const geo = await loadGeoJSON(target)
    if (!geo) {
      this.onTownEmpty('该层级')
      return
    }
    this._renderRegion(geo, target)
    this._resetCamera()
    this.onBreadcrumb(this.adcodeStack.map((a) => this.nameMap[a] || a))
  }

  _renderRegion(geo, adcode) {
    geo.features.forEach((f) => {
      const p = f.properties || {}
      if (p.adcode != null) this.nameMap[p.adcode] = p.name || p.adcode
    })

    const built = createExtrudedMap(geo, { width: MAP_W, height: MAP_W, depth: DEPTH })
    this.mapGroup = built.group
    this.featureGroups = built.featureGroups
    this.sideMaterials = built.sideMaterials
    this.projection = built.projection
    this.scene.add(this.mapGroup)
  }

  // 下钻：先探测是否有下级面；有则渲染面，无（叶子区县）则进入镇点位视图
  async drill(feature) {
    const p = feature.properties || {}
    if (p.adcode == null) return
    const adcode = String(p.adcode)
    this.onSelect(null)

    const geo = await loadGeoJSON(adcode)
    if (geo) {
      this.adcodeStack.push(adcode)
      // 先清掉上一级地图与镇点位，避免下钻层级在场景里不断叠加
      this._clearMap()
      this._clearTowns()
      this._renderRegion(geo, adcode)
      this._resetCamera()
      this.onBreadcrumb(this.adcodeStack.map((a) => this.nameMap[a] || a))
    } else {
      // 叶子区县：DataV 无县级 _full.json，回退加载县自身边界渲染为底图，再叠乡镇点位
      const self = await loadCountyGeo(adcode)
      if (self) {
        this.adcodeStack.push(adcode)
        this._clearMap()
        this._clearTowns()
        this._renderRegion(self, adcode)
        this.onBreadcrumb(this.adcodeStack.map((a) => this.nameMap[a] || a))
      }
      this._enterTownView(feature, adcode)
    }
  }

  // 进入乡镇视图：优先渲染「真实乡镇边界」子图层（贴在县顶面），
  // 无边界数据时回退到合成点位标记
  async _enterTownView(feature, adcode) {
    const name = (feature.properties && feature.properties.name) || adcode
    this._clearTowns()
    this.mode = 'town'
    this.selected = null
    this._clearHighlight()

    const g = new THREE.Group()
    let any = false

    let townGeo = null
    try {
      townGeo = await loadTownGeo(adcode)
    } catch (e) {
      console.error('[maps-dashboard] 乡镇边界加载失败', adcode, e)
    }
    if (townGeo && townGeo.features && townGeo.features.length && this.projection) {
      // 真实乡镇边界子图层
      try {
        const built = createTownMap(townGeo, this.projection, MAP_W, DEPTH, TOWN_DEPTH)
        this.townSideMaterials = built.sideMaterials
        this.townFeatureGroups = built.featureGroups
        if (built.featureGroups.length) g.add(built.group)
        for (const fg of built.featureGroups) {
          const props = fg.userData.feature.properties || {}
          const tname = props.name || props.乡 || props.镇 || props.town || ''
          const town = {
            name: tname,
            level: '乡镇',
            meta: {
              attrs: [
                ['省', props.province],
                ['市', props.city],
                ['县', props.county],
                ['乡镇', tname]
              ].filter((x) => x[1])
            }
          }
          fg.userData.town = town
          const label = createTownLabel(tname, fg.userData.centerWorld)
          label.visible = false
          fg.userData.label = label
          if (fg.userData.centerWorld) g.add(label)
          any = true
        }
      } catch (e) {
        // 乡镇图层构建异常时必须报错，不能静默变成"什么都没渲染"
        console.error('[maps-dashboard] 乡镇图层构建失败', adcode, e)
        this.onTownEmpty(`${name} 乡镇图层构建失败：${e && e.message}`)
      }
    }
    if (!any) {
      // 回退：合成点位标记
      const towns = await loadTowns(adcode)
      if (towns && towns.length) {
        for (const t of towns) {
          const marker = createTownMarker(t, this.projection, MAP_W, DEPTH)
          if (marker) {
            g.add(marker)
            any = true
          }
        }
      }
    }

    if (!any) {
      this.onTownEmpty(name)
      return
    }
    this.townGroup = g
    this.townAdcode = adcode
    this.scene.add(g)

    // 聚焦到该区县中心
    const c = feature.properties && (feature.properties.center || feature.properties.centroid)
    if (c && this.projection) {
      const cw = geoToWorld(this.projection, MAP_W, DEPTH, c[0], c[1])
      if (cw) this._focus(cw.clone(), cw.clone().add(new THREE.Vector3(0, 520, 760)))
    }
    // 县 adcode 已入栈时（由 drill 渲染县级底图）不再追加名称，避免面包屑重复
    const names = this.adcodeStack.map((a) => this.nameMap[a] || a)
    if (this.adcodeStack[this.adcodeStack.length - 1] !== String(adcode)) names.push(name)
    this.onBreadcrumb(names)
  }

  _exitTownView() {
    this._clearTowns()
    this.mode = 'region'
    this.selectedTown = null
    this.onSelectTown(null)
    this.onBreadcrumb(this.adcodeStack.map((a) => this.nameMap[a] || a))
  }

  _clearTowns() {
    this.hoveredTown = null
    if (this.townGroup) {
      this.townGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          mats.forEach((m) => {
            if (m.map && m.map.dispose) m.map.dispose()
            if (m.dispose) m.dispose()
          })
        }
      })
      this.scene.remove(this.townGroup)
    }
    this.townGroup = null
    this.townAdcode = null
    this.townSideMaterials = []
    this.townFeatureGroups = []
  }

  back() {
    if (this.mode === 'town') {
      this._exitTownView()
      return
    }
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
    if (!this.mapGroup && !this.townGroup) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)

    // 镇模式：只拾取乡镇要素（真实边界多边形或回退点位）
    if (this.townGroup) {
      const hits = this.raycaster.intersectObjects(this.townGroup.children, true)
      for (const h of hits) {
        // 必须上溯到「要素组 / 标记组」（带 userData.town）为止：
        // 射线命中的是 mesh，而 mesh 只有 userData.feature，label / capMat /
        // town 都挂在父级要素组上，对 mesh 取这些字段会抛异常导致点击无响应
        let o = h.object
        while (o && !o.userData.town) o = o.parent
        if (o && o.userData.town) {
          this._selectTown(o)
          return
        }
      }
      return
    }

    // 区域模式
    const hits = this.raycaster.intersectObjects(this.mapGroup.children, true)
    for (const h of hits) {
      if (h.object.userData && h.object.userData.feature) {
        this._select(h.object.parent, h.object.userData.feature)
        break
      }
    }
  }

  _selectTown(fg) {
    if (!fg || !fg.userData || !fg.userData.town) return
    // 换选时：隐藏上一个选中乡镇的标签、并恢复其顶面亮度
    const prev = this.selectedTown
    if (prev && prev !== fg) {
      if (prev.userData.label) prev.userData.label.visible = false
      // 回退点位标记没有顶面材质，仅在真实边界要素上恢复
      if (prev.userData.capMat && prev.userData.baseColor) {
        prev.userData.capMat.emissive.copy(prev.userData.baseColor).multiplyScalar(0.16)
      }
    }
    this.selectedTown = fg
    if (fg.userData.label) fg.userData.label.visible = true
    // 选中乡镇：顶面提亮自发光（同样仅真实边界要素具备）
    if (fg.userData.capMat && fg.userData.baseColor) {
      fg.userData.capMat.emissive.copy(fg.userData.baseColor).multiplyScalar(0.6)
    }
    const town = fg.userData.town
    const world = (fg.userData.centerWorld || new THREE.Vector3()).clone()
    this._focus(
      world.clone().add(new THREE.Vector3(0, 10, 0)),
      world.clone().add(new THREE.Vector3(0, 360, 560))
    )
    this._clearEffects()
    this.ripples.push(createRipple(world.clone()))
    this.onSelectTown(town)
  }

  // 乡镇悬停：显示名称标签 + 手型指针（标签默认隐藏，避免几十个标签叠成白色光斑）
  _hover(e) {
    if (!this.townGroup) {
      if (this.hoveredTown) this._setHovered(null)
      return
    }
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.townGroup.children, true)
    let marker = null
    for (const h of hits) {
      // 同样必须上溯到要素组（带 userData.town）
      let o = h.object
      while (o && !o.userData.town) o = o.parent
      if (o && o.userData.town) {
        marker = o
        break
      }
    }
    this._setHovered(marker)
  }

  _setHovered(marker) {
    if (this.hoveredTown === marker) return
    if (this.hoveredTown && this.hoveredTown !== this.selectedTown) {
      if (this.hoveredTown.userData.label) this.hoveredTown.userData.label.visible = false
    }
    this.hoveredTown = marker
    if (marker) {
      if (marker.userData.label) marker.userData.label.visible = true
      this.renderer.domElement.style.cursor = 'pointer'
    } else {
      this.renderer.domElement.style.cursor = ''
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
    // 不透明顶盖：未选中 = 调暗颜色（而非半透明），选中 = 提亮自发光 + 描边加亮
    this.featureGroups.forEach((fg) => {
      const cap = fg.userData.capMat
      const base = fg.userData.baseColor
      const border = fg.userData.borderMat
      if (fg === sel) {
        cap.color.copy(base)
        cap.emissive.copy(base).multiplyScalar(0.55)
        border.opacity = 1.0
      } else {
        cap.color.copy(base).multiplyScalar(0.35)
        cap.emissive.copy(base).multiplyScalar(0.03)
        border.opacity = 0.45
      }
    })
  }

  _clearHighlight() {
    this.featureGroups.forEach((fg) => {
      const cap = fg.userData.capMat
      cap.color.copy(fg.userData.baseColor)
      cap.emissive.copy(fg.userData.baseColor).multiplyScalar(0.18)
      fg.userData.borderMat.opacity = 0.9
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
    this._onMove = (e) => this._hover(e)
    this._onDblClick = (e) => {
      if (this.mode !== 'region') return
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
    el.addEventListener('pointermove', this._onMove)
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
    this.projection = null
    this._clearEffects()
    this.selected = null
  }

  _animate() {
    const dt = this.clock.getDelta()
    const el = this.clock.elapsedTime
    this.sideMaterials.forEach((m) => {
      m.uniforms.uTime.value = el
    })
    this.townSideMaterials.forEach((m) => {
      m.uniforms.uTime.value = el
    })
    this.controls.update()
    // 选中或镜头聚焦动画期间暂停自动旋转
    this.controls.autoRotate = !this.selected && !this.selectedTown && !this.focusTarget

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
    el.removeEventListener('pointermove', this._onMove)
    el.removeEventListener('dblclick', this._onDblClick)
    el.removeEventListener('contextmenu', this._onContext)
    this._clearTowns()
    this._clearMap()
    this.controls.dispose()
    this.renderer.dispose()
    if (el.parentNode) el.parentNode.removeChild(el)
  }
}
