<template>
  <div class="recorder" :class="{ live: rec.recording.value }">
    <!-- 录制入口：录制中变成一个带计时的红点 -->
    <button
      class="recbtn"
      :class="{ live: rec.recording.value }"
      :title="rec.ready.value ? '录制视频' : rec.support.reason"
      :disabled="!rec.ready.value"
      data-no-capture
      @click="open = !open"
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <circle v-if="!rec.recording.value" cx="8" cy="8" r="5" />
        <rect v-else x="5" y="5" width="6" height="6" rx="1" />
      </svg>
      <span v-if="rec.recording.value">{{ fmtDuration(rec.elapsedMs.value) }}</span>
      <span v-else>录制</span>
    </button>

    <transition name="drop">
      <div v-if="open" class="rcp" data-no-capture>
        <div class="rcp-head">
          <h4>录制视频</h4>
          <button class="x" title="收起" @click="open = false">×</button>
        </div>

        <!-- 不支持时只给结论，不摆一堆点了也没用的控件 -->
        <p v-if="!rec.support.ok" class="rcp-err">{{ rec.support.reason }}</p>

        <template v-else>
          <div class="rcp-row">
            <span class="lb">模式</span>
            <div class="seg">
              <button
                v-for="m in MODES"
                :key="m.value"
                class="sg"
                :class="{ on: rec.config.mode === m.value }"
                :disabled="rec.recording.value"
                :title="m.desc"
                @click="rec.config.mode = m.value"
              >
                {{ m.label }}
              </button>
            </div>
          </div>

          <div class="rcp-grid">
            <label class="fld">
              <span class="lb">帧率</span>
              <select v-model.number="rec.config.fps" :disabled="rec.recording.value">
                <option v-for="f in FPS" :key="f" :value="f">{{ f }} fps</option>
              </select>
            </label>
            <label class="fld">
              <span class="lb">码率</span>
              <select v-model.number="rec.config.bitrateMbps" :disabled="rec.recording.value">
                <option v-for="b in BITRATES" :key="b" :value="b">{{ b }} Mbps</option>
              </select>
            </label>
            <label class="fld">
              <span class="lb">时长限制</span>
              <select v-model.number="rec.config.maxSeconds" :disabled="rec.recording.value">
                <option :value="0">不限制</option>
                <option :value="15">15 秒</option>
                <option :value="30">30 秒</option>
                <option :value="60">1 分钟</option>
                <option :value="180">3 分钟</option>
              </select>
            </label>
            <label class="fld" v-if="rec.config.mode === 'ui'">
              <span class="lb">界面刷新</span>
              <select v-model.number="rec.config.uiFps" :disabled="rec.recording.value">
                <option :value="2">2 fps（省性能）</option>
                <option :value="3">3 fps（推荐）</option>
                <option :value="6">6 fps（最跟手）</option>
              </select>
            </label>
          </div>

          <p class="rcp-note">
            输出格式 {{ rec.codec.value ? rec.codec.value.label : '—' }}
            <template v-if="rec.config.mode === 'map'">· 仅地图画面</template>
          </p>

          <!-- 计时与控制 -->
          <div class="rcp-live" v-if="rec.recording.value">
            <span class="dot" :class="{ paused: rec.paused.value }"></span>
            <span class="clock">{{ fmtDuration(rec.elapsedMs.value) }}</span>
            <button class="btn sm" @click="rec.paused.value ? rec.resumeRecording() : rec.pauseRecording()">
              {{ rec.paused.value ? '继续' : '暂停' }}
            </button>
            <button class="btn sm stop" @click="rec.stopRecording()">停止</button>
          </div>
          <button v-else class="btn go" :disabled="!rec.ready.value" @click="rec.startRecording()">
            开始录制
          </button>

          <!-- 录制产物 -->
          <div v-if="rec.result.url" class="rcp-res">
            <video :src="rec.result.url" controls playsinline class="prev"></video>
            <p class="meta">
              {{ rec.result.name }}<br />
              {{ fmtSize(rec.result.size) }} · {{ fmtDuration(rec.result.durationMs) }} ·
              {{ rec.result.width }}×{{ rec.result.height }}
            </p>
            <div class="acts">
              <button class="btn sm primary" @click="rec.downloadRecording()">下载视频</button>
              <button class="btn sm" @click="rec.resetResult()">清除</button>
            </div>
          </div>

          <p v-if="rec.uiWarn.value" class="rcp-warn">{{ rec.uiWarn.value }}</p>
          <p v-if="rec.error.value" class="rcp-err">{{ rec.error.value }}</p>
        </template>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useVideoRecorder, fmtDuration, fmtSize } from '../composables/useVideoRecorder.js'

const props = defineProps({
  /** 取 ThreeMap 实例，用于挂载每帧钩子 */
  getMap: { type: Function, required: true },
  /** 取界面根节点，完整界面模式下用于 html2canvas 截图 */
  getStage: { type: Function, required: true },
  /** 地图是否已初始化成功 */
  enabled: { type: Boolean, default: false }
})

const open = ref(false)

const MODES = [
  { value: 'ui', label: '完整界面', desc: '地图 + 标题、信息面板等所有界面元素（推荐）' },
  { value: 'map', label: '仅地图', desc: '只有 3D 地图画布，性能好、体积小' }
]
const FPS = [24, 30, 60]
const BITRATES = [8, 12, 16]

// getCanvas 从地图实例上现取：地图重建 / 画布替换后依然拿得到最新那块
const rec = useVideoRecorder({
  getCanvas: () => {
    const m = props.getMap()
    return m && m.renderer ? m.renderer.domElement : null
  },
  getStage: () => (props.getStage ? props.getStage() : null),
  getMap: () => (props.enabled ? props.getMap() : null)
})

// 录制状态同步给外层：由 App 给舞台挂 .recording，用来收起干扰画面的控件
const emit = defineEmits(['state-change'])
watch(rec.recording, (v) => emit('state-change', v))
</script>

<style scoped>
.recorder {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  pointer-events: auto;
}
.recbtn {
  height: 30px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: rgba(10, 20, 38, 0.55);
  color: var(--text-1);
  font-size: 12px;
  letter-spacing: 1px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.recbtn svg {
  fill: #f87171;
  stroke: none;
}
.recbtn:hover:not(:disabled) {
  color: var(--text-0);
  border-color: rgba(120, 200, 255, 0.5);
}
.recbtn.live {
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.6);
  background: rgba(69, 10, 10, 0.55);
}
.recbtn:disabled {
  opacity: 0.45;
}

.rcp {
  position: absolute;
  top: 38px;
  right: 0;
  z-index: 30;
  width: 288px;
  padding: 16px 18px 18px;
  border-radius: 12px;
  background: rgba(8, 16, 32, 0.92);
  border: 1px solid rgba(56, 189, 248, 0.22);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
}
.rcp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.rcp-head h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-0);
  letter-spacing: 1px;
}
.x {
  border: none;
  background: none;
  color: var(--text-1);
  font-size: 18px;
  line-height: 1;
  padding: 0 2px;
}
.x:hover {
  color: var(--text-0);
}

.rcp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.lb {
  font-size: 11px;
  color: var(--text-1);
  white-space: nowrap;
}
.seg {
  display: flex;
  gap: 0;
  border: 1px solid rgba(120, 160, 220, 0.25);
  border-radius: 8px;
  overflow: hidden;
}
.sg {
  flex: 1;
  height: 28px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--text-1);
  font-size: 12px;
}
.sg:hover:not(:disabled) {
  color: var(--text-0);
}
.sg.on {
  color: #04121f;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  font-weight: 600;
}
.sg:disabled {
  opacity: 0.5;
}

.rcp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.fld select {
  height: 28px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: rgba(10, 20, 38, 0.8);
  color: var(--text-0);
  font-size: 12px;
}
.fld select:disabled {
  opacity: 0.5;
}

.rcp-note {
  margin: 0 0 12px;
  font-size: 11px;
  color: var(--text-1);
  letter-spacing: 0.5px;
}

.btn {
  height: 30px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  background: transparent;
  color: var(--text-1);
  font-size: 12px;
}
.btn:hover:not(:disabled) {
  color: var(--text-0);
  border-color: var(--accent-2);
}
.btn.sm {
  height: 26px;
  padding: 0 10px;
  font-size: 11px;
}
.btn.stop {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.4);
}
.btn.go {
  width: 100%;
  color: #04121f;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  border-color: transparent;
  font-weight: 600;
}
.btn.primary {
  color: #04121f;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  border-color: transparent;
  font-weight: 600;
}
.btn:disabled {
  opacity: 0.4;
}

.rcp-live {
  display: flex;
  align-items: center;
  gap: 8px;
}
.clock {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  color: #fecaca;
  letter-spacing: 1px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f87171;
  box-shadow: 0 0 8px rgba(248, 113, 113, 0.9);
  animation: blink 1s steps(2, start) infinite;
}
.dot.paused {
  background: #fbbf24;
  box-shadow: none;
  animation: none;
}
@keyframes blink {
  to {
    opacity: 0.25;
  }
}

.rcp-res {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(120, 160, 220, 0.18);
}
.prev {
  width: 100%;
  border-radius: 8px;
  background: #000;
  display: block;
}
.meta {
  margin: 8px 0 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-1);
  word-break: break-all;
}
.acts {
  display: flex;
  gap: 8px;
}

.rcp-warn {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: #fcd34d;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.rcp-err {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: #fca5a5;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.drop-enter-active,
.drop-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
