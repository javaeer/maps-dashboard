<template>
  <div class="bizbar" :class="{ paper }">
    <div class="head">
      <span class="title">业务数据</span>
      <span class="meta">{{ legend ? `${legend.count} 个区域着色` : (datasets.length ? `${datasets.length} 个数据集` : '未导入') }}</span>
      <div class="hops">
        <button class="mini" title="导入业务数据（CSV / Excel）" @click="$emit('import')">导入</button>
        <button class="mini" :class="{ on: !collapsed }" title="展开 / 收起" @click="toggle">{{ collapsed ? '展开' : '收起' }}</button>
        <button class="mini" title="关闭面板" @click="$emit('close')">×</button>
      </div>
    </div>

    <template v-if="!collapsed">
      <div v-if="!datasets.length" class="empty">
        还没有业务数据。点「导入」上传 CSV / Excel，按 adcode 关联行政区即可分级着色。
        <p class="sub">导入后地图会自动按所选指标给区域染色，并在点击区域时列出明细。</p>
      </div>

      <template v-else>
        <!-- 数据集切换（当前为单一激活模型，后续扩展多数据集并行） -->
        <div class="row">
          <span class="lb">数据集</span>
          <select :value="activeDs && activeDs.id" @change="$emit('select-dataset', $event.target.value)">
            <option v-for="d in datasets" :key="d.id" :value="d.id">{{ d.name }}</option>
          </select>
        </div>

        <div v-if="!numericFields.length" class="warn">该数据集没有可用于着色的数值字段（指标列需为数字类型）。</div>

        <template v-else>
          <div class="row">
            <span class="lb">指标</span>
            <select :value="fieldKey" @change="$emit('select-field', $event.target.value)">
              <option v-for="f in numericFields" :key="f.key" :value="f.key">{{ f.label || f.key }}</option>
            </select>
          </div>

          <div class="row">
            <span class="lb">聚合</span>
            <select :value="aggregate" @change="$emit('set-agg', $event.target.value)">
              <option value="sum">求和</option>
              <option value="avg">均值</option>
              <option value="count">计数</option>
            </select>
            <button class="mini" :class="{ on: active }" :title="active ? '关闭分级着色' : '开启分级着色'" @click="$emit('toggle', !active)">
              {{ active ? '着色中' : '已关闭' }}
            </button>
          </div>

          <!-- 分级色阶图例：低→高 渐变 + 极值 -->
          <div v-if="legend" class="legend">
            <div class="bar" :style="{ background: gradient }"></div>
            <div class="scale">
              <span>{{ minText }}</span>
              <span class="fl">{{ legend.fieldLabel }}</span>
              <span>{{ maxText }}</span>
            </div>
          </div>
        </template>
        <p class="tip">单击地图上的区域看该地业务明细 · 切换指标 / 聚合即时重绘</p>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  datasets: { type: Array, default: () => [] },
  fieldKey: { type: String, default: '' },
  aggregate: { type: String, default: 'sum' },
  active: { type: Boolean, default: false },
  legend: { type: Object, default: null },
  paper: { type: Boolean, default: false }
})

const emit = defineEmits(['import', 'close', 'select-dataset', 'select-field', 'set-agg', 'toggle'])

const KEY = 'maps-dashboard:biz-collapsed'
const collapsed = ref(false)

onMounted(() => {
  try {
    collapsed.value = localStorage.getItem(KEY) === '1'
  } catch (e) {
    /* 隐私模式下不可读，按展开处理 */
  }
})

function toggle() {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem(KEY, collapsed.value ? '1' : '0')
  } catch (e) {
    /* 忽略 */
  }
}

const activeDs = computed(() => props.datasets.find((d) => d.isActive) || props.datasets[0] || null)
const numericFields = computed(() =>
  (activeDs.value && activeDs.value.fields ? activeDs.value.fields : [])
    .filter((f) => f && f.type === 'number' && f.visible !== false)
    .map((f) => ({ key: f.key, label: f.label }))
)

const gradient = computed(() => {
  const l = props.legend
  if (!l || !l.stops || !l.stops.length) return ''
  const parts = l.stops.map((s) => `${s.color} ${(s.t * 100).toFixed(0)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
})

function fmt(v) {
  if (v == null || Number.isNaN(v)) return '—'
  if (Number.isInteger(v)) return v.toLocaleString()
  const a = Math.abs(v)
  if (a >= 1000 || a < 0.01) return v.toExponential(2)
  return (Math.round(v * 100) / 100).toLocaleString()
}
const minText = computed(() => fmt(props.legend && props.legend.min))
const maxText = computed(() => fmt(props.legend && props.legend.max))
</script>

<style scoped>
.bizbar {
  position: absolute;
  left: 24px;
  bottom: 24px;
  width: min(280px, calc(100% - 48px));
  max-height: 46vh;
  overflow-y: auto;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 9px;
  z-index: 12;
}
.bizbar.paper {
  border-color: rgba(43, 43, 40, 0.4);
  background: rgba(243, 230, 200, 0.92);
  color: #2b2b28;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-0);
  letter-spacing: 1px;
}
.bizbar.paper .title {
  color: #2b2b28;
}
.meta {
  font-size: 11px;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.bizbar.paper .meta {
  color: #5a4a2e;
}
.hops {
  margin-left: auto;
  display: flex;
  gap: 4px;
}
.mini {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid var(--panel-border);
  background: transparent;
  color: var(--text-1);
}
.mini:hover {
  color: var(--text-0);
  border-color: var(--accent);
}
.mini.on {
  color: var(--accent);
  border-color: var(--accent);
}
.empty {
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-1);
}
.empty .sub {
  margin-top: 4px;
  opacity: 0.8;
}
.warn {
  font-size: 11.5px;
  line-height: 1.7;
  color: #ffcf8a;
}
.bizbar.paper .warn {
  color: #8a5a1a;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.lb {
  font-size: 11.5px;
  color: var(--text-1);
}
.bizbar.paper .lb {
  color: #5a4a2e;
}
select {
  height: 26px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--panel-border);
  background: rgba(5, 12, 24, 0.6);
  color: var(--text-0);
  font-size: 11.5px;
  font-family: inherit;
  max-width: 170px;
}
.bizbar.paper select {
  background: rgba(255, 252, 240, 0.85);
  color: #2b2b28;
  border-color: rgba(43, 43, 40, 0.3);
}
.legend {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bar {
  height: 12px;
  border-radius: 4px;
  border: 1px solid var(--panel-border);
}
.scale {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.bizbar.paper .scale {
  color: #5a4a2e;
}
.scale .fl {
  color: var(--accent-2);
}
.tip {
  font-size: 11px;
  color: var(--text-1);
  opacity: 0.75;
  line-height: 1.6;
}
.bizbar.paper .tip {
  color: #5a4a2e;
}
</style>
