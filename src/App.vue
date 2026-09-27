<template>
  <div ref="stage" class="stage" :class="{ 'is-fs': isFullscreen, recording: isRecording }">
    <div ref="container" class="map"></div>

    <header class="topbar">
      <div class="title">中国 3D 地图可视化大屏</div>
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
        <!-- 路径：点开即新建一条巡航路线，此后单击区域 / 乡镇都追加为路径点 -->
        <button
          class="fsbtn"
          :class="{ active: routeEditing }"
          :title="routeEditing ? '正在编辑路径：依次单击区域即可连成路线' : '新建一条巡航路径（省 / 市 / 区县 / 乡镇均可连线）'"
          @click="onRouteNew"
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

    <div v-if="!hasRoute" class="hint">单击查看信息 · 双击下钻（区县→乡镇→村 / 社区）· 右键返回 · 「路径」把省 / 市 / 区县 / 乡镇连成巡航路线 · 「名称」显示本层地名 · F 键全屏</div>

    <transition name="fade">
      <div v-if="townHint" class="toast">{{ townHint }}</div>
    </transition>

    <InfoPanel :data="selected" :source-label="townSource" @close="closePanel" />

    <!-- 业务数据导入向导，由顶栏「导入数据」唤起 -->
    <DataImportPanel v-if="showImport" @close="showImport = false" @imported="onImported" />

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
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ThreeMap } from './map/ThreeMap.js'
import { getRegionMeta } from './data/regionMeta.js'
import InfoPanel from './components/InfoPanel.vue'
import Breadcrumb from './components/Breadcrumb.vue'
import RouteBar from './components/RouteBar.vue'
import { THEMES, resolveTheme } from './map/palette.js'
import DataImportPanel from './components/DataImportPanel.vue'
import RecordButton from './components/RecordButton.vue'
import { useBusinessDataStore } from './stores/businessDataStore.js'

// 业务数据集（IndexedDB 持久化），装载后可在顶栏按钮看到已有数量
const store = useBusinessDataStore()
const showImport = ref(false)

function onImported(ds) {
  showTownHint(`已导入「${ds.name}」，共 ${ds.recordCount} 条记录`)
}

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
// 地图初始化是否成功：WebGL 不可用时录制不可用，由这个开关关掉入口
const mapReady = ref(false)
// 录制进行中：给舞台挂 class，收起会干扰画面的控件
const isRecording = ref(false)
// 路径巡航状态：点击区域/乡镇追加路径点 → 管道生长 → 可沿管道巡航跟拍（支持多条路径）
const routeState = ref(null)
const routeActive = ref(-1)
const routeHint = ref('')
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

// 面板一旦出现就占住左下角，底部提示条要让位（哪怕当前没有选中任何路径）
const hasRoute = computed(() => !!(routeState.value && routeState.value.paths && routeState.value.paths.length))

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

onMounted(async () => {
  // 全屏监听/快捷键必须先挂：地图初始化或首屏数据失败时也不能把 UI 控制一起拖垮
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  window.addEventListener('keydown', onKeydown)
  isFullscreen.value = !!fsElement()

  // 读取本机已导入的数据集；失败不影响地图本身，store 内部已记 error
  store.load().catch(() => {})

  try {
    map = new ThreeMap(container.value, {
      onSelect: (feature) => {
        selected.value = feature ? regionToPanel(feature) : null
      },
      onSelectTown: (town) => {
        selected.value = town ? townToPanel(town) : null
      },
      onBreadcrumb: (names) => {
        breadcrumb.value = names
        // 换层级会重建名称标签，开关状态与数量要同步回 UI
        syncNames()
      },
      onTownEmpty: (name) => {
        showTownEmptyHint(name)
      },
      onLevelHint: (text) => {
        showTownHint(text)
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
    // 上次开着名称显示就恢复（下钻后由地图内部沿用同一开关状态）
    if (namesWanted) map.setNamesVisible(true)
    syncNames()
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
  map.newRoute()
  routeState.value = map.routeState()
  showRouteHint('已新建路径：依次单击区域即可连线，省 / 市 / 区县 / 乡镇都可以作为路径点')
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
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: rgba(10, 20, 38, 0.55);
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
  border-color: rgba(120, 200, 255, 0.5);
}
.swatch.active {
  color: #fff;
  border-color: var(--accent-2);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.35);
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
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: rgba(10, 20, 38, 0.55);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: border-color 0.2s, color 0.2s;
}
.fsbtn:hover {
  color: var(--text-0);
  border-color: rgba(120, 200, 255, 0.5);
}
.fsbtn.active {
  color: #fff;
  border-color: var(--accent-2);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.35);
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
  background: rgba(10, 20, 38, 0.6);
  border: 1px solid rgba(56, 189, 248, 0.2);
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
