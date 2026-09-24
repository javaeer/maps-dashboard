import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createComposer } from '../effects/bloom.js'
import { createExtrudedMap, createTownMap } from './extrude.js'
import { loadGeoJSON, loadTowns, loadCountyGeo, loadTownGeo, loadTownInfo } from './geoLoader.js'
import { createRipple } from '../effects/ripple.js'
import { createFlyLine } from '../effects/flyLine.js'
import { createTownMarker, createTownLabel, geoToWorld } from '../effects/town.js'
import { RoutePath } from '../effects/routePath.js'
import { resolveTheme } from './palette.js'
import { findTownInfo, townToDisplay } from '../utils/townName.js'

const MAP_W = 1024
// 拉伸高度取地图宽度的 ~7%，避免区域变成"通天柱"
const DEPTH = 70
// 乡镇子图层薄浮雕高度（坐在县顶面之上）
const TOWN_DEPTH = 12

export class ThreeMap {
  constructor(container, { onSelect, onBreadcrumb, onSelectTown, onTownEmpty, onTownInfo, onRouteChange } = {}) {
    this.container = container
    this.onSelect = onSelect || (() => {})
    this.onTownInfo = onTownInfo || (() => {})
    this.onRouteChange = onRouteChange || (() => {})
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
    // 路径管道 + 巡航跟拍
    this.route = null          // 在 _init() 之后创建（依赖 scene）
    this.cruising = false
    this.cruiseT = 0
    this.cruiseSpeed = 260     // 世界单位 / 秒
    this.cruiseLook = null
    this.unitsPerKm = null     // 当前县级投影下 1 公里 ≈ 多少世界单位（长度/速度换算用）
    this.clock = new THREE.Clock()
    // 配色主题：支持 URL 参数 ?palette=tech|aurora|sunset 现场切换
    this.theme = resolveTheme()
    // 每帧渲染完成后的回调，供视频录制抓取画面；未设置时不产生任何开销
    this.onFrame = null

    this._init()
    // 路径管道：悬浮在乡镇顶面之上（centerWorld 本身已在顶面，再抬 46）
    this.route = new RoutePath({ scene: this.scene, lift: 46 })
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

    const built = createExtrudedMap(geo, {
      width: MAP_W,
      height: MAP_W,
      depth: DEPTH,
      theme: this.theme
    })
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

    // 展示信息（人口 / 面积 / 下辖村社区 / 联系方式）：与边界并行加载，缺失不影响渲染
    let townInfo = null
    try {
      townInfo = await loadTownInfo(adcode)
    } catch (e) {
      console.warn('[maps-dashboard] 乡镇展示信息加载失败', adcode, e)
    }
    this.townInfo = townInfo
    this.townInfoMap = townInfo && townInfo.towns ? townInfo.towns : []
    if (townInfo) this.onTownInfo(townInfo)

    let townGeo = null
    try {
      townGeo = await loadTownGeo(adcode)
    } catch (e) {
      console.error('[maps-dashboard] 乡镇边界加载失败', adcode, e)
    }
    if (townGeo && townGeo.features && townGeo.features.length && this.projection) {
      // 真实乡镇边界子图层
      try {
        const built = createTownMap(townGeo, this.projection, MAP_W, DEPTH, TOWN_DEPTH, this.theme)
        this.townSideMaterials = built.sideMaterials
        this.townFeatureGroups = built.featureGroups
        if (built.featureGroups.length) g.add(built.group)
        for (const fg of built.featureGroups) {
          const props = fg.userData.feature.properties || {}
          const tname = props.name || props.乡 || props.镇 || props.town || ''
          const town = {
            name: tname,
            level: '乡镇',
            population: null,
            area: null,
            meta: {
              attrs: [
                ['省', props.province],
                ['市', props.city],
                ['县', props.county],
                ['乡镇', tname]
              ].filter((x) => x[1])
            }
          }
          // 合并官方展示信息（边界数据用的是旧名，按核心名匹配）
          const info = findTownInfo(tname, this.townInfoMap)
          if (info) Object.assign(town, townToDisplay(info, tname))
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
          const info = findTownInfo(t.name, this.townInfoMap)
          const marker = createTownMarker(info ? { ...t, ...townToDisplay(info) } : t, this.projection, MAP_W, DEPTH)
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
      // 墨卡托在局部是等角的，用县中心处"1 公里经度差"换算出世界单位/公里
      this.unitsPerKm = this._estimateUnitsPerKm(c)
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
    this.unitsPerKm = null
    // 乡镇视图销毁 → 路径点所属坐标系失效，一并清空（不通知 UI 重建动画）
    if (this.route && this.route.count) {
      this.cruising = false
      this.cruiseT = 0
      this.cruiseLook = null
      this.route.clear()
      this.onRouteChange(this.routeState(), null)
    }
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

    // 闭环第 1 步：把该乡镇追加为路径点（巡航中先停下，交回相机控制权）
    let routeResult = null
    if (this.route) {
      if (this.cruising) this.stopCruise()
      routeResult = this.route.addPoint(world, { name: town.name, adcode: town.info && town.info.adcode })
      if (routeResult.added) {
        // 闭环第 2 步由 RoutePath 完成（分段管道即时生长）
        // 闭环第 3 步：相机平滑飞向新追加的点
        this._focus(
          world.clone().add(new THREE.Vector3(0, 10, 0)),
          world.clone().add(new THREE.Vector3(0, 360, 560))
        )
      }
      this.onRouteChange(this.routeState(), routeResult)
    }

    this._clearEffects()
    this.ripples.push(createRipple(world.clone()))
    this.onSelectTown(town)
  }

  // ---------- 路径管道 / 巡航跟拍 ----------

  /** 用县中心的投影局部尺度估算 1 公里 ≈ 多少世界单位 */
  _estimateUnitsPerKm(center) {
    if (!center || !this.projection) return null
    const lng = center[0]
    const lat = center[1]
    const dLng = 1 / (111.32 * Math.cos((lat * Math.PI) / 180))
    const a = geoToWorld(this.projection, MAP_W, DEPTH, lng, lat)
    const b = geoToWorld(this.projection, MAP_W, DEPTH, lng + dLng, lat)
    if (!a || !b) return null
    const d = a.distanceTo(b)
    return d > 0 ? d : null
  }

  routeState() {
    const r = this.route
    const u = this.unitsPerKm
    const toKm = (v) => (u ? +(v / u).toFixed(1) : null)
    if (!r) return { stops: [], count: 0, length: 0, lengthText: '0 km', cruising: false, speed: 0, speedKmh: null }
    const km = toKm(r.totalLength)
    return {
      stops: r.stops.map((s, i) => ({ index: i + 1, name: s.name, adcode: s.adcode })),
      count: r.count,
      length: km != null ? km : Math.round(r.totalLength),
      // 拿不到投影尺度时退回世界单位，不谎报 km
      lengthText: km != null ? `${km} km` : `${Math.round(r.totalLength)} 单位`,
      cruising: this.cruising,
      speed: this.cruiseSpeed,
      speedKmh: toKm(this.cruiseSpeed * 3.6)
    }
  }

  /** 沿管道全程巡航跟拍；不足 2 个点时无法成线 */
  startCruise() {
    if (!this.route || this.route.count < 2) return false
    this.cruising = true
    if (this.cruiseT >= 1) this.cruiseT = 0
    this.cruiseLook = this.cruiseLook || this.controls.target.clone()
    // 让出相机：清空单击聚焦目标，避免两套插值互相拉扯
    this.focusTarget = null
    this.focusPos = null
    return true
  }

  stopCruise() {
    if (!this.cruising) return false
    this.cruising = false
    // 把巡航末帧的视点交回 OrbitControls，退出后不会突然跳镜头
    if (this.cruiseLook) {
      this.controls.target.copy(this.cruiseLook)
      this.controls.update()
    }
    return true
  }

  toggleCruise() {
    return this.cruising ? (this.stopCruise(), false) : (this.startCruise(), this.cruising)
  }

  setCruiseSpeed(v) {
    this.cruiseSpeed = Math.max(40, Math.min(1200, Number(v) || 260))
    this.onRouteChange(this.routeState(), null)
  }

  clearRoute() {
    if (!this.route) return
    this.stopCruise()
    this.cruiseT = 0
    this.cruiseLook = null
    this.route.clear()
    this.onRouteChange(this.routeState(), null)
  }

  removeLastStop() {
    if (!this.route || !this.route.count) return
    this.stopCruise()
    this.route.removeLast()
    this.cruiseT = 0
    this.onRouteChange(this.routeState(), null)
  }

  /** 点击路径列表某项：相机飞回该路径点 */
  focusRouteStop(i) {
    if (!this.route || !this.route.points[i]) return
    this.stopCruise()
    const p = this.route.points[i]
    this._focus(p.clone(), p.clone().add(new THREE.Vector3(0, 380, 620)))
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
    // 全屏：元素进入/退出全屏时容器尺寸变化，window 的 resize 不保证触发，
    // 用 ResizeObserver 直接盯容器 + fullscreenchange 兜底
    document.addEventListener('fullscreenchange', this._onResize)
    document.addEventListener('webkitfullscreenchange', this._onResize)
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._resize())
      this._ro.observe(this.container)
    }
  }

  /** 供外部（如全屏切换）主动触发一次重排 */
  resize() {
    this._resize()
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
    // 巡航跟拍：接管相机，期间跳过 OrbitControls，避免两套插值互相拉扯
    if (this.cruising && this.route && this.route.count >= 2) {
      const len = Math.max(this.route.totalLength, 1)
      this.cruiseT += (dt * this.cruiseSpeed) / len
      if (this.cruiseT >= 1) this.cruiseT -= 1 // 循环巡航
      const s = this.route.sampleAt(this.cruiseT)
      if (s) {
        // 相机挂在采样点后上方，视线落在前方一段距离处 → 形成"跟拍"视角
        const want = s.position.clone()
          .sub(s.tangent.clone().multiplyScalar(210))
          .add(new THREE.Vector3(0, 135, 0))
        const look = s.position.clone().add(s.tangent.clone().multiplyScalar(160))
        this.camera.position.lerp(want, 0.09)
        if (!this.cruiseLook) this.cruiseLook = look.clone()
        this.cruiseLook.lerp(look, 0.12)
        this.camera.lookAt(this.cruiseLook)
        this.controls.target.copy(this.cruiseLook)
      }
      this.controls.autoRotate = false
    } else {
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
    if (this.route) this.route.update(dt)

    this.composer.render()
    // 录制钩子：composer.render() 之后、本帧结束之前，WebGL 的 drawing buffer 尚未被清，
    // 此时 drawImage 才能取到画面（摄像机 out.clear() 或 buffer 交换后就读不到了）
    if (this.onFrame) this.onFrame()
    requestAnimationFrame(this._tick)
  }

  dispose() {
    window.removeEventListener('resize', this._onResize)
    document.removeEventListener('fullscreenchange', this._onResize)
    document.removeEventListener('webkitfullscreenchange', this._onResize)
    if (this._ro) this._ro.disconnect()
    if (this.route) this.route.dispose()
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
