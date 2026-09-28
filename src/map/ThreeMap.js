import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createComposer } from '../effects/bloom.js'
import { createExtrudedMap, createTownMap } from './extrude.js'
import { loadGeoJSON, loadTowns, loadCountyGeo, loadTownGeo, loadTownInfo } from './geoLoader.js'
import { createRipple } from '../effects/ripple.js'
import { createFlyLine } from '../effects/flyLine.js'
import { createTownMarker, createTownLabel, geoToWorld } from '../effects/town.js'
import { RoutePath, routeColorAt } from '../effects/routePath.js'
import { NameLayer } from './nameLayer.js'
import { createVillageRing } from './villageRing.js'
import { resolveTheme, themePaper } from './palette.js'
import { findTownInfo, townToDisplay } from '../utils/townName.js'
import { loadHydro, hydroUrls, createHydroLayer } from './hydroLayer.js'
import { loadTerrain, createTerrainMesh, createPeakMarks } from './terrainLayer.js'
import { createMilitaryLayer } from './militaryLayer.js'

const MAP_W = 1024
// 拉伸高度取地图宽度的 ~7%，避免区域变成"通天柱"
const DEPTH = 70
// 乡镇子图层薄浮雕高度（坐在县顶面之上）
const TOWN_DEPTH = 12

export class ThreeMap {
  constructor(container, { onSelect, onBreadcrumb, onSelectTown, onTownEmpty, onTownInfo, onRouteChange, onLevelHint, onGeoChange, onMilitarySelect } = {}) {
    this.container = container
    this.onSelect = onSelect || (() => {})
    this.onTownInfo = onTownInfo || (() => {})
    // 山系 / 水系加载完成后回传来源与要素数，供图注标注（事实必须可溯源）
    this.onGeoChange = onGeoChange || (() => {})
    // 点击地图上的军事要素（驻军 / 布防 / 行军路线）回传该要素，供详情区展示
    this.onMilitarySelect = onMilitarySelect || (() => {})
    this.onRouteChange = onRouteChange || (() => {})
    this.onBreadcrumb = onBreadcrumb || (() => {})
    this.onSelectTown = onSelectTown || (() => {})
    this.onTownEmpty = onTownEmpty || (() => {})
    // 进入更深层级时的口径提示（如村级数据的坐标情况），由 UI 弹 toast
    this.onLevelHint = onLevelHint || (() => {})

    this.adcodeStack = ['100000']
    this.nameMap = { 100000: '中国' }
    // 当前视图的地理中心 [lng, lat]：图廓比例尺要用它换算「1 公里 ≈ 多少世界单位」，
    // 纬度不同尺度差别很大，不能写死。下钻时随渲染要素更新。
    this.viewCenter = [104.0, 35.0]
    // 地形晕渲 / 水系图层（真实地理要素，不是装饰）
    this.terrain = null       // { mesh, peaks } 由 createTerrainMesh / createPeakMarks 产出
    this.hydroLayer = null    // { group, count, dispose }
    this.geoSource = null     // 数据来源说明，交给 UI 做图注
    // 山系 / 水系的用户开关（两者可分别关掉，关掉的图层不参与图注统计）
    this.geoWant = { terrain: true, hydro: true }
    // 单镇（村级）视图会临时收起地理图层与军事要素，退出时按用户开关恢复
    this._geoHiddenByView = false
    // 军事要素图层：由用户导入（驻军 / 布防 / 行军路线…），本仓库不内置任何史实条目
    this.militaryFeatures = []
    this.militaryLayer = null
    this.militaryLabels = true
    // 连续下钻时异步加载会互相踩，用令牌保证只落地最后一次
    this._geoToken = 0
    this.mapGroup = null
    this.featureGroups = []
    this.sideMaterials = []
    this.projection = null
    this.selected = null
    this.selectedTown = null
    this.hoveredTown = null
    this.townGroup = null
    this.townAdcode = null
    this.townName = ''
    this.townSideMaterials = []
    this.townFeatureGroups = []
    // 单镇视图（下钻到乡镇内部看下辖村/社区）：把该镇边界单独渲染成一块放大板块
    this.villageGroup = null
    this.villageSideMaterials = []
    this.villageFeatureGroups = []
    this.villageRing = null
    this.villageAdcode = null
    this.villageName = ''
    this.mode = 'region' // 'region' | 'town' | 'village'
    this.ripples = []
    this.flyLines = []
    this.focusTarget = null
    this.focusPos = null
    // 路径管道 + 巡航跟拍（支持多条路径：routes 为数组，routeIndex 指向当前编辑的那条）
    this.routes = []
    this.routeIndex = -1       // -1 = 尚无路径
    this.cruising = false
    this.cruiseAll = false     // true = 依次巡航所有路径，而非只循环当前一条
    this.cruiseT = 0
    this.cruiseSpeed = 260     // 世界单位 / 秒
    this.cruiseLook = null
    this.unitsPerKm = null     // 当前县级投影下 1 公里 ≈ 多少世界单位（长度/速度换算用）
    this.clock = new THREE.Clock()
    // 全部巡航会临时占用 routeIndex，记下「原本未选中」以便停下时还原
    this._restoreNoSelection = false
    // 拖拽判定：按下坐标，用于把「拖视角松手」和真正的单击区分开
    this._downX = null
    this._downY = null
    // 配色主题：支持 URL 参数 ?palette=tech|aurora|sunset 现场切换
    this.theme = resolveTheme()
    // 每帧渲染完成后的回调，供视频录制抓取画面；未设置时不产生任何开销
    this.onFrame = null

    this._init()
    // 名称立体标签层：开关打开后在当前层级的板块上显示名称（全国显示省名、省内显示市名…）
    this.nameLayer = new NameLayer({ scene: this.scene, paper: themePaper(this.theme) })
    this._bindEvents()
    this._tick = () => this._animate()
    requestAnimationFrame(this._tick)
  }

  _init() {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    // 纸质主题：整块画布换成宣纸底，雾也用纸色，远处才不会发灰发蓝
    const paper = themePaper(this.theme)

    this.scene = new THREE.Scene()
    if (paper) this.scene.background = new THREE.Color(paper.bg)
    this.scene.fog = new THREE.FogExp2(paper ? paper.bg : 0x05080f, 0.00009)

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

    // 纸面靠漫反射出层次：环境光要给足，主光改成暖白（冷蓝打在纸上会发脏）
    this.scene.add(new THREE.AmbientLight(paper ? 0xfff6e2 : 0xffffff, paper ? 1.05 : 0.65))
    const dir = new THREE.DirectionalLight(paper ? 0xfff2d8 : 0x9fd8ff, paper ? 0.85 : 1.1)
    dir.position.set(400, 900, 600)
    this.scene.add(dir)
    const point = new THREE.PointLight(paper ? 0xffd9a0 : 0x38bdf8, paper ? 0.35 : 0.9, 6000)
    point.position.set(0, 800, 0)
    this.scene.add(point)

    // 网格：纸质主题下是「计里画方」的方格网，颜色换成淡墨赭，不能是荧光蓝
    const grid = new THREE.GridHelper(5000, 50, paper ? paper.grid : 0x1b3a5b, paper ? paper.grid : 0x0e2138)
    grid.position.y = -12
    if (paper) grid.material.opacity = 0.35
    if (paper) grid.material.transparent = true
    this.scene.add(grid)

    const { composer } = createComposer(this.renderer, this.scene, this.camera, w, h, paper)
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
      this.onLevelHint('该层级暂无内置地图数据（public/geo 下缺对应 JSON）')
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
    // 取本层所有要素中心的中位数作为视图中心，供比例尺换算使用
    const cs = geo.features
      .map((f) => (f.properties || {}).center)
      .filter((c) => Array.isArray(c) && c.length >= 2)
    if (cs.length) {
      const lng = cs.reduce((s, c) => s + c[0], 0) / cs.length
      const lat = cs.reduce((s, c) => s + c[1], 0) / cs.length
      this.viewCenter = [lng, lat]
    }
    this.scene.add(this.mapGroup)
    // 本层渲染的就是「下一级行政区」（全国→省、省→市、市→区县），
    // 名称层直接取这批要素的 name，天然符合"进到哪一级就显示哪一级名称"
    this._rebuildNameLayer(built.featureGroups)
    // 投影换了：已有路径按经纬度重新落位，跨层级继续保留
    this._reprojectRoutes()
    // 军事要素同样按经纬度重投影，换层级后继续留在正确的地理位置上
    this._rebuildMilitary()
    // 山系与水系依赖新投影，异步重建（不阻塞出图）
    this._reloadGeoLayers()
  }

  // ---------- 山系（晕渲 / 山头）与水系 ----------

  /** 当前层级该用哪份地形：优先精确匹配 adcode（县级用县、省级用省），没有就回退全国 */
  _terrainKey() {
    const ad = String(this.adcodeStack[this.adcodeStack.length - 1] || '100000')
    if ((this.mode === 'town' || this.mode === 'village') && this.townAdcode) {
      return String(this.townAdcode)
    }
    return ad === '100000' ? 'china' : ad
  }

  _clearTerrain() {
    if (!this.terrain) return
    if (this.terrain.mesh) {
      this.scene.remove(this.terrain.mesh.mesh)
      this.terrain.mesh.dispose()
    }
    if (this.terrain.peaks) {
      this.scene.remove(this.terrain.peaks.group)
      this.terrain.peaks.dispose()
    }
    this.terrain = null
  }

  _clearHydro() {
    if (!this.hydroLayer) return
    this.scene.remove(this.hydroLayer.group)
    this.hydroLayer.dispose()
    this.hydroLayer = null
  }

  /**
   * 按「用户开关 ∩ 当前视图是否允许」重算山系 / 水系 / 军事要素的可见性。
   * 分开两个维度是必要的：用户关掉山系后，进单镇视图再退回，不能把山系又打开。
   */
  _applyGeoVisibility() {
    const byView = !this._geoHiddenByView
    const tv = this.geoWant.terrain && byView
    const hv = this.geoWant.hydro && byView
    if (this.terrain) {
      if (this.terrain.mesh) this.terrain.mesh.mesh.visible = tv
      // 山头符号属于山系，跟着山系一起显隐
      if (this.terrain.peaks) this.terrain.peaks.group.visible = tv
    }
    if (this.hydroLayer) this.hydroLayer.group.visible = hv
    // 军事要素在单镇视图下会错位（该视图用的是镇自身重新拟合的投影），一并收起
    if (this.militaryLayer) this.militaryLayer.group.visible = byView
  }

  /**
   * 山系 / 水系的全局显示开关。
   * @param {'terrain'|'hydro'} kind
   * @param {boolean} v
   * @returns {boolean} 实际生效的状态
   */
  setGeoVisible(kind, v) {
    if (kind !== 'terrain' && kind !== 'hydro') return false
    this.geoWant[kind] = !!v
    this._applyGeoVisibility()
    // 图注要跟着开关走：关掉的图层不该出现在来源说明里。
    // 必须换一个新对象再回传——UI 侧拿到的是响应式引用，原地改属性不会触发重算
    if (this.geoSource) {
      this.geoSource = {
        ...this.geoSource,
        terrainOn: this.geoWant.terrain,
        hydroOn: this.geoWant.hydro
      }
      this.onGeoChange(this.geoSource)
    }
    return this.geoWant[kind]
  }

  /** 单镇视图只留一块板块和名录环，地理图层与军事要素一并收起（退出时按用户开关恢复） */
  _setGeoLayersVisible(v) {
    this._geoHiddenByView = !v
    this._applyGeoVisibility()
  }

  /**
   * 重建山系 + 水系。
   * 两者都由真实公开数据生成，缺数据（比如某县没有水系文件）就安静地不画，
   * 绝不用合成线条糊弄——宁可少画，不画假的。
   */
  async _reloadGeoLayers(forceAdcode) {
    const token = ++this._geoToken
    const paper = themePaper(this.theme)
    const key = forceAdcode ? String(forceAdcode) : this._terrainKey()
    // 顶面之上一点点：晕渲是"地表"，要压在行政区划浮雕之上
    const top = this.mode === 'town' || this.mode === 'village' ? DEPTH + TOWN_DEPTH + 1.6 : DEPTH + 1.6

    // --- 山系 ---
    let t = await loadTerrain(`geo/terrain/${key}`)
    let terrainKey = key
    if (!t) {
      t = await loadTerrain('geo/terrain/china')
      terrainKey = 'china'
    }
    if (token !== this._geoToken || !this.projection) return
    this._clearTerrain()
    const pieces = {}
    if (t) {
      const mesh = createTerrainMesh({
        meta: t.meta,
        tex: t.tex,
        projection: this.projection,
        W: MAP_W,
        y: top,
        // 纸质主题用赭石画山（墨分五色里的"赭"），电子主题压成冷灰蓝
        color: paper ? 0x6b5a3c : 0x1d4a6b,
        opacity: paper ? 0.92 : 0.5
      })
      this.scene.add(mesh.mesh)
      pieces.mesh = mesh
      // 山头符号：高程是实测值。县级（会宁这类黄土丘陵）取最显著的几个，
      // 免得梁峁点糊成一片——少画可以，不画高度不存在的山。
      const peaks = createPeakMarks({
        peaks: t.meta.peaks || [],
        projection: this.projection,
        W: MAP_W,
        y: top + 6,
        size: MAP_W * 0.045,
        limit: this.mode === 'region' ? 0 : 6
      })
      this.scene.add(peaks.group)
      pieces.peaks = peaks
      this.terrain = pieces
    }

    // --- 水系 ---
    const adcode = forceAdcode || String(this.adcodeStack[this.adcodeStack.length - 1] || '100000')
    const urls = hydroUrls(this.mode, adcode)
    const cols = []
    const sources = []
    for (const u of urls) {
      const d = await loadHydro(u)
      if (!d) continue
      cols.push(d)
      const s = d.meta && d.meta.source
      if (s && !sources.includes(s)) sources.push(s)
    }
    if (token !== this._geoToken || !this.projection) return
    this._clearHydro()
    if (cols.length) {
      this.hydroLayer = createHydroLayer({
        collections: cols,
        projection: this.projection,
        W: MAP_W,
        y: top + 0.6,
        // 靛青画水、墨线勾岸：旧舆图的水系就是这个配色
        water: paper ? 0x2f4858 : 0x38bdf8,
        ink: paper ? 0x2b2b28 : 0x9ffcff,
        scale: this.mode === 'region' ? 1 : 0.7
      })
      this.scene.add(this.hydroLayer.group)
    }

    // 图层刚建好，立刻按用户开关决定可见性（否则关掉山系后下钻会自己亮出来）
    this._applyGeoVisibility()
    this.geoSource = {
      hydro: sources.length ? sources : null,
      terrain: t ? t.meta.source : null,
      terrainLabel: t ? t.meta.label : null,
      peaks: this.terrain && this.terrain.peaks ? this.terrain.peaks.count : 0,
      rivers: this.hydroLayer ? this.hydroLayer.count.rivers : 0,
      lakes: this.hydroLayer ? this.hydroLayer.count.lakes : 0,
      terrainOn: this.geoWant.terrain,
      hydroOn: this.geoWant.hydro
    }
    if (this.onGeoChange) this.onGeoChange(this.geoSource)
  }

  /** 重建名称标签；开关状态跨层级保持（全国看完省名，下钻后接着看市名） */
  _rebuildNameLayer(featureGroups) {
    if (!this.nameLayer) return 0
    const wasOn = this.nameLayer.visible
    const n = this.nameLayer.build(featureGroups || [])
    if (wasOn) this.nameLayer.setVisible(true)
    return n
  }

  /** 名称显示开关：返回实际生效的可见状态（没有可显示的标签时打开也不会亮） */
  setNamesVisible(v) {
    if (!this.nameLayer) return false
    return this.nameLayer.setVisible(v)
  }

  get namesVisible() {
    return !!(this.nameLayer && this.nameLayer.visible)
  }

  /** 当前层级名称标签的数量，供 UI 提示「本层共 N 个名称」 */
  get nameCount() {
    return this.nameLayer ? this.nameLayer.count : 0
  }

  // ---------- 军事要素（导入） ----------
  //
  // 要素全部来自用户导入：本仓库不内置任何驻军 / 布防 / 行军路线条目——
  // 军事态势随时代变化，没有"一份永远正确的底图"，画什么必须由数据说话。

  /**
   * 设置要显示的军事要素（已由 store 完成时期 / 类型过滤）。
   * @param {Object[]} list
   */
  setMilitaryFeatures(list) {
    this.militaryFeatures = Array.isArray(list) ? list : []
    return this._rebuildMilitary()
  }

  /** 按当前投影重建军事要素图层（下钻换投影后必须重画，否则会错位） */
  _rebuildMilitary() {
    this._clearMilitary()
    if (!this.projection || !this.militaryFeatures.length) return 0
    const top = this.mode === 'town' || this.mode === 'village' ? DEPTH + TOWN_DEPTH + 1.6 : DEPTH + 1.6
    this.militaryLayer = createMilitaryLayer({
      features: this.militaryFeatures,
      projection: this.projection,
      W: MAP_W,
      y: top + 4,
      paper: themePaper(this.theme),
      labels: this.militaryLabels,
      // 军标是图面符号：按屏幕像素标定尺寸，符号 / 标牌在各级视图下观感一致
      unitPerPx: this.unitPerPixel() || 1.75
    })
    this.scene.add(this.militaryLayer.group)
    this._applyGeoVisibility()
    return this.militaryLayer.count
  }

  _clearMilitary() {
    if (!this.militaryLayer) return
    this.scene.remove(this.militaryLayer.group)
    this.militaryLayer.dispose()
    this.militaryLayer = null
  }

  /** 军事要素的名称标注开关（符号与路线始终显示） */
  setMilitaryLabels(v) {
    this.militaryLabels = !!v
    if (this.militaryLayer) this.militaryLayer.setLabels(this.militaryLabels)
    return this.militaryLabels
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
    // 进入县级默认不选中任何路径：上层连好的路线保留（跨层级继续用），
    // 但不再自动吃路径点；用户要继续连线必须在路径面板显式点选某条路径或新建。
    if (this.clearRouteSelection()) {
      this.onLevelHint('已进入县级：路径取消选中（路线保留），单击乡镇只看信息；要继续连线请在路径面板点选某条路径')
    }
    const name = (feature.properties && feature.properties.name) || adcode
    this._clearTowns()
    this.mode = 'town'
    this.selected = null
    this._clearHighlight()
    // 进县级后地形要换成该县的高精度晕渲，水系也换成该县自己的数据
    this._reloadGeoLayers(adcode)

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
        this.onLevelHint(`${name} 乡镇图层构建失败：${e && e.message}`)
      }
    }
    // 回退分支里收集下来的标记：没有真实边界时，名称层要用它们做锚点
    const fallbackMarkers = []
    if (!any) {
      // 回退：合成点位标记
      const towns = await loadTowns(adcode)
      if (towns && towns.length) {
        for (const t of towns) {
          const info = findTownInfo(t.name, this.townInfoMap)
          const marker = createTownMarker(info ? { ...t, ...townToDisplay(info) } : t, this.projection, MAP_W, DEPTH)
          if (marker) {
            g.add(marker)
            fallbackMarkers.push(marker)
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
    this.townName = name
    this.scene.add(g)
    // 进乡镇后名称层改显示乡镇名（真实边界要素优先，无边界时用合成点位）
    this._rebuildNameLayer(
      this.townFeatureGroups.length ? this.townFeatureGroups : fallbackMarkers
    )

    // 聚焦到该区县中心
    const c = feature.properties && (feature.properties.center || feature.properties.centroid)
    if (c && this.projection) {
      const cw = geoToWorld(this.projection, MAP_W, DEPTH, c[0], c[1])
      if (cw) this._focus(cw.clone(), cw.clone().add(new THREE.Vector3(0, 520, 760)))
      // 墨卡托在局部是等角的，用县中心处"1 公里经度差"换算出世界单位/公里
      this.unitsPerKm = this._estimateUnitsPerKm(c)
    }
    this.onBreadcrumb(this._crumbs())
  }

  _exitTownView() {
    this._clearTowns()
    this.mode = 'region'
    this.selectedTown = null
    this.onSelectTown(null)
    // 退回区域视图：名称层改回显示区县名
    this._rebuildNameLayer(this.featureGroups)
    this.onBreadcrumb(this._crumbs())
  }

  // ---------- 单镇视图：下钻到乡镇内部看下辖村 / 社区 ----------

  /**
   * 双击某个乡镇 → 进入该镇内部视图。
   * 镇板块用其真实边界单独渲染（放大铺满画面），上方悬浮下辖村/社区名录环。
   * @param {THREE.Group} fg 乡镇要素组（userData 上带 town 与 feature）
   */
  _drillTown(fg) {
    if (!fg || !fg.userData) return
    const town = fg.userData.town || {}
    const feature = fg.userData.feature
    const name = town.name || (feature && feature.properties && feature.properties.name) || '该镇'

    // 合成点位（无真实边界的回退分支）没有几何，撑不起单镇板块——必须明确告知，不能静默无反应
    if (!feature || !feature.geometry) {
      this.onLevelHint(`${name}：暂无乡镇边界数据，无法进入镇内视图`)
      return
    }

    // 村级名录来自政府门户采集的展示信息；没有名录就没有这一级可看
    const info = town.info || findTownInfo(name, this.townInfoMap)
    const villages = (info && info.villages) || []
    const communities = (info && info.communities) || []
    if (!villages.length && !communities.length) {
      this.onLevelHint(`${name}：暂无下辖村 / 社区名录数据`)
      return
    }

    // 巡航依赖当前路径的采样与坐标，换视图必须停，否则相机会突然跳；
    // 村级是最深一级，同样不保留路径选中，免得退出小镇后误把点击算进路线
    this.clearRouteSelection()

    // 单镇视图独占画面：县底图、乡镇总览、路径管道一并隐藏（不是销毁，退出时原样恢复）
    if (this.mapGroup) this.mapGroup.visible = false
    if (this.townGroup) this.townGroup.visible = false
    this.routes.forEach((r) => {
      r.group.visible = false
    })

    // 只渲染这一个镇：createExtrudedMap 会按要素范围重新拟合投影，板块自然铺满
    const single = { type: 'FeatureCollection', features: [feature] }
    const built = createExtrudedMap(single, {
      width: MAP_W,
      height: MAP_W,
      depth: DEPTH,
      theme: this.theme
    })
    this.villageGroup = built.group
    this.villageFeatureGroups = built.featureGroups
    this.villageSideMaterials = built.sideMaterials
    this.scene.add(this.villageGroup)

    // 名录环挂在 scene 而非 villageGroup：后者整体绕 X 轴转了 -90°，
    // 挂在它下面 Sprite 的位置会被一起转平，标牌就躺到地面上了
    const ring = createVillageRing({
      villages,
      communities,
      title: name,
      radius: MAP_W * 0.3,
      y: DEPTH * 0.5 + 96,
      paper: themePaper(this.theme)
    })
    this.villageRing = ring
    this.scene.add(ring.group)

    this.mode = 'village'
    // 单镇视图是"名录环"的示意视图，真实地理图层收起，避免与示意图形混在一起
    this._setGeoLayersVisible(false)
    this.villageAdcode = (info && info.adcode) || null
    this.villageName = name
    this.selectedTown = fg
    // 单镇只有一块板块，名称层再打一个镇名标牌会和中心说明牌打架，这里直接清空
    if (this.nameLayer) this.nameLayer.clear()

    this._resetCamera()
    this.onBreadcrumb(this._crumbs())
    this.onSelectTown(town)
    // 口径必须说清楚：画面上这一圈是名录，不是村落的真实地理位置
    this.onLevelHint(
      `${name} · ${villages.length} 村 ${communities.length} 社区（村级暂无坐标数据，按名录展示）`
    )
  }

  /** 退出单镇视图，回到该区县的乡镇总览 */
  _exitVillageView() {
    this._clearVillage()
    this.mode = 'town'
    this._setGeoLayersVisible(true)
    if (this.mapGroup) this.mapGroup.visible = true
    if (this.townGroup) this.townGroup.visible = true
    this.routes.forEach((r) => {
      r.group.visible = true
    })
    // 名称层恢复显示乡镇名（真实边界要素优先，无边界时为空）
    this._rebuildNameLayer(this.townFeatureGroups)
    this.onBreadcrumb(this._crumbs())
  }

  _clearVillage() {
    if (this.villageRing) {
      this.scene.remove(this.villageRing.group)
      this.villageRing.dispose()
      this.villageRing = null
    }
    if (this.villageGroup) {
      this.villageGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          mats.forEach((m) => m.dispose && m.dispose())
        }
      })
      this.scene.remove(this.villageGroup)
    }
    this.villageGroup = null
    this.villageFeatureGroups = []
    this.villageSideMaterials = []
    this.villageAdcode = null
    this.villageName = ''
  }

  /**
   * 面包屑：区域栈 +（乡镇视图时的县名）+（单镇视图时的镇名）。
   * 乡镇视图里县 adcode 未必入栈（drill 渲染县级底图时已 push 过），入栈就不重复追加。
   */
  _crumbs() {
    const names = this.adcodeStack.map((a) => this.nameMap[a] || a)
    if (this.townAdcode) {
      const last = this.adcodeStack[this.adcodeStack.length - 1]
      if (last !== String(this.townAdcode)) {
        names.push(this.nameMap[this.townAdcode] || this.townName || this.townAdcode)
      }
    }
    if (this.mode === 'village' && this.villageName) names.push(this.villageName)
    return names
  }

  _clearTowns() {
    this.hoveredTown = null
    // 退出乡镇视图时单镇视图必然一起退：先收掉它，再把上层图层恢复可见
    if (this.mode === 'village') {
      this._clearVillage()
      this.mode = 'town'
      if (this.mapGroup) this.mapGroup.visible = true
      this.routes.forEach((r) => {
        r.group.visible = true
      })
    }
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
    this.townName = ''
    this.townSideMaterials = []
    this.townFeatureGroups = []
    this.unitsPerKm = null
    // 路径点存的是经纬度，换视图只换投影，因此不再清空路径——跨层级的路线要能继续用。
    // 但巡航必须停：相机插值依赖当前路径的采样，留着会突然跳镜头。
    if (this.cruising) {
      this.cruising = false
      this.cruiseAll = false
      this.cruiseT = 0
      this.cruiseLook = null
      this.onRouteChange(this.routeState(), null)
    }
  }

  back() {
    // 逐层退出：单镇视图 → 乡镇总览 → 区县 → … → 全国
    if (this.mode === 'village') {
      this._exitVillageView()
      return
    }
    if (this.mode === 'town') {
      this._exitTownView()
      return
    }
    if (this.adcodeStack.length > 1) {
      this.adcodeStack.pop()
      this.load()
    }
  }

  /**
   * 点击面包屑跳层。面包屑比区域栈最多多两级（县名、镇名），
   * 点到更深的项等于停在原地，不能拿它去索引 adcodeStack。
   */
  goToLevel(index) {
    if (index < 0) return
    const depth = this.adcodeStack.length - 1

    if (this.mode === 'village') {
      if (index >= this._crumbs().length - 1) return // 点的是镇名本身：已在最深层
      this._exitVillageView()
      if (index >= depth) return // 点的是县名：回到乡镇总览即可
    } else if (this.mode === 'town') {
      if (index >= depth) {
        this._exitTownView()
        return
      }
    }

    if (index < depth) {
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
    // 单镇视图里只有一块板块和名录标牌，没有可交互要素（标牌已禁用拾取）
    if (this.mode === 'village') return
    if (!this.mapGroup && !this.townGroup) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)

    // 军事要素优先：符号本来就浮在板块之上，命中最上面的东西才符合直觉
    if (this.militaryLayer && this.militaryLayer.group.visible && this.militaryLayer.pickables.length) {
      const mh = this.raycaster.intersectObjects(this.militaryLayer.pickables, false)
      const f = mh.length && mh[0].object.userData.milFeature
      if (f) {
        this.onMilitarySelect(f)
        return
      }
    }

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
      // 点在乡镇之外的空白处：取消选中，面板与高亮一起收掉
      this.onMilitarySelect(null)
      this.clearSelection()
      return
    }

    // 区域模式
    const hits = this.raycaster.intersectObjects(this.mapGroup.children, true)
    for (const h of hits) {
      if (h.object.userData && h.object.userData.feature) {
        this._select(h.object.parent, h.object.userData.feature)
        return
      }
    }
    this.onMilitarySelect(null)
    this.clearSelection()
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
    if (fg.userData.label) fg.userData.label.visible = !this.namesVisible
    // 选中乡镇：顶面提亮自发光（同样仅真实边界要素具备）
    if (fg.userData.capMat && fg.userData.baseColor) {
      fg.userData.capMat.emissive.copy(fg.userData.baseColor).multiplyScalar(0.6)
    }
    const town = fg.userData.town
    const world = (fg.userData.centerWorld || new THREE.Vector3()).clone()

    // 追加为路径点：只有用户显式选中了某条路径时才连，与区域视图的规则一致。
    // 县级默认不选中路径 → 单击乡镇只是看信息，不会凭空冒出一条路线。
    if (this.routeIndex >= 0) {
      this.addRouteStop(world, {
        name: town.name,
        adcode: (town.info && town.info.adcode) || null,
        level: 'town',
        lngLat: fg.userData.lngLat
      })
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

  /**
   * 当前视图下 1 屏幕像素 ≈ 多少公里（图廓比例尺用）。
   * 透视相机下不同深度的尺度不同，这里取「地图面（要素顶面所在平面）」上的尺度，
   * 也就是比例尺真正承诺的那一个平面；拿不到投影或相机时返回 null，UI 自行隐藏比例尺。
   */
  kmPerPixel() {
    if (!this.projection || !this.camera) return null
    const h = this.container.clientHeight || 0
    if (h <= 0) return null
    const t = this.controls ? this.controls.target : { x: 0, y: 0, z: 0 }
    const planeY = this.mode === 'town' ? DEPTH + TOWN_DEPTH * 0.5 : DEPTH * 0.5
    const p = new THREE.Vector3(t.x, planeY, t.z)
    const dist = this.camera.position.distanceTo(p)
    if (!(dist > 1)) return null
    const fov = (this.camera.fov * Math.PI) / 180
    // 该深度上：半个视口高度对应的世界距离 = dist * tan(fov/2)
    const pxPerUnit = h / 2 / (dist * Math.tan(fov / 2))
    const unitsPerKm = this._estimateUnitsPerKm(this.viewCenter)
    if (!(pxPerUnit > 0) || !(unitsPerKm > 0)) return null
    return 1 / (pxPerUnit * unitsPerKm)
  }

  /**
   * 当前视图下 1 屏幕像素 = 多少世界单位（军标等图面装饰的尺寸基准）。
   * 与 kmPerPixel 同一个平面、同一套相机参数，只是不做地理换算——
   * 拿不到相机时返回 null，调用方自行兜底。
   */
  unitPerPixel() {
    if (!this.camera) return null
    const h = this.container.clientHeight || 0
    if (h <= 0) return null
    const t = this.controls ? this.controls.target : { x: 0, y: 0, z: 0 }
    const planeY = this.mode === 'town' ? DEPTH + TOWN_DEPTH * 0.5 : DEPTH * 0.5
    const p = new THREE.Vector3(t.x, planeY, t.z)
    const dist = this.camera.position.distanceTo(p)
    if (!(dist > 1)) return null
    const fov = (this.camera.fov * Math.PI) / 180
    return (dist * Math.tan(fov / 2)) / (h / 2)
  }

  /** 图廓用的视图信息：当前层级名与比例尺基准，交给 UI 渲染 */
  frameInfo() {
    return {
      level: this.mode, // 'region' | 'town' | 'village'
      depth: this.adcodeStack.length,
      kmPerPx: this.kmPerPixel()
    }
  }

  /** 当前正在编辑的路径（没有则为 null） */
  get route() {
    return this.routeIndex >= 0 ? this.routes[this.routeIndex] || null : null
  }

  /**
   * 取消当前路径的「编辑选中」。
   * 路径与其路径点全部保留（下钻/回退时跨层级继续用），
   * 只是后续单击不再往它身上追加点 —— 是否连线由用户显式选中决定。
   * @returns {boolean} true = 原本有选中路径、本次已取消
   */
  clearRouteSelection() {
    if (this.routeIndex < 0) return false
    if (this.cruising) this.stopCruise()
    this.routeIndex = -1
    this.cruiseT = 0
    this.cruiseLook = null
    this._restoreNoSelection = false
    this.onRouteChange(this.routeState(), null)
    return true
  }

  /** 是否正处于「选中了某条路径」的连线状态 */
  get routeEditing() {
    return this.routeIndex >= 0
  }

  /** 取消信息面板的选中态：面板关掉后板块不能还亮着 */
  clearSelection() {
    if (this.selectedTown) {
      const prev = this.selectedTown
      if (prev.userData.label) prev.userData.label.visible = false
      if (prev.userData.capMat && prev.userData.baseColor) {
        prev.userData.capMat.emissive.copy(prev.userData.baseColor).multiplyScalar(0.16)
      }
      this.selectedTown = null
      this.onSelectTown(null)
    }
    if (this.selected) {
      this._clearHighlight()
      this.onSelect(null)
    }
    this._clearEffects()
  }

  /** 单条路径 → UI 需要的摘要 */
  _pathSummary(r, i) {
    const u = this.unitsPerKm
    const toKm = (v) => (u ? +(v / u).toFixed(1) : null)
    const km = toKm(r.totalLength)
    return {
      index: i,
      name: r.name || `路径 ${i + 1}`,
      color: `#${r.color.getHexString()}`,
      count: r.count,
      length: km != null ? km : Math.round(r.totalLength),
      // 拿不到投影尺度时退回世界单位，不谎报 km
      lengthText: km != null ? `${km} km` : `${Math.round(r.totalLength)} 单位`,
      stops: r.stops.map((s, k) => ({ index: k + 1, name: s.name, adcode: s.adcode, level: s.level }))
    }
  }

  /**
   * 供 RouteBar 渲染的完整状态。
   * 顶层 count / stops / lengthText 等保留为「当前路径」的字段（兼容单路径的读法），
   * 多路径信息放在 paths / activeIndex 里。
   */
  routeState() {
    const r = this.route
    const cur = r
      ? this._pathSummary(r, this.routeIndex)
      : { index: -1, name: '', count: 0, length: 0, lengthText: '0 km', stops: [] }
    return {
      ...cur,
      paths: this.routes.map((p, i) => this._pathSummary(p, i)),
      activeIndex: this.routeIndex,
      cruising: this.cruising,
      cruiseAll: this.cruiseAll,
      speed: this.cruiseSpeed,
      speedKmh: this.unitsPerKm ? +(this.cruiseSpeed * 3.6 / this.unitsPerKm).toFixed(1) : null
    }
  }

  // ---------- 多条路径管理 ----------

  /** 新建一条路径并设为当前；name 为空时按序号自动命名 */
  newRoute(name = '') {
    const idx = this.routes.length
    const paper = themePaper(this.theme)
    const c = routeColorAt(idx, paper)
    const r = new RoutePath({
      scene: this.scene,
      lift: 46,
      // 管道悬浮在要素顶面之上：区域中心 y=DEPTH*0.5，乡镇中心 y=DEPTH+TOWN_DEPTH/2
      color: c.color,
      glow: c.glow,
      joint: c.joint,
      name: name || `路径 ${idx + 1}`,
      paper
    })
    this.routes.push(r)
    this.routeIndex = idx
    this._restoreNoSelection = false
    this.onRouteChange(this.routeState(), null)
    return idx
  }

  /** 切换当前路径 */
  selectRoute(i) {
    if (i < 0 || i >= this.routes.length) return false
    this.stopCruise()
    this.routeIndex = i
    this.cruiseT = 0
    this._restoreNoSelection = false
    this.onRouteChange(this.routeState(), null)
    return true
  }

  /** 删除一条路径；删掉当前路径后自动切到相邻的一条 */
  removeRoute(i) {
    if (i < 0 || i >= this.routes.length) return false
    const wasCurrent = i === this.routeIndex
    if (wasCurrent) this.stopCruise()
    const r = this.routes[i]
    this.routes.splice(i, 1)
    if (r) r.dispose()
    if (!this.routes.length) {
      this.routeIndex = -1
    } else if (wasCurrent) {
      this.routeIndex = Math.min(i, this.routes.length - 1)
    } else if (this.routeIndex > i) {
      this.routeIndex -= 1
    }
    this.cruiseT = 0
    this.onRouteChange(this.routeState(), null)
    return true
  }

  renameRoute(i, name) {
    const r = this.routes[i]
    if (!r) return false
    r.name = String(name || '').trim() || r.name
    this.onRouteChange(this.routeState(), null)
    return true
  }

  /** 当前视图下把经纬度换算成世界坐标；失败返回 null（调用方据此整条路径不重投影） */
  _projectRoutePoint(stop) {
    if (!this.projection || !stop || !stop.lngLat) return null
    const [lng, lat] = stop.lngLat
    // 乡镇浮雕坐在县顶面之上，基准高度比区域面高一层，否则管道会插进板块里
    const baseY = stop.level === 'town' ? DEPTH + TOWN_DEPTH / 2 : DEPTH * 0.5
    return geoToWorld(this.projection, MAP_W, baseY, lng, lat)
  }

  /**
   * 投影变化后重算所有路径点的世界坐标。
   * 这是「路径能跨层级保留」的关键：路径点存的是经纬度，换视图只是换了投影。
   */
  _reprojectRoutes() {
    if (!this.routes.length) return
    const failed = []
    for (const r of this.routes) {
      const res = r.reproject((s) => this._projectRoutePoint(s))
      if (!res.ok && res.reason) failed.push(res.reason)
    }
    if (failed.length) {
      // 定位失败的路径保持原样（不重投影），但要让用户知道，而不是悄悄画出错误位置
      console.warn('[maps-dashboard] 部分路径未能重投影：', failed.join('；'))
    }
  }

  /**
   * 追加一个路径点：只作用于「当前选中的那条路径」。
   * 没有选中路径时返回 null 且绝不新建 —— 单击区域/乡镇首先是「看信息」，
   * 想连线必须由用户在路径面板显式点选或新建路径。
   * @param {THREE.Vector3} world 要素中心的世界坐标
   * @param {object} meta { name, adcode, level, lngLat }
   */
  addRouteStop(world, meta = {}) {
    const r = this.route
    if (!r) return null
    if (this.cruising) this.stopCruise()
    const res = r.addPoint(world, meta)
    if (res.added) {
      // 区域比乡镇大得多，聚焦距离要跟着放大，否则镜头会怼进板块里
      const town = meta.level === 'town'
      this._focus(
        world.clone().add(new THREE.Vector3(0, 10, 0)),
        world.clone().add(new THREE.Vector3(0, town ? 360 : 620, town ? 560 : 880))
      )
    }
    this.onRouteChange(this.routeState(), res)
    return res
  }

  /** 可巡航（点数 ≥ 2）的路径下标列表 */
  _cruisableIndexes() {
    return this.routes.map((r, i) => (r.count >= 2 ? i : -1)).filter((i) => i >= 0)
  }

  /** 沿管道全程巡航跟拍；不足 2 个点时无法成线 */
  startCruise({ all = false } = {}) {
    if (all) {
      const list = this._cruisableIndexes()
      if (!list.length) return false
      // 从当前路径之后的第一条可巡航路径起步，没有就从头开始
      const start = list.find((i) => i >= this.routeIndex)
      // 未选中路径时「全部巡航」会临时占用 routeIndex，记下来以便停下时还原成未选中，
      // 否则一次全部巡航就把某条路径悄悄变成了当前编辑对象
      this._restoreNoSelection = this.routeIndex < 0
      this.routeIndex = start != null ? start : list[0]
      this.cruiseAll = true
    } else {
      if (!this.route || this.route.count < 2) return false
      this.cruiseAll = false
    }
    this.cruising = true
    this.cruiseT = 0
    this.cruiseLook = this.cruiseLook || this.controls.target.clone()
    // 让出相机：清空单击聚焦目标，避免两套插值互相拉扯
    this.focusTarget = null
    this.focusPos = null
    this.onRouteChange(this.routeState(), null)
    return true
  }

  /** 依次巡航所有路径（每条走完自动接下一条） */
  startCruiseAll() {
    return this.startCruise({ all: true })
  }

  stopCruise() {
    if (!this.cruising) return false
    this.cruising = false
    this.cruiseAll = false
    // 全部巡航是「临时占用」当前路径的，停下即还原为未选中状态
    if (this._restoreNoSelection) {
      this._restoreNoSelection = false
      this.routeIndex = -1
    }
    // 把巡航末帧的视点交回 OrbitControls，退出后不会突然跳镜头
    if (this.cruiseLook) {
      this.controls.target.copy(this.cruiseLook)
      this.controls.update()
    }
    this.onRouteChange(this.routeState(), null)
    return true
  }

  toggleCruise(all = false) {
    return this.cruising ? (this.stopCruise(), false) : (this.startCruise({ all }), this.cruising)
  }

  setCruiseSpeed(v) {
    this.cruiseSpeed = Math.max(40, Math.min(1200, Number(v) || 260))
    this.onRouteChange(this.routeState(), null)
  }

  /** 清空当前路径的点（路径本身保留，方便接着重新连）；没有选中路径则返回 false */
  clearRoute() {
    if (!this.route) return false
    this.stopCruise()
    this.cruiseT = 0
    this.cruiseLook = null
    this.route.clear()
    this.onRouteChange(this.routeState(), null)
    return true
  }

  /** 清空当前路径并删除它（RouteBar 的「删除路径」走这个） */
  removeCurrentRoute() {
    if (this.routeIndex < 0) return
    this.removeRoute(this.routeIndex)
  }

  /** 撤销当前路径最后一个点；没有选中路径或无点可撤则返回 false */
  removeLastStop() {
    if (!this.route || !this.route.count) return false
    this.stopCruise()
    this.route.removeLast()
    this.cruiseT = 0
    this.onRouteChange(this.routeState(), null)
    return true
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
    if (this.mode === 'village') return
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
      // 名称层已常显时不叠加悬停标签，否则同一个镇会冒出两块标牌
      if (marker.userData.label) marker.userData.label.visible = !this.namesVisible
      this.renderer.domElement.style.cursor = 'pointer'
    } else {
      this.renderer.domElement.style.cursor = ''
    }
  }

  _select(featureGroup, feature) {
    this._clearHighlight()
    this._highlight(featureGroup)
    this.selected = featureGroup

    const p = feature.properties || {}
    const cw = featureGroup.userData.centerWorld
    // 正在编辑路径时，单击区域也追加为路径点 → 省际 / 市际巡航路线。
    // 没有路径时不加点：区域视图的单击主要是"看信息"，每次点击都冒出一条路径会很烦。
    let added = false
    if (cw && this.routeIndex >= 0 && (p.center || p.centroid)) {
      const res = this.addRouteStop(cw, {
        name: p.name,
        adcode: p.adcode,
        level: p.level || 'region',
        lngLat: p.center || p.centroid
      })
      added = !!(res && res.added)
    }
    if (cw) {
      // 加了路径点时相机已由 addRouteStop 接管，此处不再抢，避免两套目标来回拉扯
      if (!added) this._focus(cw.clone(), cw.clone().add(new THREE.Vector3(0, 620, 880)))
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
    // 拖动视角（旋转/平移）松手时浏览器仍会补一个 click，若不过滤就会误选中板块、
    // 甚至在连线路线上凭空多出一个路径点。按下与抬起位移超过阈值即视为拖拽，不算点击。
    this._onDown = (e) => {
      this._downX = e.clientX
      this._downY = e.clientY
    }
    this._onClick = (e) => {
      if (this._downX != null && Math.hypot(e.clientX - this._downX, e.clientY - this._downY) > 5) return
      this._pick(e)
    }
    this._onMove = (e) => this._hover(e)
    this._onDblClick = (e) => {
      // 单镇视图已是最深一级，无可下钻
      if (this.mode === 'village') return
      this._pick(e)
      if (this.mode === 'town') {
        // 乡镇视图：双击当前选中的镇 → 进入该镇内部看下辖村 / 社区
        if (this.selectedTown) this._drillTown(this.selectedTown)
        return
      }
      if (this.selected && this.selected.userData.feature) {
        this.drill(this.selected.userData.feature)
      }
    }
    this._onContext = (e) => {
      e.preventDefault()
      this.back()
    }
    this._onResize = () => this._resize()
    el.addEventListener('pointerdown', this._onDown)
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
    // 地形晕渲与水系都依赖本层的投影，要素一换就得跟着重建
    this._clearTerrain()
    this._clearHydro()
    // 要素已销毁，名称标签不能留在场上指向不存在的板块
    if (this.nameLayer) this.nameLayer.clear()
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
    this.villageSideMaterials.forEach((m) => {
      m.uniforms.uTime.value = el
    })
    // 巡航跟拍：接管相机，期间跳过 OrbitControls，避免两套插值互相拉扯
    if (this.cruising && this.route && this.route.count >= 2) {
      const len = Math.max(this.route.totalLength, 1)
      this.cruiseT += (dt * this.cruiseSpeed) / len
      if (this.cruiseT >= 1) {
        // 多条路径串联巡航：走完当前这条就接下一条（只有一条时原地循环）
        if (this.cruiseAll) {
          const list = this._cruisableIndexes()
          if (list.length > 1) {
            const at = list.indexOf(this.routeIndex)
            this.routeIndex = list[(at + 1) % list.length]
            this.onRouteChange(this.routeState(), null)
          }
        }
        this.cruiseT -= 1
      }
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

    // 名称标牌按相机距离缩放，保证拉近拉远都看得清
    if (this.nameLayer) this.nameLayer.update(this.camera)
    // 军标 / 标牌按屏幕像素恒定：视角一变就重标定（内部有 2% 阈值，静止时零开销）
    if (this.militaryLayer) {
      const upp = this.unitPerPixel()
      if (upp) this.militaryLayer.setScreenScale(upp)
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
    // 所有路径都要推进流动光带动画，否则非当前路径会"定格"
    this.routes.forEach((r) => r.update(dt))

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
    this.routes.forEach((r) => r.dispose())
    this.routes = []
    this.routeIndex = -1
    if (this.nameLayer) this.nameLayer.dispose()
    this._clearMilitary()
    this._clearTerrain()
    this._clearHydro()
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this._onDown)
    el.removeEventListener('click', this._onClick)
    el.removeEventListener('pointermove', this._onMove)
    el.removeEventListener('dblclick', this._onDblClick)
    el.removeEventListener('contextmenu', this._onContext)
    this._clearVillage()
    this._clearTowns()
    this._clearMap()
    this.controls.dispose()
    this.renderer.dispose()
    if (el.parentNode) el.parentNode.removeChild(el)
  }
}
