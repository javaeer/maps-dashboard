<template>
  <div class="milbar" :class="{ paper }">
    <div class="head">
      <span class="title">军事要素</span>
      <span class="meta">{{ shownCount }} / {{ totalCount }} 个</span>
      <div class="hops">
        <button class="mini" title="导入军事要素（CSV / Excel / GeoJSON）" @click="$emit('import')">导入</button>
        <button class="mini" :class="{ on: !collapsed }" title="展开 / 收起" @click="toggle">
          {{ collapsed ? '展开' : '收起' }}
        </button>
        <button class="mini" title="关闭面板" @click="$emit('close')">×</button>
      </div>
    </div>

    <template v-if="!collapsed">
      <!-- 点击地图上的要素后在这里看详情 -->
      <div v-if="picked" class="pick">
        <div class="pick-head">
          <span class="pname">{{ picked.name }}</span>
          <span class="pkind" :style="{ '--kc': kindOf(picked.kind).color }">{{ kindOf(picked.kind).label }}</span>
        </div>
        <dl class="kv">
          <div v-if="picked.side"><dt>阵营 / 部队</dt><dd>{{ picked.side }}</dd></div>
          <div v-if="picked.era"><dt>时期</dt><dd>{{ picked.era }}</dd></div>
          <div v-if="picked.date"><dt>时间</dt><dd>{{ picked.date }}</dd></div>
          <div v-if="picked.strength"><dt>兵力</dt><dd>{{ picked.strength }}</dd></div>
          <div v-if="picked.commander"><dt>指挥官</dt><dd>{{ picked.commander }}</dd></div>
          <div v-if="picked.region || picked.adcode">
            <dt>所属区域</dt><dd>{{ picked.region || picked.adcode }}</dd>
          </div>
          <div v-if="picked.point">
            <dt>坐标</dt><dd>{{ picked.point.lng.toFixed(5) }}, {{ picked.point.lat.toFixed(5) }}</dd>
          </div>
          <div v-if="picked.path"><dt>路线</dt><dd>{{ picked.path.length }} 个途经点</dd></div>
          <div v-if="picked.note"><dt>备注</dt><dd>{{ picked.note }}</dd></div>
        </dl>
        <div class="psrc">数据集：{{ picked.setName || '—' }}</div>
      </div>

      <div v-if="!sets.length" class="empty">
        还没有军事要素。点「导入」上传 CSV / Excel / GeoJSON，或先下载模板。
        <p class="sub">军事态势随时代变化，建议按年代各存一份数据集，用「时期」过滤切换。</p>
      </div>

      <template v-else>
        <!-- 按时期过滤：同一地点的不同年代态势靠这个切换 -->
        <div v-if="eras.length" class="row">
          <span class="lb">时期</span>
          <select :value="eraFilter" @change="$emit('set-era', $event.target.value)">
            <option value="">全部时期</option>
            <option v-for="e in eras" :key="e" :value="e">{{ e }}</option>
          </select>
        </div>

        <div class="sets">
          <div v-for="s in sets" :key="s.id" class="set" :class="{ off: s.visible === false }">
            <label class="sw">
              <input
                type="checkbox"
                :checked="s.visible !== false"
                @change="$emit('toggle-set', s.id, $event.target.checked)"
              />
              <span class="sname" :title="s.name">{{ s.name }}</span>
            </label>
            <span class="scnt">{{ s.featureCount }} 个</span>
            <button
              class="mini"
              :class="{ on: s.labelOn !== false }"
              title="显示 / 隐藏这批要素的名称标注"
              @click="$emit('toggle-label', s.id, s.labelOn === false)"
            >名</button>
            <button class="mini del" title="删除这个数据集" @click="onRemove(s)">×</button>
          </div>
        </div>

        <!-- 按类型过滤 -->
        <div class="row kinds">
          <span class="lb">类型</span>
          <div class="chips">
            <button
              v-for="k in kindChips"
              :key="k.key"
              class="chip"
              :class="{ on: !kindFilter.length || kindFilter.includes(k.key) }"
              :style="{ '--kc': k.color }"
              :title="k.desc"
              @click="$emit('toggle-kind', k.key)"
            >
              <i></i>{{ k.label }} {{ k.n }}
            </button>
          </div>
        </div>
        <p class="tip">单击地图上的军标看详情 · 用「时期 / 类型」切换要显示哪一层态势</p>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { MIL_KINDS, milKind } from '../utils/militarySchema.js'

const props = defineProps({
  sets: { type: Array, default: () => [] },
  eras: { type: Array, default: () => [] },
  kindStats: { type: Object, default: () => ({}) },
  eraFilter: { type: String, default: '' },
  kindFilter: { type: Array, default: () => [] },
  shownCount: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
  picked: { type: Object, default: null },
  paper: { type: Boolean, default: false }
})

const emit = defineEmits(['import', 'close', 'toggle-set', 'toggle-label', 'remove-set', 'set-era', 'toggle-kind'])

const KEY = 'maps-dashboard:mil-collapsed'
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

function kindOf(key) {
  return milKind(key)
}

/** 只列本次导入里真实出现过的类型，避免列一堆用不上的符号 */
const kindChips = computed(() =>
  MIL_KINDS.filter((k) => props.kindStats[k.key]).map((k) => ({ ...k, n: props.kindStats[k.key] }))
)

function onRemove(s) {
  if (window.confirm(`删除「${s.name}」及其 ${s.featureCount} 个要素？此操作不可撤销。`)) {
    emit('remove-set', s.id)
  }
}
</script>

<style scoped>
.milbar {
  position: absolute;
  right: 24px;
  bottom: 24px;
  /* 纸质主题下右下图注占位约 200px，本面板要抬到它上面，不能压住图注 */
  width: min(288px, calc(100% - 48px));
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
.milbar.paper {
  bottom: 232px;
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
.meta {
  font-size: 11px;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
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
.mini.del:hover {
  color: #ff8a8a;
  border-color: rgba(255, 138, 138, 0.6);
}
.pick {
  border: 1px solid var(--panel-border);
  border-radius: 9px;
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pick-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pname {
  font-size: 13px;
  color: var(--text-0);
  font-weight: 600;
}
.pkind {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--kc);
  color: var(--kc);
}
.kv {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11.5px;
}
.kv > div {
  display: flex;
  gap: 8px;
}
.kv dt {
  color: var(--text-1);
  min-width: 62px;
}
.kv dd {
  color: var(--text-0);
  margin: 0;
  flex: 1;
  word-break: break-all;
}
.psrc {
  font-size: 11px;
  color: var(--text-1);
  opacity: 0.8;
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
:global(:root.theme-paper) select {
  background: rgba(255, 252, 240, 0.75);
}
.sets {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.set {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 8px;
  border: 1px solid transparent;
}
.set:hover {
  border-color: var(--panel-border);
}
.set.off .sname {
  opacity: 0.45;
  text-decoration: line-through;
}
.sw {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.sw input {
  accent-color: var(--accent);
}
.sname {
  font-size: 11.5px;
  color: var(--text-0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scnt {
  font-size: 11px;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.kinds {
  align-items: flex-start;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  flex: 1;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  background: transparent;
  color: var(--text-1);
  opacity: 0.5;
}
.chip.on {
  opacity: 1;
  color: var(--text-0);
  border-color: var(--kc);
}
.chip i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--kc);
}
.tip {
  font-size: 11px;
  color: var(--text-1);
  opacity: 0.75;
  line-height: 1.6;
}
</style>
