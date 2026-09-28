<template>
  <div class="mapframe" aria-hidden="true">
    <!-- 做旧：纸纤维噪点 → 折痕 → 四角暗角，叠在画布之上但吃不到点击 -->
    <div class="grain"></div>
    <div class="crease crease-v"></div>
    <div class="crease crease-h"></div>
    <div class="vignette"></div>

    <!-- 内外图廓：外粗内细，中间一条留白带画经纬分度划 -->
    <div class="frame-outer"></div>
    <div class="frame-inner"></div>
    <div class="ticks ticks-t"></div>
    <div class="ticks ticks-b"></div>
    <div class="ticks ticks-l"></div>
    <div class="ticks ticks-r"></div>

    <!-- 图名条（左上） -->
    <div class="title-plate">
      <div class="t-main">{{ title }}<span class="t-kind">兵要地志图</span></div>
      <div class="t-sub">{{ levelLabel }}</div>
      <div class="t-note">底图：民政部行政区划 / DataV.GeoAtlas</div>
      <div v-if="terrainNote" class="t-note">地形：{{ terrainNote }}</div>
      <div v-if="hydroNote" class="t-note">水系：{{ hydroNote }}</div>
      <!-- 军事要素没有"公开底图"这一说，来源必须写明是导入数据 -->
      <div v-if="milNote" class="t-note">军事要素：{{ milNote }}</div>
    </div>

    <!-- 指北针（右上） -->
    <svg class="compass" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="27" class="c-ring" />
      <circle cx="32" cy="32" r="23" class="c-ring thin" />
      <path d="M32 6 L38 32 L32 27 L26 32 Z" class="c-north" />
      <path d="M32 58 L26 32 L32 37 L38 32 Z" class="c-south" />
      <circle cx="32" cy="32" r="3" class="c-dot" />
      <text x="32" y="20" class="c-char">北</text>
    </svg>

    <!-- 比例尺（底部居中）：按当前视图真实换算，缩放后跟着变 -->
    <div v-if="bar" class="scale">
      <div class="s-bar" :style="{ width: bar.px + 'px' }">
        <i v-for="n in 4" :key="n" :class="{ on: n % 2 === 1 }"></i>
      </div>
      <div class="s-ticks" :style="{ width: bar.px + 'px' }">
        <span>0</span>
        <span>{{ fmt(bar.km / 2) }}</span>
        <span>{{ fmt(bar.km) }} 公里</span>
      </div>
      <div class="s-note">约合 {{ fmt(bar.km * 2) }} 市里（1 市里 = 500 米）</div>
    </div>

    <!-- 图注 / 图例 + 钤印（右下） -->
    <div class="legend">
      <div class="lg-title">图　注</div>
      <div v-for="it in allLegend" :key="it.label" class="lg-item">
        <svg viewBox="0 0 34 12" class="lg-mark">
          <template v-if="it.kind === 'line'">
            <line x1="2" y1="6" x2="32" y2="6" :style="{ stroke: it.color, strokeWidth: it.width }" />
          </template>
          <template v-else-if="it.kind === 'dash'">
            <line x1="2" y1="6" x2="32" y2="6" :style="{ stroke: it.color, strokeWidth: 1.4, strokeDasharray: '4 3' }" />
          </template>
          <template v-else-if="it.kind === 'arrow'">
            <line x1="2" y1="6" x2="22" y2="6" :style="{ stroke: it.color, strokeWidth: 2 }" />
            <path d="M21 2 L30 6 L21 10 Z" :style="{ fill: it.color }" />
          </template>
          <template v-else-if="it.kind === 'dot'">
            <circle cx="17" cy="6" r="3.4" :style="{ fill: it.color }" />
          </template>
          <template v-else-if="it.kind === 'grid'">
            <path d="M2 3 H32 M2 9 H32 M9 2 V11 M24 2 V11" :style="{ stroke: it.color, strokeWidth: 1, fill: 'none' }" />
          </template>
          <!-- 双线河：两条平行细线，中间留白 -->
          <template v-else-if="it.kind === 'double'">
            <line x1="2" y1="4" x2="32" y2="4" :style="{ stroke: it.color, strokeWidth: 1.2 }" />
            <line x1="2" y1="9" x2="32" y2="9" :style="{ stroke: it.color, strokeWidth: 1.2 }" />
          </template>
          <!-- 湖泊水域：淡色块 + 墨色岸线 -->
          <template v-else-if="it.kind === 'lake'">
            <path d="M4 8 Q10 2 18 4 Q28 5 31 8 Q26 12 16 11 Q7 11 4 8 Z"
                  :style="{ fill: it.color, fillOpacity: 0.35, stroke: '#2b2b28', strokeWidth: 1 }" />
          </template>
          <!-- 山形晕渲：皴法三角 -->
          <template v-else-if="it.kind === 'shade'">
            <path d="M3 10 L11 4 L15 7 L19 3 L29 10 Z"
                  :style="{ fill: it.color, fillOpacity: 0.4, stroke: '#2b2b28', strokeWidth: 1.1 }" />
          </template>
          <!-- 军事要素：旗标符号（与地图上的驻军符号同一套语言） -->
          <template v-else-if="it.kind === 'mil'">
            <line x1="10" y1="2" x2="10" y2="11" :style="{ stroke: '#2b2b28', strokeWidth: 1.4 }" />
            <path d="M10 2 L24 5 L10 8 Z" :style="{ fill: it.color, stroke: '#2b2b28', strokeWidth: 1 }" />
          </template>
        </svg>
        <span>{{ it.label }}</span>
      </div>

      <!-- 钤印：朱砂方印，压在图注右下角 -->
      <svg class="seal" viewBox="0 0 100 100">
        <defs>
          <filter id="sealRough">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <g filter="url(#sealRough)">
          <rect x="6" y="6" width="88" height="88" rx="6" class="s-box" />
          <text x="29" y="42" class="s-char">会</text>
          <text x="71" y="42" class="s-char">师</text>
          <text x="29" y="80" class="s-char">门</text>
          <text x="71" y="80" class="s-char">下</text>
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { milKind } from '../utils/militarySchema.js'

const props = defineProps({
  // 当前区域名（面包屑末级），随下钻变化
  title: { type: String, default: '中国' },
  // 层级说明，如「省级」「乡镇级」
  levelLabel: { type: String, default: '国家级' },
  // 取当前视图「1 像素 ≈ 多少公里」，由地图实例实时提供；返回 null 表示暂不可算
  getKmPerPx: { type: Function, default: () => null },
  // 山系 / 水系图层的来源与要素数；没有就是本层不画真实地理要素
  geo: { type: Object, default: null },
  // 当前显示的军事要素统计（按类型计数），图注只列画面上真的画了的那些
  milStats: { type: Object, default: null }
})

// 图注条目与画面实际画法一一对应，不写画面上没有的东西
const legendItems = [
  { kind: 'line', label: '行政区界', color: '#2b2b28', width: 2 },
  { kind: 'dash', label: '乡镇界', color: '#3a3a35', width: 1 },
  { kind: 'arrow', label: '兵锋线（路线）', color: '#a83232' },
  { kind: 'dot', label: '要地标注', color: '#a83232' },
  { kind: 'grid', label: '计里画方', color: '#a89468' }
]

// 真实地理要素的图注：本层真的画了才列出来，避免图注说谎。
// 山系 / 水系被用户关掉后（terrainOn / hydroOn 为 false）也必须从图注里撤掉——
// 图注写了但画面没有，比不写更坏。
const allLegend = computed(() => {
  const g = props.geo
  if (!g) return legendItems
  const out = legendItems.slice()
  if (g.hydroOn !== false) {
    if (g.rivers) out.push({ kind: 'double', label: `河川（${g.rivers} 条）`, color: '#2f4858' })
    if (g.lakes) out.push({ kind: 'lake', label: `湖泊 / 水库（${g.lakes}）`, color: '#2f4858' })
  }
  if (g.terrainOn !== false && g.terrain) {
    out.push({ kind: 'shade', label: '山形晕渲', color: '#6b5a3c' })
  }
  // 军事要素：按类型各列一条，写明是导入数据
  const ms = props.milStats
  if (ms) {
    for (const [key, n] of Object.entries(ms)) {
      const k = milKind(key)
      if (!n || k.key === 'unknown') continue
      out.push({ kind: 'mil', label: `${k.label}（${n}，导入）`, color: k.color })
    }
  }
  return out
})

// 来源注：原文较长，这里压缩成图廓放得下的短名，但不改数据来源本身
function shorten(s, fallback) {
  if (!s) return fallback
  if (s.includes('Natural Earth')) return 'Natural Earth 10m（公有领域）'
  if (s.includes('OpenStreetMap')) return 'OpenStreetMap（ODbL）'
  if (s.includes('Terrain Tiles') || s.includes('SRTM')) return 'SRTM / GMTED 公开高程'
  return s
}
const terrainNote = computed(() => shorten(props.geo && props.geo.terrain, ''))
const hydroNote = computed(() => {
  const g = props.geo
  if (!g || !g.hydro || !g.hydro.length) return ''
  return g.hydro.map((s) => shorten(s, s)).join(' + ')
})
// 军事要素：只写"来源为导入"，不写任何具体史实（图可以有风格，来源不能含糊）
const milNote = computed(() => {
  const ms = props.milStats
  if (!ms) return ''
  const n = Object.values(ms).reduce((a, b) => a + b, 0)
  return n ? `导入数据（${n} 个要素）` : ''
})

// 比例尺取整档：先挑长度落在 60~170px 的那一档，都不合适就取最接近 110px 的
const STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
const bar = ref(null)

function fmt(n) {
  // 小数位控制在 1 位以内，且去掉多余的 .0
  const v = Math.round(n * 10) / 10
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function pickBar(kmPerPx) {
  if (!(kmPerPx > 0)) return null
  let best = null
  let bestErr = Infinity
  for (const km of STEPS) {
    const px = km / kmPerPx
    if (px >= 60 && px <= 170) return { km, px: Math.round(px) }
    const err = Math.abs(px - 110)
    if (err < bestErr) {
      bestErr = err
      best = { km, px: Math.round(px) }
    }
  }
  // 极端缩放下长度会失控，夹在可读区间里，宁可不准也不能横穿整屏
  return best ? { km: best.km, px: Math.max(48, Math.min(220, best.px)) } : null
}

let timer = null
function tick() {
  try {
    bar.value = pickBar(props.getKmPerPx())
  } catch (e) {
    bar.value = null
  }
}

onMounted(() => {
  tick()
  // 相机会随时缩放平移，按 4Hz 刷新足够跟手，又不至于每帧重排
  timer = setInterval(tick, 250)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.mapframe {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  font-family: 'Songti SC', 'STSong', 'SimSun', 'Noto Serif CJK SC', serif;
  color: #2b2b28;
}

/* ---------- 做旧 ---------- */
.grain {
  position: absolute;
  inset: 0;
  opacity: 0.075;
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
}
/* 折痕：一道亮边 + 一道暗边，模拟纸被对折后纤维的受光 */
.crease {
  position: absolute;
  opacity: 0.5;
  filter: blur(0.6px);
}
.crease-v {
  top: 0;
  bottom: 0;
  left: 38%;
  width: 3px;
  background: linear-gradient(
    90deg,
    rgba(255, 252, 240, 0) 0%,
    rgba(255, 252, 240, 0.55) 40%,
    rgba(120, 96, 60, 0.28) 70%,
    rgba(255, 252, 240, 0) 100%
  );
}
.crease-h {
  left: 0;
  right: 0;
  top: 63%;
  height: 3px;
  background: linear-gradient(
    180deg,
    rgba(255, 252, 240, 0) 0%,
    rgba(255, 252, 240, 0.5) 40%,
    rgba(120, 96, 60, 0.26) 70%,
    rgba(255, 252, 240, 0) 100%
  );
}
.vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 50% 48%,
    rgba(120, 95, 55, 0) 52%,
    rgba(120, 95, 55, 0.1) 78%,
    rgba(96, 74, 40, 0.24) 100%
  );
}

/* ---------- 图廓 ---------- */
.frame-outer {
  position: absolute;
  inset: 12px;
  border: 2.4px solid #2b2b28;
}
.frame-inner {
  position: absolute;
  inset: 26px;
  border: 1px solid rgba(43, 43, 40, 0.7);
}
/* 图廓间的分度划：每 22px 一道短划，视觉上就是经纬分度带 */
.ticks {
  position: absolute;
  opacity: 0.75;
}
.ticks-t {
  top: 13px;
  left: 27px;
  right: 27px;
  height: 11px;
  background: repeating-linear-gradient(90deg, #2b2b28 0 1px, transparent 1px 22px);
}
.ticks-b {
  bottom: 13px;
  left: 27px;
  right: 27px;
  height: 11px;
  background: repeating-linear-gradient(90deg, #2b2b28 0 1px, transparent 1px 22px);
}
.ticks-l {
  left: 13px;
  top: 27px;
  bottom: 27px;
  width: 11px;
  background: repeating-linear-gradient(180deg, #2b2b28 0 1px, transparent 1px 22px);
}
.ticks-r {
  right: 13px;
  top: 27px;
  bottom: 27px;
  width: 11px;
  background: repeating-linear-gradient(180deg, #2b2b28 0 1px, transparent 1px 22px);
}

/* ---------- 图名条 ---------- */
.title-plate {
  position: absolute;
  /* 顶栏底边约在 62px，图名条必须落在其下，否则两块文字叠在一起 */
  top: 76px;
  left: 46px;
  padding: 10px 16px 9px;
  background: rgba(253, 247, 230, 0.82);
  border: 1px solid rgba(43, 43, 40, 0.55);
  box-shadow: 2px 3px 0 rgba(43, 43, 40, 0.12);
}
.t-main {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 3px;
  line-height: 1.2;
}
.t-kind {
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 2px;
  margin-left: 10px;
  padding-left: 10px;
  border-left: 1px solid rgba(43, 43, 40, 0.4);
  color: #5c5344;
}
.t-sub {
  margin-top: 4px;
  font-size: 12px;
  letter-spacing: 2px;
  color: #5c5344;
}
.t-note {
  margin-top: 2px;
  font-size: 10px;
  letter-spacing: 0.6px;
  color: #6d6350;
}

/* ---------- 指北针 ---------- */
.compass {
  position: absolute;
  top: 74px;
  right: 46px;
  width: 66px;
  height: 66px;
}
.c-ring {
  fill: rgba(253, 247, 230, 0.55);
  stroke: #2b2b28;
  stroke-width: 1.6;
}
.c-ring.thin {
  fill: none;
  stroke-width: 0.7;
  opacity: 0.7;
}
.c-north {
  fill: #a83232;
}
.c-south {
  fill: #2b2b28;
}
.c-dot {
  fill: #fdf7e6;
  stroke: #2b2b28;
  stroke-width: 1;
}
.c-char {
  font-family: 'Songti SC', 'STSong', serif;
  font-size: 9px;
  fill: #2b2b28;
  text-anchor: middle;
}

/* ---------- 比例尺 ---------- */
.scale {
  position: absolute;
  /* 底部中央，但要让开下方那条操作提示（bottom 18 + 约 30 高） */
  bottom: 54px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
}
.s-bar {
  display: flex;
  height: 8px;
  border: 1px solid #2b2b28;
}
.s-bar i {
  flex: 1;
  background: transparent;
}
.s-bar i.on {
  background: #2b2b28;
}
.s-ticks {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
  font-size: 10.5px;
  letter-spacing: 0.5px;
}
.s-note {
  margin-top: 2px;
  font-size: 10px;
  color: #6d6350;
  letter-spacing: 0.5px;
}

/* ---------- 图注 + 钤印 ---------- */
.legend {
  position: absolute;
  right: 46px;
  bottom: 40px;
  min-width: 150px;
  padding: 12px 16px 14px;
  background: rgba(253, 247, 230, 0.82);
  border: 1px solid rgba(43, 43, 40, 0.55);
  box-shadow: 2px 3px 0 rgba(43, 43, 40, 0.12);
}
.lg-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 4px;
  margin-bottom: 7px;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(43, 43, 40, 0.3);
}
.lg-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.9;
  color: #3a3a35;
}
.lg-mark {
  width: 34px;
  height: 12px;
  flex: none;
}
.seal {
  position: absolute;
  right: 8px;
  bottom: -18px;
  width: 62px;
  height: 62px;
  transform: rotate(-5deg);
  opacity: 0.82;
}
.s-box {
  fill: none;
  stroke: #a83232;
  stroke-width: 5;
}
.s-char {
  font-family: 'Songti SC', 'STSong', 'SimSun', serif;
  font-size: 34px;
  font-weight: 700;
  fill: #a83232;
  text-anchor: middle;
}
</style>
