<template>
  <div class="stage">
    <div ref="container" class="map"></div>

    <header class="topbar">
      <div class="title">中国 3D 地图可视化大屏</div>
      <Breadcrumb :items="breadcrumb" @select="onCrumb" />
    </header>

    <div class="hint">单击区域查看信息 · 双击下钻 · 右键返回上级</div>

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
let map = null

onMounted(async () => {
  map = new ThreeMap(container.value, {
    onSelect: (feature) => {
      if (!feature) {
        selected.value = null
        return
      }
      const adcode = String(feature.properties.adcode)
      const meta = getRegionMeta(adcode)
      selected.value = { feature, meta }
    },
    onBreadcrumb: (names) => {
      breadcrumb.value = names
    }
  })
  await map.load('100000')
})

onBeforeUnmount(() => {
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
</style>
