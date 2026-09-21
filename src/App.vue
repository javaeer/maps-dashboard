<template>
  <div class="stage">
    <div ref="container" class="map"></div>

    <header class="topbar">
      <div class="title">中国 3D 地图可视化大屏</div>
      <Breadcrumb :items="breadcrumb" @select="onCrumb" />
    </header>

    <div class="hint">单击区域查看信息 · 双击下钻 · 右键返回 · 双击区县查看乡镇</div>

    <transition name="fade">
      <div v-if="townHint" class="toast">{{ townHint }}</div>
    </transition>

    <InfoPanel :data="selected" @close="closePanel" />
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ThreeMap } from './map/ThreeMap.js'
import { getRegionMeta } from './data/regionMeta.js'
import InfoPanel from './components/InfoPanel.vue'
import Breadcrumb from './components/Breadcrumb.vue'

const container = ref(null)
const selected = ref(null)
const breadcrumb = ref(['中国'])
const townHint = ref('')
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
  return {
    name: town.name,
    level: town.level === '乡镇' ? '乡镇级' : '镇级',
    meta: {
      population: town.population ?? null,
      area: town.area ?? null,
      images: town.images || [],
      // 透传行政区划信息（省 / 市 / 县 / 乡镇），面板渲染为「行政区划」区
      attrs: m.attrs || [],
      custom: {
        gdp: town.gdp || '',
        intro: town.intro || '',
        tags: town.tags || []
      }
    }
  }
}

function showTownHint(name) {
  townHint.value = `「${name}」暂无镇级点位数据，可在 public/geo/towns/ 补录对应 adcode 的 JSON`
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => (townHint.value = ''), 2800)
}

onMounted(async () => {
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
    }
  })
  await map.load('100000')
})

onBeforeUnmount(() => {
  clearTimeout(hintTimer)
  if (map) map.dispose()
})

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
