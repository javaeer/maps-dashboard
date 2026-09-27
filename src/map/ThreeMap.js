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
import { resolveTheme } from './palette.js'
import { findTownInfo, townToDisplay } from '../utils/townName.js'

const MAP_W = 1024
// 拉伸高度取地图宽度的 ~7%，避免区域变成"通天柱"
const DEPTH = 70
// 乡镇子图层薄浮雕高度（坐在县顶面之上）
const TOWN_DEPTH = 12

export class ThreeMap {
  constructor(container, { onSelect, onBreadcrumb, onSelectTown, onTownEmpty, onTownInfo, onRouteChange, onLevelHint } = {}) {
    this.container = container
    this.onSelect = onSelect || (() => {})
    this.onTownInfo = onTownInfo || (() => {})
    this.onRouteChange = onRouteChange || (() => {})
    this.onBreadcrumb = onBreadcrumb || (() => {})
    this.onSelectTown = onSelectTown || (() => {})
    this.onTownEmpty = onTownEmpty || (() => {})
    // 进入更深层级时的口径提示（如村级数据的坐标情况），由 UI 弹 toast
    this.onLevelHint = onLevelHint || (() => {})

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
    // 配色主题：支持 URL 参数 ?palette=tech|aurora|sunset 现场切换
    this.theme = resolveTheme()
    // 每帧渲染完成后的回调，供视频录制抓取画面；未设置时不产生任何开销
    this.onFrame = null

    this._init()
    // 名称立体标签层：开关打开后在当前层级的板块上显示名称（全国显示省名、省内显示市名…）
    this.nameLayer = new NameLayer({ scene: this.scene })
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
    this.scene.add(this.mapGroup)
    // 本层渲染的就是「下一级行政区」（全国→省、省→市、市→区县），
    // 名称层直接取这批要素的 name，天然符合"进到哪一级就显示哪一级名称"
    this._rebuildNameLayer(built.featureGroups)
    // 投影换了：已有路径按经纬度重新落位，跨层级继续保留
    this._reprojectRoutes()
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
    if (this._clearRouteSelection()) {
      this.onLevelHint('已进入县级：路径取消选中（路线保留），单击乡镇只看信息；要继续连线请在路径面板点选某条路径')
    }
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
    this._clearRouteSelection()
    if (this.cruising) {
      this.cruising = false
      this.cruiseAll = false
      this.cruiseT = 0
      this.cruiseLook = null
      this.onRouteChange(this.routeState(), null)
    }

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
      y: DEPTH * 0.5 + 96
    })
    this.villageRing = ring
    this.scene.add(ring.group)

    this.mode = 'village'
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
  _clearRouteSelection() {
    if (this.routeIndex < 0) return false
    if (this.cruising) this.stopCruise()
    this.routeIndex = -1
    this.cruiseT = 0
    this.cruiseLook = null
    this.onRouteChange(this.routeState(), null)
    return true
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
    const c = routeColorAt(idx)
    const r = new RoutePath({
      scene: this.scene,
      lift: 46,
      // 管道悬浮在要素顶面之上：区域中心 y=DEPTH*0.5，乡镇中心 y=DEPTH+TOWN_DEPTH/2
      color: c.color,
      glow: c.glow,
      joint: c.joint,
      name: name || `路径 ${idx + 1}`
    })
    this.routes.push(r)
    this.routeIndex = idx
    this.onRouteChange(this.routeState(), null)
    return idx
  }

  /** 切换当前路径 */
  selectRoute(i) {
    if (i < 0 || i >= this.routes.length) return false
    this.stopCruise()
    this.routeIndex = i
    this.cruiseT = 0
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
    this._onClick = (e) => this._pick(e)
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
    const el = this.renderer.domElement
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
