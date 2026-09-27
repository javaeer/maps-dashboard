<template>
  <Transition name="slide">
    <div v-if="state && state.paths && state.paths.length" class="routebar" :class="{ collapsed }">
      <div class="head">
        <button class="fold" :title="collapsed ? '展开控制面板' : '收起控制面板'" @click="toggle">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path :d="collapsed ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5'" />
          </svg>
        </button>
        <span class="title">路径巡航</span>
        <span class="meta" :class="{ idle: state.activeIndex < 0 }">
          {{ state.activeIndex >= 0 ? `${state.count} 点 · ${state.lengthText || state.length}` : '未选中路径' }}
        </span>
      </div>

      <template v-if="!collapsed">
        <!-- 未选中任何路径时：地图上的单击不会连成路线，先提示怎么开始 -->
        <div v-if="state.activeIndex < 0" class="tip">
          未选中路径 · 单击地图只看信息。选中下方胶囊或点「＋」新建后，再单击区域 / 乡镇即可连线
        </div>

        <!-- 多条路径：点胶囊切换当前路径，× 删除，＋ 新建 -->
        <div class="paths">
          <span
            v-for="p in state.paths" :key="p.index"
            class="path" :class="{ active: p.index === state.activeIndex }"
            :style="{ '--pc': p.color }"
            :title="`${p.name}：${p.count} 点 · ${p.lengthText}`"
            @click="$emit('select-route', p.index)"
          >
            <i></i>
            <em>{{ p.name }}</em>
            <b>{{ p.count }}</b>
            <button
              v-if="state.paths.length > 1"
              class="del" title="删除这条路径"
              @click.stop="$emit('remove-route', p.index)"
            >×</button>
          </span>
          <button class="path-add" title="新建一条路径" @click="$emit('new-route')">＋</button>
        </div>

        <div class="ops">
          <button class="btn primary" :disabled="state.count < 2" @click="$emit('toggle')">
            {{ state.cruising ? '暂停' : '巡航' }}
          </button>
          <button class="btn" :disabled="state.count < 1" @click="$emit('undo')">撤销</button>
          <button class="btn danger" :disabled="state.count < 1" @click="$emit('clear')">清空</button>
        </div>

        <div class="ops">
          <button class="btn wide" :disabled="cruisable < 1" @click="$emit('toggle-all')">
            {{ state.cruiseAll ? '停止全部巡航' : `全部巡航（${cruisable} 条）` }}
          </button>
        </div>

        <div class="speed">
          <span class="lab">速度</span>
          <input
            type="range" min="60" max="900" step="20"
            :value="state.speed"
            @input="$emit('speed', Number($event.target.value))"
          >
          <span class="val">{{ state.speedKmh != null ? state.speedKmh + ' km/h' : state.speed }}</span>
        </div>

        <div class="stops">
          <span
            v-for="s in state.stops" :key="s.index"
            class="stop" :class="{ active: s.index === active }"
            @click="$emit('focus', s.index - 1)"
          >
            <i>{{ s.index }}</i><em>{{ s.name }}</em><s v-if="levelText(s.level)">{{ levelText(s.level) }}</s>
          </span>
        </div>

        <div v-if="hint" class="hint">{{ hint }}</div>
      </template>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  state: { type: Object, default: null },
  active: { type: Number, default: -1 },
  hint: { type: String, default: '' }
})
defineEmits(['toggle', 'toggle-all', 'clear', 'undo', 'speed', 'focus', 'new-route', 'select-route', 'remove-route'])

// 可巡航（≥2 点）的路径条数：决定「全部巡航」按钮是否可用
const cruisable = computed(() => {
  const list = (props.state && props.state.paths) || []
  return list.filter((p) => p.count >= 2).length
})

// 路径点可能来自不同层级（省 / 市 / 区县 / 镇），标出来便于区分跨层路线
const LEVEL_TEXT = {
  province: '省',
  city: '市',
  district: '区县',
  county: '区县',
  town: '镇',
  region: '区'
}
function levelText(level) {
  return LEVEL_TEXT[level] || ''
}

// 折叠状态记在本地：全屏演示时通常只想要一条窄胶囊
const KEY = 'maps-dashboard:route-collapsed'
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
</script>

<style scoped>
.routebar {
  position: absolute;
  left: 24px;
  bottom: 24px;
  width: min(268px, calc(100% - 48px));
  padding: 10px 12px;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
  z-index: 22;
  transition: padding 0.22s ease;
}
.routebar.collapsed {
  width: auto;
  padding: 7px 12px 7px 8px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fold {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
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
.title {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 1px;
}
.meta {
  font-size: 11px;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.meta.idle {
  color: #fcd34d;
}

/* 未选中路径时的开工说明：比告警色柔和，只做引导 */
.tip {
  margin-top: 9px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.18);
}

/* ---------- 多路径切换 ---------- */
.paths {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 9px;
}
.path {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 132px;
  padding: 2px 6px 2px 5px;
  border-radius: 7px;
  font-size: 11px;
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
}
.path:hover {
  color: var(--text-0);
  border-color: rgba(255, 255, 255, 0.3);
}
.path.active {
  color: var(--text-0);
  background: color-mix(in srgb, var(--pc) 20%, transparent);
  border-color: var(--pc);
}
/* 色点：每条路径一色，与地图上的管道同色 */
.path i {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--pc);
  box-shadow: 0 0 6px var(--pc);
}
.path em {
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path b {
  font-size: 10px;
  font-weight: 600;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
.path .del {
  flex: none;
  width: 14px;
  height: 14px;
  padding: 0;
  line-height: 1;
  font-size: 12px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
}
.path .del:hover {
  background: rgba(248, 113, 113, 0.28);
  color: #fecaca;
}
.path-add {
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  border-radius: 7px;
  border: 1px dashed rgba(255, 255, 255, 0.28);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
}
.path-add:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.ops {
  margin-top: 8px;
  display: flex;
  gap: 6px;
}
.btn {
  flex: 1;
  font-size: 12px;
  padding: 5px 0;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-0);
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn.primary {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.45);
  color: var(--accent);
}
.btn.danger {
  background: rgba(248, 113, 113, 0.14);
  border-color: rgba(248, 113, 113, 0.36);
  color: #fca5a5;
}
.btn.wide {
  background: rgba(167, 139, 250, 0.16);
  border-color: rgba(167, 139, 250, 0.42);
  color: #ddd6fe;
}
.speed {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
  font-size: 11px;
  color: var(--text-1);
}
.speed input {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.speed .val {
  flex: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-0);
}
.stops {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 9px;
  /* 限高约 5 行：路径点更多时面板内滚动，不把面板撑得盖住地图 */
  max-height: 148px;
  overflow-y: auto;
}
.stop {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  padding: 3px 8px 3px 4px;
  border-radius: 8px;
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.2);
  color: var(--text-1);
  cursor: pointer;
}
.stop:hover {
  border-color: rgba(56, 189, 248, 0.5);
  color: var(--text-0);
}
.stop.active {
  background: rgba(56, 189, 248, 0.22);
  color: var(--text-0);
}
.stop i {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  flex: none;
  border-radius: 50%;
  background: rgba(56, 189, 248, 0.25);
  color: var(--accent);
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
}
.stop em {
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 层级徽标：跨层级路线里一眼看出这个点是省、市、区县还是镇 */
.stop s {
  flex: none;
  text-decoration: none;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 5px;
  color: #bae6fd;
  background: rgba(56, 189, 248, 0.16);
  border: 1px solid rgba(56, 189, 248, 0.28);
}
.hint {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.45;
  color: #fcd34d;
}

/* 从左侧滑入：贴在左下角，不再从底部升起压住地图中央 */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.28s ease, opacity 0.28s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(-120%);
  opacity: 0;
}
</style>
