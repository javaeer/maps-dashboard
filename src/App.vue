<template>
  <div ref="stage" class="stage" :class="{ 'is-fs': isFullscreen, recording: isRecording }">
    <div ref="container" class="map"></div>

    <!-- 兵要地志的图廓层：内外双线图框、图名、指北针、比例尺、图注、钤印、做旧。
         纯装饰不吃点击（pointer-events: none），只在纸质主题出现。 -->
    <MapFrame
      v-if="isPaper"
      :title="frameTitle"
      :level-label="frameLevel"
      :get-km-per-px="() => (map ? map.kmPerPixel() : null)"
      :geo="geoNote"
      :mil-stats="milStats"
    />

    <header class="topbar">
      <div class="title">{{ isPaper ? '兵要地志 · 中国行政区划' : '中国 3D 地图可视化大屏' }}</div>
      <Breadcrumb :items="breadcrumb" @select="onCrumb" />
      <div class="palette">
        <button
          v-for="(t, key) in themes"
          :key="key"
          class="swatch"
          :class="{ active: key === current }"
          :title="t.label"
          :style="{ '--c1': t.swatch[0], '--c2': t.swatch[1], '--c3': t.swatch[2] }"
          @click="pickTheme(key)"
        >
          <span>{{ t.label }}</span>
        </button>
      </div>

      <div class="tools">
        <!-- 路径：未选中 = 开工（新建/选中一条路线），已选中 = 取消选中退回只看信息 -->
        <button
          class="fsbtn"
          :class="{ active: routeEditing }"
          :title="routeEditing ? '取消路径选中（Esc）：退回单击只看信息，路径本身保留' : '新建一条巡航路径（省 / 市 / 区县 / 乡镇均可连线）'"
          @click="onRouteButton"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2.5 12.5c2.4-6 4.6 0 7.2-5" />
            <circle cx="2.5" cy="12.5" r="1.5" />
            <circle cx="9.7" cy="7.5" r="1.5" />
          </svg>
          <span>路径</span>
        </button>
        <!-- 名称：在当前层级的板块上立体显示名称（全国显示省名，进省显示市名，依此类推） -->
        <button
          class="fsbtn"
          :class="{ active: namesOn }"
          :title="namesOn ? `关闭名称显示（本层 ${nameCount} 个）` : '在板块上立体显示本层级名称'"
          @click="onToggleNames"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 4.5h10M3 8h6.5M3 11.5h10" />
          </svg>
          <span>名称</span>
        </button>
        <!-- 山系 / 水系：真实地理图层，可分别关掉（关掉后图注里也不再列它） -->
        <button
          class="fsbtn"
          :class="{ active: geoOn.terrain }"
          :title="geoOn.terrain
            ? `隐藏山系（晕渲${geoNote && geoNote.peaks ? ` + ${geoNote.peaks} 个山头` : ''}）`
            : '显示山系（地形晕渲 + 山头）'"
          @click="onToggleGeo('terrain')"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M1.5 12.5l4-7 3.2 5 1.8-3 4 5z" />
          </svg>
          <span>山系</span>
        </button>
        <button
          class="fsbtn"
          :class="{ active: geoOn.hydro }"
          :title="geoOn.hydro
            ? `隐藏水系${geoNote && geoNote.rivers ? `（${geoNote.rivers} 条河 / ${geoNote.lakes} 个湖）` : ''}`
            : '显示水系（河川 / 湖泊）'"
          @click="onToggleGeo('hydro')"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2 6c1.6-2 3.2 2 4.8 0S10 4 11.6 6 15 6.5 15 6.5" />
            <path d="M2 10.5c1.6-2 3.2 2 4.8 0S10 8.5 11.6 10.5 15 11 15 11" />
          </svg>
          <span>水系</span>
        </button>
        <!-- 军事要素：布防 / 驻军 / 行军路线等随时代变化，一律由导入数据提供 -->
        <button
          class="fsbtn"
          :class="{ active: milOpen }"
          :title="milStore.totalCount
            ? `军事要素面板（已导入 ${milStore.sets.length} 个数据集 / ${milStore.totalCount} 个要素）`
            : '导入军事要素：驻军 / 布防 / 行军路线（支持 CSV、Excel、GeoJSON，模板可下载）'"
          @click="onMilitaryButton"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 13.5V2.5m0 0h7.5l-2 3 2 3H4" />
          </svg>
          <span>军事要素</span>
        </button>
        <button
          class="fsbtn"
          :title="`导入业务数据${store.dataSets.length ? `（已有 ${store.dataSets.length} 个数据集）` : ''}`"
          @click="showImport = true"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M8 10V2m0 0L5 5m3-3l3 3M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
          </svg>
          <span>导入数据</span>
        </button>
        <button
          class="fsbtn"
          :class="{ active: isFullscreen }"
          :title="isFullscreen ? '退出全屏（F / Esc）' : '全屏（F）'"
          @click="toggleFullscreen"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <template v-if="isFullscreen">
              <path d="M2 6h4V2M14 6h-4V2M10 14v-4h4M6 14v-4H2" />
            </template>
            <template v-else>
              <path d="M6 2H2v4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
            </template>
          </svg>
          <span>{{ isFullscreen ? '退出全屏' : '全屏' }}</span>
        </button>
      </div>

      <!-- 录制控件独立于 .tools：录制时要隐藏 .tools，但录制按钮本身必须留着 -->
      <RecordButton
        :get-map="() => map"
        :get-stage="() => stage"
        :enabled="mapReady"
        @state-change="isRecording = $event"
      />
    </header>

    <div v-if="!hasRoute" class="hint">单击查看信息 · 双击下钻（区县→乡镇→村 / 社区）· 右键返回 · 「路径」把省 / 市 / 区县 / 乡镇连成巡航路线（Esc 取消连线）· 「山系 / 水系」开关真实地理图层 · 「军事要素」导入布防与行军路线 · F 键全屏</div>

    <transition name="fade">
      <div v-if="townHint" class="toast">{{ townHint }}</div>
    </transition>

    <InfoPanel
      :data="selected"
      :business="businessRecords"
      :source-label="townSource"
      @close="closePanel"
    />

    <!-- 业务数据导入向导，由顶栏「导入数据」唤起 -->
    <DataImportPanel v-if="showImport" @close="showImport = false" @imported="onImported" />

    <!-- 军事要素：导入向导（含模板下载）与管理面板 -->
    <MilitaryPanel
      v-if="showMilImport"
      @close="showMilImport = false"
      @imported="onMilImported"
    />
    <MilitaryBar
      v-if="milOpen"
      :sets="milStore.sets"
      :eras="milStore.eras"
      :kind-stats="milStore.kindStats"
      :era-filter="milStore.eraFilter"
      :kind-filter="milStore.kindFilter"
      :shown-count="milStore.renderFeatures.length"
      :total-count="milStore.totalCount"
      :picked="milPicked"
      :paper="isPaper"
      @import="showMilImport = true"
      @close="milOpen = false; milPicked = null"
      @toggle-set="onMilToggleSet"
      @toggle-label="onMilToggleLabel"
      @remove-set="onMilRemove"
      @set-era="onMilEra"
      @toggle-kind="onMilKind"
    />

    <!-- 业务数据：数据集 / 指标 / 聚合 + 分级色阶图例 -->
    <BusinessBar
      v-if="businessOpen || store.dataSets.length"
      :datasets="store.dataSets"
      :field-key="businessField"
      :aggregate="businessAgg"
      :active="businessActive"
      :legend="businessLegend"
      :paper="isPaper"
      @import="showImport = true"
      @close="businessOpen = false"
      @select-dataset="onBizSelectDataset"
      @select-field="onBizSelectField"
      @set-agg="onBizSetAgg"
      @toggle="onBizToggle"
    />

    <RouteBar
      :state="routeState"
      :active="routeActive"
      :hint="routeHint"
      @toggle="onRouteToggle"
      @toggle-all="onRouteToggleAll"
      @clear="onRouteClear"
      @undo="onRouteUndo"
      @speed="onRouteSpeed"
      @focus="onRouteFocus"
      @new-route="onRouteNew"
      @select-route="onRouteSelect"
      @remove-route="onRouteRemove"
      @deselect="onRouteDeselect"
      @collapse="routeCollapsed = $event"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ThreeMap } from './map/ThreeMap.js'
import { getRegionMeta } from './data/regionMeta.js'
import InfoPanel from './components/InfoPanel.vue'
import Breadcrumb from './components/Breadcrumb.vue'
import RouteBar from './components/RouteBar.vue'
import { THEMES, resolveTheme } from './map/palette.js'
import DataImportPanel from './components/DataImportPanel.vue'
import RecordButton from './components/RecordButton.vue'
import MapFrame from './components/MapFrame.vue'
import MilitaryPanel from './components/MilitaryPanel.vue'
import MilitaryBar from './components/MilitaryBar.vue'
import BusinessBar from './components/BusinessBar.vue'
import { useBusinessDataStore } from './stores/businessDataStore.js'
import { useMilitaryStore } from './stores/militaryStore.js'

// 业务数据集（IndexedDB 持久化），装载后可在顶栏按钮看到已有数量
const store = useBusinessDataStore()
const showImport = ref(false)

// ---------- 业务数据：分级着色与明细 ----------
// store 的存取动作此前已全部实现，但导入后从未接回地图 / 面板，这里补齐这一环。
const businessOpen = ref(false)      // 业务面板是否显示
const businessField = ref('')        // 当前指标字段
const businessAgg = ref('sum')       // sum | avg | count
const businessActive = ref(false)    // 是否已上色
const businessLegend = ref(null)     // 图例（极值 / 色阶 / 字段）
const businessRecords = ref(null)    // 当前选中区域的业务明细，交给信息面板

const activeBizDs = computed(
  () => store.activeSets[0] || store.dataSets.find((d) => d.isActive) || null
)

/** 当前激活数据集的数值字段（指标下拉用） */
const businessNumericFields = computed(() =>
  (activeBizDs.value && activeBizDs.value.fields ? activeBizDs.value.fields : [])
    .filter((f) => f && f.type === 'number' && f.visible !== false)
    .map((f) => ({ key: f.key, label: f.label }))
)

async function onImported(ds) {
  showTownHint(`已导入「${ds.name}」，共 ${ds.recordCount} 条记录`)
  businessField.value = ''
  businessAgg.value = 'sum'
  await applyBusinessLayer()
  if (businessActive.value) businessOpen.value = true
}

/** 把当前激活数据集的指标聚合后染到地图上：业务数据真正上图的关键一步 */
async function applyBusinessLayer() {
  if (!map) return
  const ds = activeBizDs.value
  if (!ds) {
    map.clearBusinessLayer()
    businessActive.value = false
    businessLegend.value = null
    return
  }
  const recs = await store.allRecords(ds.id)
  const fieldKey =
    businessField.value || (businessNumericFields.value[0] && businessNumericFields.value[0].key)
  if (!fieldKey) {
    map.clearBusinessLayer()
    businessActive.value = false
    businessLegend.value = null
    showTownHint(`「${ds.name}」没有可用于着色的数值字段`)
    return
  }
  businessField.value = fieldKey
  const info = map.setBusinessLayer({
    datasetId: ds.id,
    fields: ds.fields,
    records: recs,
    fieldKey,
    aggregate: businessAgg.value
  })
  if (info) {
    businessActive.value = true
    businessLegend.value = map.businessLegend()
  } else {
    businessActive.value = false
    businessLegend.value = null
    showTownHint(`「${ds.name}」中「${fieldKey}」没有可聚合的数值`)
  }
}

/** 选中某区域时拉取其业务明细，交给信息面板展示 */
async function loadBusinessRecords(adcode) {
  const ds = activeBizDs.value
  if (!ds || !adcode) {
    businessRecords.value = null
    return
  }
  try {
    const recs = await store.recordsOf(ds.id, adcode)
    businessRecords.value =
      recs && recs.length ? { records: recs, fields: ds.fields, fieldKey: businessField.value } : null
  } catch (e) {
    businessRecords.value = null
  }
}

function onRegionSelect(feature) {
  selected.value = feature ? regionToPanel(feature) : null
  if (feature) loadBusinessRecords(String(feature.properties.adcode))
  else businessRecords.value = null
}

// BusinessBar 事件
function onBizSelectDataset(id) {
  store.setActive(id, true).then(applyBusinessLayer)
}
function onBizSelectField(key) {
  businessField.value = key
  applyBusinessLayer()
}
function onBizSetAgg(agg) {
  businessAgg.value = agg
  applyBusinessLayer()
}
function onBizToggle(on) {
  if (on) {
    applyBusinessLayer()
    return
  }
  if (map) map.clearBusinessLayer()
  businessActive.value = false
  businessLegend.value = null
}

// 军事要素（驻军 / 布防 / 行军路线…）：同样落在 IndexedDB，按数据集分年代存放
const milStore = useMilitaryStore()
const showMilImport = ref(false)
const milOpen = ref(false)
const milPicked = ref(null)

// 主题切换器：每项给出 3 个代表色用于按钮渐变预览
const themes = Object.fromEntries(
  Object.entries(THEMES).map(([k, t]) => {
    const pick = (spec, n) =>
      [0, 1, 2].map((i) => {
        const span = (spec.h1 - spec.h0) || 360
        const h = (spec.h0 + ((i * n * 137.508) % span)) % 360
        return `hsl(${h.toFixed(0)}, ${(spec.sat * 100).toFixed(0)}%, ${(spec.lit * 100).toFixed(0)}%)`
      })
    return [k, { label: t.label, swatch: pick(t.town, Math.max(3, Math.round(360 / 137.508))) }]
  })
)
const current = ref(resolveTheme())
// 纸质主题：界面外壳与图廓层都只在兵要地志下出现
const isPaper = computed(() => current.value === 'campaign')

// 兵要地志是纸质主题，界面外壳（面板/文字）也要一并换成纸墨配色，
// 否则深色毛玻璃压在宣纸底上不伦不类。切换主题会带参数重载，这里只管初始化。
if (isPaper.value) document.documentElement.classList.add('theme-paper')

// 图廓上的图名 / 层级：随面包屑变化（下钻、返回、进单镇都会重发面包屑）
// navTick 只是让 computed 在层级切换时重新求值，本身不参与显示
const navTick = ref(0)
const frameTitle = computed(() => {
  navTick.value
  const b = breadcrumb.value
  return b.length ? b[b.length - 1] : '中国'
})
const frameLevel = computed(() => {
  navTick.value
  if (!map) return '国家级'
  if (map.mode === 'village') return '村级 · 名录展示'
  if (map.mode === 'town') return '乡镇级'
  const d = breadcrumb.value.length - 1
  return ['国家级', '省级', '市级', '区县级'][d] || '行政区'
})

function pickTheme(key) {
  const url = new URL(window.location.href)
  url.searchParams.set('palette', key)
  window.location.href = url.toString() // 换主题需重建材质，直接带参数重载最稳妥
}

const stage = ref(null)
const container = ref(null)
const selected = ref(null)
const breadcrumb = ref(['中国'])
const townHint = ref('')
const townSource = ref('')
const isFullscreen = ref(false)
// 山系 / 水系图层的来源与要素数（地形晕渲、河流、湖泊），图廓图注要用
const geoNote = ref(null)
// 山系 / 水系全局显隐：状态本机记忆，关掉的图层不进图注，避免图注说一套、画面画一套
const geoOn = ref({ terrain: true, hydro: true })
const GEO_KEY = 'maps-dashboard:geo-on'
try {
  const saved = JSON.parse(localStorage.getItem(GEO_KEY) || 'null')
  if (saved && typeof saved === 'object') {
    geoOn.value = { terrain: saved.terrain !== false, hydro: saved.hydro !== false }
  }
} catch (e) {
  /* 隐私模式下不可读，按全部显示处理 */
}
// 地图初始化是否成功：WebGL 不可用时录制不可用，由这个开关关掉入口
const mapReady = ref(false)
// 录制进行中：给舞台挂 class，收起会干扰画面的控件
const isRecording = ref(false)
// 路径巡航状态：点击区域/乡镇追加路径点 → 管道生长 → 可沿管道巡航跟拍（支持多条路径）
const routeState = ref(null)
const routeActive = ref(-1)
const routeHint = ref('')
// 路径面板是否被折叠：折叠后只剩一条窄胶囊，底部操作提示要还回来
const routeCollapsed = ref(false)
// 名称立体显示开关：状态持久在本机，跨层级保持（全国看省名、进省看市名）
const namesOn = ref(false)
const nameCount = ref(0)
const NAMES_KEY = 'maps-dashboard:names-on'
let namesWanted = false
try {
  namesWanted = localStorage.getItem(NAMES_KEY) === '1'
} catch (e) {
  /* 隐私模式下不可读，按关闭处理 */
}
let routeTimer = null
let map = null
let hintTimer = null

// 是否正在编辑路径：以「是否选中了某条路径」为准。
// 县级/村级不默认选中，只要用户没在路径面板点选，单击地图就只是看信息。
const routeEditing = computed(() => !!(routeState.value && routeState.value.activeIndex >= 0))

const LEVEL_LABEL = {
  country: '国家级',
  province: '省级',
  city: '市级',
  district: '区县级'
}

function emptyMeta() {
  return { population: null, area: null, images: [], custom: {} }
}

function regionToPanel(feature) {
  const adcode = String(feature.properties.adcode)
  const meta = getRegionMeta(adcode) || emptyMeta()
  return {
    name: feature.properties.name,
    level: LEVEL_LABEL[feature.properties.level] || '行政区',
    meta
  }
}

function townToPanel(town) {
  const m = town.meta || {}
  const info = town.info || null
  return {
    name: town.name,
    level: town.level === '乡镇' ? '乡镇级' : '镇级',
    meta: {
      // 面板人口单位为万人，官方数据为「人」，此处换算
      population: town.population != null ? town.population / 10000 : null,
      area: town.area ?? null,
      images: town.images || [],
      // 透传行政区划信息（省 / 市 / 县 / 乡镇），面板渲染为「行政区划」区
      attrs: m.attrs || [],
      custom: {
        gdp: town.gdp || '',
        intro: town.intro || (info && info.intro) || '',
        tags: town.tags || []
      }
    },
    // 官方展示信息（人口 / 辖区面积 / 下辖村社区 / 联系方式…），由面板展开
    info
  }
}

// 通用 toast：直接展示传入文本，不包装话术（调用方各自负责文案）
function showTownHint(text) {
  townHint.value = text
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => (townHint.value = ''), 2800)
}

/** 乡镇视图整体为空（该县没有任何乡镇点位）：给出可操作的补录指引 */
function showTownEmptyHint(name) {
  showTownHint(`「${name}」暂无镇级点位数据，可在 public/geo/towns/ 补录对应 adcode 的 JSON`)
}

// ---------- 全屏 ----------
function fsElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}

function onFsChange() {
  isFullscreen.value = !!fsElement()
  // 尺寸由 ThreeMap 的 ResizeObserver 接管，这里再兜一次，避免某些浏览器漏发
  if (map) requestAnimationFrame(() => map.resize())
}

async function toggleFullscreen() {
  const el = stage.value
  if (!el) return
  try {
    if (fsElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen
      if (!exit) throw new Error('浏览器不支持退出全屏')
      await exit.call(document)
    } else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen
      if (!req) throw new Error('浏览器不支持全屏 API')
      await req.call(el)
    }
  } catch (e) {
    showTownHint(`全屏切换失败：${(e && e.message) || e}`)
  }
}

function onKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault()
    toggleFullscreen()
    return
  }
  // Esc：先退路径连线，再关信息面板 —— 每一层都能用手退出，不留死角
  if (e.key === 'Escape') {
    if (routeEditing.value) {
      e.preventDefault()
      onRouteDeselect()
    } else if (milPicked.value) {
      // 军事要素详情先退：它是最上层、最轻的一层
      e.preventDefault()
      milPicked.value = null
    } else if (selected.value) {
      e.preventDefault()
      closePanel()
    }
  }
}

function showRouteHint(text) {
  routeHint.value = text
  clearTimeout(routeTimer)
  routeTimer = setTimeout(() => (routeHint.value = ''), 2600)
}

function onRouteChange(state) {
  routeState.value = state
  if (!state.count) routeActive.value = -1
}

// 面板展开时占住左下角，底部提示条让位；折叠成窄胶囊后提示条还回来
const hasRoute = computed(
  () => !routeCollapsed.value && !!(routeState.value && routeState.value.paths && routeState.value.paths.length)
)

// ---------- 名称立体显示 ----------

/** 从地图同步名称层状态（换层级后标签会重建，可见性与数量都要跟着更新） */
function syncNames() {
  if (!map) return
  namesOn.value = map.namesVisible
  nameCount.value = map.nameCount
}

function onToggleNames() {
  if (!map) return
  const want = !namesOn.value
  const on = map.setNamesVisible(want)
  namesOn.value = on
  nameCount.value = map.nameCount
  namesWanted = on
  try {
    localStorage.setItem(NAMES_KEY, on ? '1' : '0')
  } catch (e) {
    /* 隐私模式下不可写，忽略 */
  }
  // 想开却没开成 = 本层没有可用的名称锚点，要明确告知而不是静默无反应
  if (want && !on) showTownHint('当前层级没有可显示的名称')
}

// ---------- 山系 / 水系显隐 ----------

function onToggleGeo(kind) {
  if (!map) return
  const want = !geoOn.value[kind]
  map.setGeoVisible(kind, want)
  geoOn.value = { ...geoOn.value, [kind]: want }
  try {
    localStorage.setItem(GEO_KEY, JSON.stringify(geoOn.value))
  } catch (e) {
    /* 隐私模式下不可写，忽略 */
  }
  showTownHint(want ? `已显示${kind === 'terrain' ? '山系' : '水系'}` : `已隐藏${kind === 'terrain' ? '山系' : '水系'}`)
}

// ---------- 军事要素 ----------

/** 当前显示在图上的军事要素按类型计数，交给图廓做图注（画面有什么才列什么） */
const milStats = computed(() => {
  const out = {}
  for (const f of milStore.renderFeatures) out[f.kind] = (out[f.kind] || 0) + 1
  return out
})

/** 顶栏「军事要素」：有导入数据就开管理面板，没有就直接进导入向导 */
function onMilitaryButton() {
  if (!milStore.sets.length) {
    showMilImport.value = true
    return
  }
  milOpen.value = !milOpen.value
}

/** 把 store 里过滤后的要素推给地图重建图层 */
function pushMilitary() {
  if (!map) return
  map.setMilitaryFeatures(milStore.renderFeatures)
  // 标注开关要跟着 store 走：图层每次重建都是从零搭起来的，
  // 不重设的话导入后只剩光秃秃的符号，名称标牌永远出不来
  map.setMilitaryLabels(milStore.sets.some((s) => s.visible !== false && s.labelOn !== false))
}

// 数据集显隐 / 时期 / 类型过滤一变就重画（要素量级通常几十到几百，重建成本可接受）
watch(() => milStore.renderFeatures, () => pushMilitary())

async function onMilImported({ name, features }) {
  const ds = await milStore.create({ name, features })
  if (!ds) {
    showTownHint(milStore.error || '军事要素导入失败')
    return
  }
  await milStore.ensureFeatures()
  pushMilitary()
  milOpen.value = true
  showTownHint(`已导入「${ds.name}」：${ds.featureCount} 个要素`)
}

async function onMilToggleSet(id, visible) {
  await milStore.setVisible(id, visible)
  pushMilitary()
}

async function onMilToggleLabel(id, on) {
  await milStore.setLabelOn(id, on)
  // 标注开关只影响名称标牌，不重建几何
  if (map) map.setMilitaryLabels(milStore.sets.some((s) => s.visible !== false && s.labelOn !== false))
}

async function onMilRemove(id) {
  await milStore.remove(id)
  pushMilitary()
}

function onMilEra(v) {
  milStore.setEraFilter(v)
  pushMilitary()
}

function onMilKind(key) {
  milStore.toggleKind(key)
  pushMilitary()
}

/** 点地图上的军标：展开详情；点了空白处则收起详情 */
function onMilPick(f) {
  milPicked.value = f || null
  if (f) milOpen.value = true
}

onMounted(async () => {
  // 全屏监听/快捷键必须先挂：地图初始化或首屏数据失败时也不能把 UI 控制一起拖垮
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  window.addEventListener('keydown', onKeydown)
  isFullscreen.value = !!fsElement()

  // 读取本机已导入的数据集；失败不影响地图本身，store 内部已记 error
  // 这里必须等装载完成，后面才能据此给已有数据集自动分级着色
  await store.load().catch(() => {})

  try {
    map = new ThreeMap(container.value, {
      onSelect: (feature) => onRegionSelect(feature),
      onSelectTown: (town) => {
        selected.value = town ? townToPanel(town) : null
      },
      // 军事要素：点击军标 / 路线看详情
      onMilitarySelect: (f) => {
        onMilPick(f)
      },
      onBreadcrumb: (names) => {
        breadcrumb.value = names
        navTick.value++ // 图廓的图名 / 层级跟着换
        // 换层级会重建名称标签，开关状态与数量要同步回 UI
        syncNames()
      },
      onTownEmpty: (name) => {
        showTownEmptyHint(name)
      },
      onLevelHint: (text) => {
        showTownHint(text)
      },
      // 山系 / 水系：把来源与要素数交给图廓，图注里要写清这些线是怎么来的
      onGeoChange: (s) => {
        geoNote.value = s
      },
      onTownInfo: (info) => {
        townSource.value = info && info.sources
          ? info.sources.map((s) => s.label).join('、')
          : ''
      },
      onRouteChange: (state, result) => {
        onRouteChange(state)
        if (!result) return
        if (result.added) {
          routeActive.value = result.index
          if (state.count >= 2) showRouteHint(`当前路径已 ${state.count} 点，点「巡航」沿管道跟拍`)
        } else {
          showRouteHint(`「${state.stops[result.index] && state.stops[result.index].name}」${result.reason}，未重复追加`)
        }
      }
    })
    await map.load('100000')
    mapReady.value = true
    // 调试出口：控制台里可直接操作地图实例做自动化验证与排障，不参与任何界面逻辑
    window.__map = map
    // 业务数据：库里已有激活的数据集就自动分级着色（异步，不阻塞首屏其余交互）
    if (store.activeSets.length) {
      try {
        await applyBusinessLayer()
        if (businessActive.value) businessOpen.value = true
      } catch (e) {
        console.error('[maps-dashboard] 业务数据上色失败', e)
      }
    }
    // 上次开着名称显示就恢复（下钻后由地图内部沿用同一开关状态）
    if (namesWanted) map.setNamesVisible(true)
    syncNames()
    // 山系 / 水系按本机记忆的开关初始化（默认全开）
    map.setGeoVisible('terrain', geoOn.value.terrain)
    map.setGeoVisible('hydro', geoOn.value.hydro)
    // 军事要素：库里已有的读完就画上（异步，不阻塞首屏）
    milStore
      .load()
      .then(async () => {
        await milStore.ensureFeatures()
        pushMilitary()
        if (map) map.setMilitaryLabels(milStore.sets.some((s) => s.visible !== false && s.labelOn !== false))
      })
      .catch(() => {})
  } catch (e) {
    // 例如浏览器/驱动不支持 WebGL：给出提示而不是留一块黑屏
    console.error('[maps-dashboard] 地图初始化失败', e)
    showTownHint(`地图初始化失败：${(e && e.message) || e}`)
  }
})

onBeforeUnmount(() => {
  clearTimeout(hintTimer)
  clearTimeout(routeTimer)
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('webkitfullscreenchange', onFsChange)
  window.removeEventListener('keydown', onKeydown)
  if (fsElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen
    if (exit) exit.call(document).catch(() => {})
  }
  if (map) map.dispose()
})

// ---------- 路径巡航操作 ----------
function onRouteToggle() {
  if (!map) return
  if (map.cruising) {
    map.stopCruise()
  } else if (routeState.value && routeState.value.activeIndex < 0) {
    showRouteHint('先点选一条路径（或点「＋」新建），再单击地图连线')
  } else if (!map.startCruise()) {
    showRouteHint('至少需要 2 个路径点才能巡航')
  }
  routeState.value = map.routeState()
}
function onRouteClear() {
  if (!map) return
  if (!map.clearRoute()) showRouteHint('先点选一条路径再清空')
}
function onRouteUndo() {
  if (!map) return
  if (!map.removeLastStop()) showRouteHint('当前路径没有可撤销的点')
}
function onRouteSpeed(v) {
  if (map) map.setCruiseSpeed(v)
}
function onRouteFocus(i) {
  routeActive.value = i
  if (map) map.focusRouteStop(i)
}

// ---------- 多条路径 ----------
function onRouteNew() {
  if (!map) return
  const s = map.routeState()
  // 已经有一条还没连点的空路径时不要重复堆：直接选中它，否则面板会冒出一串 0 点路径
  const empty = (s.paths || []).filter((p) => p.count === 0)
  if (empty.length) {
    map.selectRoute(empty[empty.length - 1].index)
    showRouteHint('已选中空白路径：依次单击区域即可连线')
  } else {
    map.newRoute()
    showRouteHint('已新建路径：依次单击区域即可连线，省 / 市 / 区县 / 乡镇都可以作为路径点')
  }
  routeState.value = map.routeState()
}

/** 取消路径选中：回到「单击只看信息」，路径与已连的点全部保留 */
function onRouteDeselect() {
  if (!map) return
  if (!map.clearRouteSelection()) {
    showRouteHint('当前没有选中的路径')
    return
  }
  routeState.value = map.routeState()
  routeActive.value = -1
  showTownHint('已取消路径选中：单击地图只看信息，路径与已连的点都保留')
}

/** 顶栏「路径」按钮：未连线 = 开工，已连线 = 收手，避免选中后退不出来 */
function onRouteButton() {
  if (routeEditing.value) {
    onRouteDeselect()
    return
  }
  const paths = (routeState.value && routeState.value.paths) || []
  // 已经有路线就接着最后一条连，不再凭空开一条空的（要新开用面板的「＋」）
  if (paths.length) {
    const last = paths[paths.length - 1]
    map.selectRoute(last.index)
    routeState.value = map.routeState()
    showTownHint(`已选中「${last.name}」：单击地图继续连线`)
    return
  }
  onRouteNew()
}
function onRouteSelect(i) {
  if (!map) return
  map.selectRoute(i)
  routeState.value = map.routeState()
}
function onRouteRemove(i) {
  if (!map) return
  map.removeRoute(i)
  routeState.value = map.routeState()
}
function onRouteToggleAll() {
  if (!map) return
  if (map.cruiseAll) {
    map.stopCruise()
  } else if (!map.startCruiseAll()) {
    showRouteHint('至少需要一条含 2 个点的路径')
  }
  routeState.value = map.routeState()
}

function onCrumb(i) {
  if (map) map.goToLevel(i)
}
function closePanel() {
  selected.value = null
  // 面板关掉后地图上的高亮/选中态也要一起清，否则板块还亮着却不知道选的是谁
  if (map) map.clearSelection()
}
</script>

<style scoped>
.stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.map {
  position: absolute;
  inset: 0;
}
.topbar {
  position: absolute;
  top: 22px;
  left: 28px;
  right: 28px;
  display: flex;
  align-items: center;
  gap: 22px;
  z-index: 10;
  pointer-events: none;
}
.title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--text-0);
  text-shadow: 0 0 20px rgba(56, 189, 248, 0.6);
  pointer-events: auto;
}
.topbar :deep(.crumb) {
  pointer-events: auto;
}
.palette {
  margin-left: auto;
  display: flex;
  gap: 8px;
  pointer-events: auto;
}
.swatch {
  cursor: pointer;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text-1);
  padding: 5px 12px 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  background: var(--panel-bg);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  transition: border-color 0.2s, color 0.2s;
}
.swatch::before {
  content: '';
  width: 22px;
  height: 10px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--c1), var(--c2), var(--c3));
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.4);
}
.swatch:hover {
  color: var(--text-0);
  border-color: var(--accent-2);
}
.swatch.active {
  color: var(--text-0);
  border-color: var(--accent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 35%, transparent);
}
.tools {
  display: flex;
  gap: 8px;
  pointer-events: auto;
}
.fsbtn {
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text-1);
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  background: var(--panel-bg);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: border-color 0.2s, color 0.2s;
}
.fsbtn:hover {
  color: var(--text-0);
  border-color: var(--accent-2);
}
.fsbtn.active {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 35%, transparent);
}
.fsbtn svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* 全屏时 body 的径向渐变不再生效，补在舞台自身上 */
.stage:fullscreen,
.stage:-webkit-full-screen {
  background: radial-gradient(circle at 50% 30%, var(--bg-1), var(--bg-0) 70%);
}
.hint {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--text-1);
  letter-spacing: 1px;
  padding: 6px 16px;
  border-radius: 999px;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  z-index: 10;
}
.toast {
  position: absolute;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 13px;
  color: #ffe2a8;
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(40, 28, 10, 0.7);
  border: 1px solid rgba(255, 200, 120, 0.35);
  z-index: 12;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
/* 录制期间淡出干扰画面的控件：主题色板、工具按钮、操作提示、浮层提示。
   淡出而非 v-if 移除，避免布局抖动让画面发生位移。 */
.stage.recording .tools,
.stage.recording .palette,
.stage.recording .hint,
.stage.recording .toast {
  opacity: 0;
  pointer-events: none;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
