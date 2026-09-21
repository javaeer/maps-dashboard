<template>
  <Transition name="slide">
    <div v-if="data" class="panel">
      <button class="close" @click="$emit('close')">×</button>

      <h2 class="name">{{ name }}</h2>
      <div class="level">{{ levelLabel }}</div>

      <div class="stats">
        <div class="stat">
          <div class="k">人口</div>
          <div class="v">{{ popText }}</div>
        </div>
        <div class="stat">
          <div class="k">土地面积</div>
          <div class="v">{{ areaText }}</div>
        </div>
        <div class="stat" v-if="meta && meta.custom && meta.custom.gdp">
          <div class="k">GDP</div>
          <div class="v small">{{ meta.custom.gdp }}</div>
        </div>
      </div>

      <div class="section" v-if="meta && meta.custom && meta.custom.intro">
        <div class="label">简介</div>
        <p class="intro">{{ meta.custom.intro }}</p>
      </div>

      <div class="section" v-if="tags.length">
        <div class="label">标签</div>
        <div class="tags">
          <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
        </div>
      </div>

      <div class="section" v-if="attrRows.length">
        <div class="label">行政区划</div>
        <div class="attrs">
          <div class="attr" v-for="(a, i) in attrRows" :key="i">
            <span class="ak">{{ a[0] }}</span>
            <span class="av">{{ a[1] }}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="label">图片集合</div>
        <ImageGallery :images="images" />
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue'
import ImageGallery from './ImageGallery.vue'
import { formatPopulation, formatArea } from '../utils/format.js'

// data 为归一化结构：{ name, level, meta: { population, area, images, custom: { gdp, intro, tags } } }
const props = defineProps({
  data: { type: Object, default: null }
})
defineEmits(['close'])

const name = computed(() => (props.data ? props.data.name : ''))
const levelLabel = computed(() => (props.data ? props.data.level || '行政区' : ''))
const meta = computed(() => (props.data ? props.data.meta : null))
const popText = computed(() => (meta.value ? formatPopulation(meta.value.population) : '—'))
const areaText = computed(() => (meta.value ? formatArea(meta.value.area) : '—'))
const images = computed(() => (meta.value ? meta.value.images || [] : []))
const tags = computed(() => (meta.value && meta.value.custom ? meta.value.custom.tags || [] : []))
const attrRows = computed(() => (meta.value && meta.value.attrs ? meta.value.attrs : []))
</script>

<style scoped>
.panel {
  position: absolute;
  top: 84px;
  right: 24px;
  width: 360px;
  max-height: calc(100% - 140px);
  overflow-y: auto;
  padding: 20px 22px;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45),
    inset 0 0 30px rgba(56, 189, 248, 0.06);
  z-index: 20;
}
.close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: var(--text-0);
  font-size: 18px;
  line-height: 1;
}
.close:hover {
  background: rgba(255, 255, 255, 0.1);
}
.name {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 0 0 18px rgba(56, 189, 248, 0.55);
}
.level {
  margin-top: 4px;
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 2px;
}
.stats {
  display: flex;
  gap: 10px;
  margin: 18px 0;
}
.stat {
  flex: 1;
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.18);
  border-radius: 10px;
  padding: 10px 12px;
}
.k {
  font-size: 12px;
  color: var(--text-1);
}
.v {
  margin-top: 4px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-0);
}
.v.small {
  font-size: 13px;
  font-weight: 600;
}
.section {
  margin-top: 16px;
}
.label {
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 1px;
  margin-bottom: 6px;
}
.intro {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-1);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.12);
  border: 1px solid rgba(34, 211, 238, 0.3);
  color: var(--accent-2);
}
.attrs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.attr {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(56, 189, 248, 0.06);
  border: 1px solid rgba(56, 189, 248, 0.14);
}
.ak {
  color: var(--text-1);
}
.av {
  color: var(--text-0);
  font-weight: 600;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.35s ease, opacity 0.35s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(120%);
  opacity: 0;
}
</style>
