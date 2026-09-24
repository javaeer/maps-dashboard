<template>
  <Transition name="slide">
    <div v-if="data" class="panel" :class="{ collapsed }">
      <div class="head">
        <button class="fold" :title="collapsed ? '展开信息面板' : '收起信息面板'" @click="toggle">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path :d="collapsed ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5'" />
          </svg>
        </button>
        <div class="heading">
          <h2 class="name">{{ name }}</h2>
          <div class="level">{{ levelLabel }}</div>
        </div>
        <button class="close" @click="$emit('close')">×</button>
      </div>

      <template v-if="!collapsed">
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

      <div class="section plain" v-if="introText">
        <div class="label">简介</div>
        <!-- 乡镇概况原文往往上千字，默认截断 4 行，避免面板直接撑满屏高 -->
        <p class="intro" :class="{ clamp: introClamped }">{{ introText }}</p>
        <button v-if="introLong" class="more" @click="introClamped = !introClamped">
          {{ introClamped ? '展开全文' : '收起' }}
        </button>
      </div>

      <div class="section plain" v-if="tags.length">
        <div class="label">标签</div>
        <div class="tags">
          <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
        </div>
      </div>

      <!-- 以下分区默认收起：内容长（下辖村名尤其占地方），按需展开避免面板撑满屏高 -->
      <!-- 人口结构 / 土地 -->
      <div class="sec" :class="{ open: open.detail }" v-if="info && detailRows.length">
        <button class="sech" @click="open.detail = !open.detail">
          <span class="set">人口与土地</span>
          <span class="badge">{{ detailRows.length }} 项</span>
          <svg class="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
        <div class="secb" v-show="open.detail">
          <div class="attrs">
            <div class="attr" v-for="(a, i) in detailRows" :key="i">
              <span class="ak">{{ a[0] }}</span>
              <span class="av">{{ a[1] }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 下辖行政村 / 社区 -->
      <div class="sec" :class="{ open: open.village }" v-if="info && (villages.length || communities.length)">
        <button class="sech" @click="open.village = !open.village">
          <span class="set">下辖村 / 社区</span>
          <span class="badge">{{ villages.length }} 村 · {{ communities.length }} 社区</span>
          <svg class="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
        <div class="secb" v-show="open.village">
          <div class="sub" v-if="villages.length">
            <div class="subk">行政村</div>
            <div class="chips">
              <span v-for="v in villages" :key="v" class="chip">{{ v }}</span>
            </div>
          </div>
          <div class="sub" v-if="communities.length">
            <div class="subk">社区</div>
            <div class="chips">
              <span v-for="c in communities" :key="c" class="chip alt">{{ c }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 地理与气候 -->
      <div class="sec" :class="{ open: open.geo }" v-if="info && geoRows.length">
        <button class="sech" @click="open.geo = !open.geo">
          <span class="set">地理与气候</span>
          <span class="badge">{{ geoRows.length }} 项</span>
          <svg class="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
        <div class="secb" v-show="open.geo">
          <div class="attrs">
            <div class="attr" v-for="(a, i) in geoRows" :key="i">
              <span class="ak">{{ a[0] }}</span>
              <span class="av">{{ a[1] }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 联系方式 -->
      <div class="sec" :class="{ open: open.contact }" v-if="info && contactRows.length">
        <button class="sech" @click="open.contact = !open.contact">
          <span class="set">政府信息公开</span>
          <span class="badge">{{ contactRows.length }} 项</span>
          <svg class="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
        <div class="secb" v-show="open.contact">
          <div class="attrs">
            <div class="attr" v-for="(a, i) in contactRows" :key="i">
              <span class="ak">{{ a[0] }}</span>
              <span class="av">{{ a[1] }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 行政区划 -->
      <div class="sec" :class="{ open: open.attr }" v-if="attrRows.length">
        <button class="sech" @click="open.attr = !open.attr">
          <span class="set">行政区划</span>
          <span class="badge">{{ attrRows.length }} 级</span>
          <svg class="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
        <div class="secb" v-show="open.attr">
          <div class="attrs">
            <div class="attr" v-for="(a, i) in attrRows" :key="i">
              <span class="ak">{{ a[0] }}</span>
              <span class="av">{{ a[1] }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 图片集合 -->
      <div class="sec" :class="{ open: open.gallery }" v-if="images.length">
        <button class="sech" @click="open.gallery = !open.gallery">
          <span class="set">图片集合</span>
          <span class="badge">{{ images.length }} 张</span>
          <svg class="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
        </button>
        <div class="secb" v-show="open.gallery">
          <ImageGallery :images="images" />
        </div>
      </div>

      <div class="source" v-if="info && info.profileUrl">
        <a :href="info.profileUrl" target="_blank" rel="noopener">查看官方乡镇概况 →</a>
      </div>
      <div class="source clamp2" v-if="sourceLabel" :title="sourceLabel">
        数据来源：{{ sourceLabel }}
      </div>
      </template>
    </div>
  </Transition>
</template>

<script setup>
import { computed, reactive, ref, onMounted } from 'vue'
import ImageGallery from './ImageGallery.vue'
import { formatPopulation, formatArea, formatNumber } from '../utils/format.js'

// data 为归一化结构：
//   { name, level, meta: { population(万人), area(km²), images, attrs, custom:{ gdp,intro,tags } }, info? }
// info 为官方展示信息（scripts/fetch-town-info.mjs 生成）：人口、辖区面积、下辖村社区、联系方式…
const props = defineProps({
  data: { type: Object, default: null },
  sourceLabel: { type: String, default: '' }
})
defineEmits(['close'])

const name = computed(() => (props.data ? props.data.name : ''))
const levelLabel = computed(() => (props.data ? props.data.level || '行政区' : ''))
const meta = computed(() => (props.data ? props.data.meta : null))
const info = computed(() => (props.data ? props.data.info : null))
const popText = computed(() => (meta.value ? formatPopulation(meta.value.population) : '—'))
const areaText = computed(() => (meta.value ? formatArea(meta.value.area) : '—'))
const images = computed(() => (meta.value ? meta.value.images || [] : []))
const tags = computed(() => (meta.value && meta.value.custom ? meta.value.custom.tags || [] : []))
const attrRows = computed(() => (meta.value && meta.value.attrs ? meta.value.attrs : []))
const villages = computed(() => (info.value ? info.value.villages || [] : []))
const communities = computed(() => (info.value ? info.value.communities || [] : []))

const wan = (mu) => (mu ? Number((mu / 10000).toFixed(2)) + ' 万亩' : null)

// 长内容分区按需展开（状态挂在组件实例上，切换乡镇不会重置，展开过就保持展开）
const open = reactive({ detail: false, village: false, geo: false, contact: false, attr: false, gallery: true })

// 简介默认截断；超过阈值才给「展开全文」
const introText = computed(() => {
  const c = meta.value && meta.value.custom
  return c ? c.intro || '' : ''
})
const introLong = computed(() => introText.value.length > 140)
const introClamped = ref(true)

// 整个面板收起为右侧小胶囊，状态记在本地
const KEY = 'maps-dashboard:info-collapsed'
const collapsed = ref(false)
function toggle() {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem(KEY, collapsed.value ? '1' : '0')
  } catch (e) {
    /* 隐私模式下不可写，忽略 */
  }
}
onMounted(() => {
  try {
    collapsed.value = localStorage.getItem(KEY) === '1'
  } catch (e) {
    /* 忽略 */
  }
})

const detailRows = computed(() => {
  const t = info.value
  if (!t) return []
  const rows = []
  const push = (k, v) => { if (v != null && v !== '') rows.push([k, v]) }
  push('户籍 / 总人口', t.population ? `${formatNumber(t.population)} 人` : null)
  push('户数', t.households ? `${formatNumber(t.households)} 户` : null)
  push('常住人口', t.permanentPopulation ? `${formatNumber(t.permanentPopulation)} 人` : null)
  push('城镇人口', t.urbanPopulation ? `${formatNumber(t.urbanPopulation)} 人` : null)
  push('农业人口', t.ruralPopulation ? `${formatNumber(t.ruralPopulation)} 人` : null)
  push('流动人口', t.floatingPopulation ? `${formatNumber(t.floatingPopulation)} 人` : null)
  push('辖区面积', t.areaKm2 ? `${formatNumber(t.areaKm2)} km²` : null)
  push('耕地面积', t.farmlandMu ? (wan(t.farmlandMu) + (t.farmlandSuspicious ? '（原文存疑）' : '')) : null)
  push('村民小组', t.villagerGroups ? `${t.villagerGroups} 个` : null)
  push('居民小组', t.residentGroups ? `${t.residentGroups} 个` : null)
  return rows
})

const geoRows = computed(() => {
  const t = info.value
  if (!t) return []
  const rows = []
  const push = (k, v) => { if (v != null && v !== '') rows.push([k, v]) }
  push('海拔', t.altitude)
  push('年降雨量', t.rainfall)
  push('年平均气温', t.temperature)
  push('无霜期', t.frostFreeDays)
  push('距县城', t.distanceToCountyKm != null ? `${t.distanceToCountyKm} km` : null)
  push('距县城（直线）', t.straightLineKm != null ? `${t.straightLineKm} km` : null)
  return rows
})

const contactRows = computed(() => {
  const t = info.value
  if (!t) return []
  const rows = []
  const push = (k, v) => { if (v != null && v !== '') rows.push([k, v]) }
  push('办公地址', t.govAddress)
  push('联系电话', t.phone)
  push('邮政编码', t.zipCode)
  push('电子邮箱', t.email)
  push('办公时间', t.officeHours)
  return rows
})
</script>

<style scoped>
.panel {
  position: absolute;
  top: 84px;
  right: 24px;
  width: 360px;
  max-height: calc(100% - 140px);
  overflow-y: auto;
  padding: 16px 18px;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 14px;
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45),
    inset 0 0 30px rgba(56, 189, 248, 0.06);
  z-index: 20;
  transition: padding 0.22s ease;
}
/* 收起态：右侧一条小胶囊，只留地名与展开箭头 */
.panel.collapsed {
  width: auto;
  max-width: 220px;
  padding: 8px 10px 8px 6px;
  overflow: visible;
}
.head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.heading {
  min-width: 0;
  flex: 1;
}
.fold {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
  margin-top: 3px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-1);
}
.fold:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-0);
}
.fold svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.close {
  flex: none;
  width: 24px;
  height: 24px;
  margin-top: 2px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: var(--text-0);
  font-size: 16px;
  line-height: 1;
}
.close:hover {
  background: rgba(255, 255, 255, 0.1);
}
.name {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 0 0 18px rgba(56, 189, 248, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel.collapsed .name {
  font-size: 15px;
}
.panel.collapsed .level {
  display: none;
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
  margin: 12px 0 10px;
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
  margin-top: 10px;
}
/* 可折叠分区 */
.sec {
  margin-top: 6px;
  border-radius: 10px;
  border: 1px solid rgba(56, 189, 248, 0.14);
  background: rgba(56, 189, 248, 0.04);
}
.sech {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text-1);
  font-size: 12px;
  text-align: left;
}
.sech:hover {
  color: var(--text-0);
}
.set {
  color: var(--accent);
  letter-spacing: 1px;
  font-weight: 600;
}
.badge {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.chev {
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.2s ease;
}
.sec.open .chev {
  transform: rotate(90deg);
}
.secb {
  padding: 0 10px 10px;
}
/* 村名 chips 数量多，展开后也限高滚动，不把面板撑到顶 */
.secb .chips {
  max-height: 148px;
  overflow-y: auto;
}
.label {
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 1px;
  margin-bottom: 6px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.count {
  font-size: 11px;
  color: var(--text-1);
  letter-spacing: 0;
}
.intro {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-1);
}
.intro.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.more {
  margin-top: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent-2);
  font-size: 12px;
}
.more:hover {
  text-decoration: underline;
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
  gap: 10px;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(56, 189, 248, 0.06);
  border: 1px solid rgba(56, 189, 248, 0.14);
}
.ak {
  color: var(--text-1);
  flex-shrink: 0;
}
.av {
  color: var(--text-0);
  font-weight: 600;
  text-align: right;
}
.sub {
  margin-top: 8px;
}
.subk {
  font-size: 11px;
  color: var(--text-1);
  margin-bottom: 5px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 6px;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.28);
  color: #86efac;
}
.chip.alt {
  background: rgba(167, 139, 250, 0.12);
  border-color: rgba(167, 139, 250, 0.3);
  color: #c4b5fd;
}
.source {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-1);
  line-height: 1.55;
}
.source.clamp2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.source a {
  color: var(--accent-2);
  text-decoration: none;
}
.source a:hover {
  text-decoration: underline;
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
