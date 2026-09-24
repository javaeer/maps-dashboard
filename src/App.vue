<template>
  <div ref="stage" class="stage" :class="{ 'is-fs': isFullscreen }">
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
    </header>

    <div v-if="!hasRoute" class="hint">单击区域查看信息 · 双击下钻 · 右键返回 · 双击区县查看乡镇 · 进乡镇后依次单击即连成路径 · F 键全屏</div>

    <transition name="fade">
      <div v-if="townHint" class="toast">{{ townHint }}</div>
    </transition>

    <InfoPanel :data="selected" :source-label="townSource" @close="closePanel" />

    <RouteBar
      :state="routeState"
      :active="routeActive"
      :hint="routeHint"
      @toggle="onRouteToggle"
      @clear="onRouteClear"
      @undo="onRouteUndo"
      @speed="onRouteSpeed"
      @focus="onRouteFocus"
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
// 路径巡航状态：点击乡镇追加路径点 → 管道生长 → 可沿管道巡航跟拍
const routeState = ref(null)
const routeActive = ref(-1)
const routeHint = ref('')
let routeTimer = null
let map = null
let hintTimer = null

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

function showTownHint(name) {
  townHint.value = `「${name}」暂无镇级点位数据，可在 public/geo/towns/ 补录对应 adcode 的 JSON`
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => (townHint.value = ''), 2800)
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

// 有路径时让出底部提示条：控制条已挪到左下角，二者不再抢同一块地
const hasRoute = computed(() => !!(routeState.value && routeState.value.count))

onMounted(async () => {
  // 全屏监听/快捷键必须先挂：地图初始化或首屏数据失败时也不能把 UI 控制一起拖垮
  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  window.addEventListener('keydown', onKeydown)
  isFullscreen.value = !!fsElement()

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
      },
      onTownEmpty: (name) => {
        showTownHint(name)
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
          if (state.count >= 2) showRouteHint(`已连成 ${state.count} 点路径，点「巡航」沿管道跟拍`)
        } else {
          showRouteHint(`「${state.stops[result.index] && state.stops[result.index].name}」${result.reason}，未重复追加`)
        }
      }
    })
    await map.load('100000')
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
  } else if (!map.startCruise()) {
    showRouteHint('至少需要 2 个路径点才能巡航')
  }
  routeState.value = map.routeState()
}
function onRouteClear() {
  if (map) map.clearRoute()
}
function onRouteUndo() {
  if (map) map.removeLastStop()
}
function onRouteSpeed(v) {
  if (map) map.setCruiseSpeed(v)
}
function onRouteFocus(i) {
  routeActive.value = i
  if (map) map.focusRouteStop(i)
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
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
