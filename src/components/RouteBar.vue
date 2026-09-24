<template>
  <Transition name="slide">
    <div v-if="state && state.count" class="routebar" :class="{ collapsed }">
      <div class="head">
        <button class="fold" :title="collapsed ? '展开控制面板' : '收起控制面板'" @click="toggle">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path :d="collapsed ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5'" />
          </svg>
        </button>
        <span class="title">路径巡航</span>
        <span class="meta">{{ state.count }} 点 · {{ state.lengthText || state.length }}</span>
      </div>

      <template v-if="!collapsed">
        <div class="ops">
          <button class="btn primary" @click="$emit('toggle')">
            {{ state.cruising ? '暂停' : '巡航' }}
          </button>
          <button class="btn" :disabled="state.count < 2" @click="$emit('undo')">撤销</button>
          <button class="btn danger" @click="$emit('clear')">清空</button>
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
            <i>{{ s.index }}</i><em>{{ s.name }}</em>
          </span>
        </div>

        <div v-if="hint" class="hint">{{ hint }}</div>
      </template>
    </div>
  </Transition>
</template>

<script setup>
import { ref, onMounted } from 'vue'

defineProps({
  state: { type: Object, default: null },
  active: { type: Number, default: -1 },
  hint: { type: String, default: '' }
})
defineEmits(['toggle', 'clear', 'undo', 'speed', 'focus'])

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
  width: min(252px, calc(100% - 48px));
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
.ops {
  margin-top: 9px;
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
