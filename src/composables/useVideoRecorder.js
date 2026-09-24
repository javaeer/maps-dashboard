/**
 * useVideoRecorder —— 把「地图画布」或「完整界面」录制成视频文件。
 *
 * 两条模式共用同一条合成管线：
 *   每帧：WebGL 画布 → 离屏 Canvas（+ 叠加 UI 层快照）→ captureStream → MediaRecorder
 *
 * 为什么不直接用 renderer.domElement.captureStream()？
 * 1. 那样录不到任何 HTML UI（信息面板、标题、面包屑），出来的视频只是一块裸地图；
 * 2. 只有在 map.onFrame 这个「composer.render() 之后、本帧尚未结束」的时机点取样，
 *    WebGL 的 drawing buffer 才还在，drawImage / captureStream 才有内容可读。
 *    时机点早了晚了都会录到黑帧。
 *
 * 因此模式差异只剩一件事：要不要叠加 UI 层。
 */
import { computed, onBeforeUnmount, reactive, ref, shallowRef } from 'vue'
import html2canvas from 'html2canvas'

/** 候选容器格式，按优先级排列：优先 MP4（剪辑软件通用），逐级回退到 WebM */
export const CODECS = [
  { mime: 'video/mp4;codecs=avc1.640034', ext: 'mp4', label: 'MP4 · H.264' },
  { mime: 'video/mp4', ext: 'mp4', label: 'MP4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM · VP9' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm', label: 'WebM · VP8' },
  { mime: 'video/webm', ext: 'webm', label: 'WebM' }
]

/** 输出长边上限：再大每帧 drawImage 的开销就会拖垮录制帧率，收益却很小 */
const MAX_EDGE = 1920
/** UI 层合成频率上限，避免 html2canvas 把主线程吃满 */
const UI_MAX_FPS = 6

/**
 * 检测浏览器是否具备录制能力
 * @returns {{ok: boolean, reason: string}}
 */
export function checkSupport() {
  if (typeof window === 'undefined') return { ok: false, reason: '非浏览器环境' }
  if (typeof window.MediaRecorder === 'undefined') {
    return { ok: false, reason: '当前浏览器不支持 MediaRecorder，建议使用 Chrome / Edge 90+ 或 Firefox' }
  }
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return { ok: false, reason: '当前浏览器不支持 canvas.captureStream()，无法捕获画布' }
  }
  return { ok: true, reason: '' }
}

/**
 * 挑一个浏览器真正支持的容器格式
 * @returns {typeof CODECS[0] | null}
 */
export function pickCodec() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return null
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return CODECS[CODECS.length - 1] // 没有探测能力就押最通用的 WebM
  }
  return CODECS.find((c) => MediaRecorder.isTypeSupported(c.mime)) || null
}

/** H.264 编码器要求宽高为偶数，否则 MediaRecorder 直接报错 */
function evenize(n) {
  const v = Math.max(2, Math.round(n))
  return v % 2 === 0 ? v : v - 1
}

/**
 * 生成导出文件名：maps-dashboard_YYYYMMDD_HHmmss.<ext>
 * @param {string} ext
 * @param {Date} [d]
 */
export function makeFileName(ext, d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `maps-dashboard_${stamp}.${ext}`
}

/** 把毫秒格式化成 mm:ss */
export function fmtDuration(ms) {
  const t = Math.floor(ms / 1000)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** 字节数转人类可读体积 */
export function fmtSize(n) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * @param {Object} opts
 * @param {() => HTMLCanvasElement} opts.getCanvas 取 WebGL 画布（ThreeMap.renderer.domElement）
 * @param {() => HTMLElement} opts.getStage 取整个界面根节点（模式「完整界面」时用于 html2canvas）
 * @param {() => Object} opts.getMap 取 ThreeMap 实例，用于挂载每帧钩子
 */
export function useVideoRecorder({ getCanvas, getStage, getMap }) {
  /** 录制参数 */
  const config = reactive({
    mode: 'ui', // 'ui' = 完整界面，'map' = 仅地图
    fps: 30,
    bitrateMbps: 12,
    maxSeconds: 0, // 0 = 不限时长
    uiFps: 3 // UI 层合成频率（html2canvas 很重，不能跟着视频帧率跑）
  })

  const recording = ref(false)
  const paused = ref(false)
  const elapsedMs = ref(0)
  const error = ref('')
  /** 支持性一次性判定 */
  const support = checkSupport()
  const codec = shallowRef(pickCodec())
  /** UI 层截图连续失败时的提示：不能让用户以为录到了界面，实际只有地图 */
  const uiWarn = ref('')

  /** 录制产物 */
  const result = reactive({ blob: null, url: '', name: '', size: 0, width: 0, height: 0, durationMs: 0 })

  let offCanvas = null // 离屏合成画布
  let offCtx = null
  let stream = null
  let track = null
  let recorder = null
  let chunks = []
  /** 最近一次 UI 快照（html2canvas 产出的 canvas），作为绘制源叠加 */
  let uiLayer = null
  let uiFailCount = 0
  let uiBusy = false
  let uiTimer = null
  let tickTimer = null
  let startedAt = 0
  let accumulated = 0
  let lastFrameAt = 0
  let canRequestFrame = true
  /** 保存地图原本的帧钩子，停止后还回去 */
  let prevFrameHook = null

  const ready = computed(() => support.ok && !!codec.value)

  /** 按模式与目标画布算出输出尺寸：限长边 + 取偶数 */
  function targetSize() {
    if (config.mode === 'map') {
      const gl = getCanvas()
      if (!gl) return null
      return fitEven(gl.width, gl.height)
    }
    const el = getStage()
    if (!el) return null
    const w = el.clientWidth || window.innerWidth
    const h = el.clientHeight || window.innerHeight
    return fitEven(w, h)
  }

  function fitEven(w, h) {
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
    return { width: evenize(w * scale), height: evenize(h * scale) }
  }

  /* ---------------- UI 层快照 ---------------- */

  /**
   * 用 html2canvas 把界面（排除地图画布本身）转成一张图。
   * 地图部分留空 —— 那块由 WebGL 画布每帧实时绘制，重复贴一次既慢又会打架。
   */
  async function snapUi() {
    const stage = getStage()
    if (!stage) return
    try {
      const scaledW = Math.min(1, MAX_EDGE / Math.max(stage.clientWidth, stage.clientHeight))
      const canvas = await html2canvas(stage, {
        backgroundColor: null,
        scale: scaledW,
        logging: false,
        useCORS: true,
        ignoreElements: (el) =>
          el.classList &&
          (el.classList.contains('map') || el.hasAttribute('data-no-capture'))
      })
      // html2canvas 会用传入元素的 scrollWidth 定位，产物尺寸未必等于目标，绘制时统一拉伸对齐
      uiLayer = canvas
      uiFailCount = 0
      if (uiWarn.value) uiWarn.value = ''
    } catch (e) {
      console.warn('[useVideoRecorder] UI 层快照失败，本帧仅输出地图', e)
      // 连续失败两次就不再静默：必须让用户知道成片里没有界面元素
      if (++uiFailCount >= 2 && config.mode === 'ui') {
        uiWarn.value = '界面层截图连续失败，成片中不会包含标题、信息面板等界面元素（地图画面不受影响）'
      }
    }
  }

  function scheduleUiLoop() {
    // 递归 setTimeout 而非 setInterval：html2canvas 万一卡住也不会堆积回调
    const period = 1000 / Math.max(1, Math.min(config.uiFps, UI_MAX_FPS))
    const loop = async () => {
      if (!recording.value) return
      if (!uiBusy) {
        uiBusy = true
        await snapUi()
        uiBusy = false
      }
      uiTimer = setTimeout(loop, period)
    }
    loop()
  }

  /* ---------------- 每帧合成 ---------------- */

  function drawFrame() {
    const gl = getCanvas()
    if (!gl || !offCtx) return
    const { width: W, height: H } = offCanvas

    if (config.mode === 'ui') {
      // 铺一层底色：EffectComposer 的输出未必覆盖到画布外，透明区在视频里会变成黑块
      offCtx.fillStyle = '#05080f'
      offCtx.fillRect(0, 0, W, H)
    } else {
      offCtx.clearRect(0, 0, W, H)
    }

    // 顺序不能反：WebGL 画布是「不透明」的（后期处理链输出的是整屏画面），
    // 先画它就会把 UI 层整个盖掉，界面元素在成片里一个都看不见。
    // 真实界面里 UI 也是浮在地图之上的，所以地图在下、界面在上。
    offCtx.drawImage(gl, 0, 0, W, H)
    if (config.mode === 'ui' && uiLayer && uiLayer.width) {
      offCtx.drawImage(uiLayer, 0, 0, uiLayer.width, uiLayer.height, 0, 0, W, H)
    }
  }

  /** 挂在 map.onFrame 上：地图每渲完一帧就回调一次 */
  function onMapFrame() {
    if (!recording.value || paused.value) return
    const now = performance.now()
    const minGap = 1000 / config.fps - 2 // 留 2ms 容差，避免掉帧把间隔卡死
    if (now - lastFrameAt < minGap) return
    lastFrameAt = now

    drawFrame()
    if (canRequestFrame && track) track.requestFrame()

    // 到时限自动收尾，避免用户忘记停导致文件过大
    if (config.maxSeconds > 0 && now - startedAt + accumulated >= config.maxSeconds * 1000) {
      stopRecording()
    }
  }

  /* ---------------- 控制 ---------------- */

  async function startRecording() {
    if (recording.value) return
    error.value = ''
    if (!support.ok) {
      error.value = support.reason
      return
    }
    if (!codec.value) {
      error.value = '未找到可用的视频编码格式'
      return
    }
    const gl = getCanvas()
    const map = getMap && getMap()
    if (!gl || !map) {
      error.value = '地图尚未初始化完成，请稍候再试'
      return
    }
    const size = targetSize()
    if (!size) {
      error.value = '无法确定录制画面尺寸'
      return
    }

    resetResult()
    uiFailCount = 0
    uiWarn.value = ''
    offCanvas = document.createElement('canvas')
    offCanvas.width = size.width
    offCanvas.height = size.height
    offCtx = offCanvas.getContext('2d')
    uiLayer = null
    chunks = []

    // 模式「完整界面」先抓一张 UI，保证第一帧就不是空的；地图层由接下来几帧补上
    if (config.mode === 'ui') await snapUi()

    try {
      stream = offCanvas.captureStream(0) // 0 = 手动推帧，帧率完全由我们的节流逻辑控制
      track = stream.getVideoTracks()[0]
      canRequestFrame = typeof track.requestFrame === 'function'
      // 极少数实现没有 requestFrame，退回自动采帧模式
      if (!canRequestFrame) {
        stream = offCanvas.captureStream(config.fps)
        track = stream.getVideoTracks()[0]
      }

      recorder = new MediaRecorder(stream, {
        mimeType: codec.value.mime,
        // MediaRecorder 默认码率只有几百 kbps，地图这种大面积渐变+细线会被糊成一团，必须显式给高
        videoBitsPerSecond: config.bitrateMbps * 1024 * 1024
      })
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data)
      }
      recorder.onerror = (e) => {
        error.value = `录制出错：${(e && e.error && e.error.name) || '未知错误'}`
        stopRecording()
      }
      recorder.onstop = finalize

      prevFrameHook = map.onFrame
      map.onFrame = onMapFrame

      // 推一帧再 start，避免首帧是纯黑
      drawFrame()
      if (canRequestFrame && track) track.requestFrame()

      recorder.start(1000) // 每秒吐一个分片，避免最后一整块 buffer 太大
      recording.value = true
      paused.value = false
      elapsedMs.value = 0
      accumulated = 0
      startedAt = performance.now()
      lastFrameAt = 0

      tickTimer = setInterval(() => {
        elapsedMs.value = accumulated + (performance.now() - startedAt)
      }, 200)

      if (config.mode === 'ui') scheduleUiLoop()
    } catch (e) {
      cleanup()
      error.value = `启动录制失败：${(e && e.message) || e}`
    }
  }

  function pauseRecording() {
    if (!recording.value || paused.value) return
    paused.value = true
    accumulated += performance.now() - startedAt
    clearInterval(tickTimer)
    if (recorder && recorder.state === 'recording') recorder.pause()
  }

  function resumeRecording() {
    if (!recording.value || !paused.value) return
    paused.value = false
    startedAt = performance.now()
    lastFrameAt = 0
    tickTimer = setInterval(() => {
      elapsedMs.value = accumulated + (performance.now() - startedAt)
    }, 200)
    if (recorder && recorder.state === 'paused') recorder.resume()
  }

  function stopRecording() {
    if (!recording.value) return
    if (recorder && recorder.state !== 'inactive') recorder.stop() // → 触发 onstop → finalize()
  }

  /** MediaRecorder 收尾：拼 Blob、准备预览与下载 */
  function finalize() {
    const duration = elapsedMs.value
    // cleanup() 会把 offCanvas 置空，尺寸得先存下来
    const w = offCanvas ? offCanvas.width : 0
    const h = offCanvas ? offCanvas.height : 0
    cleanup()
    const type = codec.value ? codec.value.mime : 'video/webm'
    const blob = new Blob(chunks, { type })
    chunks = []
    if (!blob.size) {
      error.value = '录制结束但未产生任何数据，请重试或改用「仅地图」模式'
      return
    }
    result.blob = blob
    result.url = URL.createObjectURL(blob)
    result.name = makeFileName(codec.value.ext)
    result.size = blob.size
    result.durationMs = duration
    result.width = w
    result.height = h
  }

  /** 释放一切运行期资源并把 UI 状态归位 */
  function cleanup() {
    if (tickTimer) clearInterval(tickTimer)
    if (uiTimer) clearTimeout(uiTimer)
    tickTimer = null
    uiTimer = null

    const map = getMap && getMap()
    if (map) map.onFrame = prevFrameHook
    prevFrameHook = null

    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      stream = null
    }
    track = null
    recorder = null
    offCtx = null
    offCanvas = null
    uiLayer = null
    recording.value = false
    paused.value = false
  }

  /** 清掉上一个产物（换参数重录时用，顺带释放 objectURL 防止内存泄漏） */
  function resetResult() {
    if (result.url) URL.revokeObjectURL(result.url)
    result.blob = null
    result.url = ''
    result.name = ''
    result.size = 0
    result.durationMs = 0
    result.width = 0
    result.height = 0
  }

  /** 下载录制结果 */
  function downloadRecording() {
    if (!result.blob) return
    const a = document.createElement('a')
    a.href = result.url
    a.download = result.name
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  onBeforeUnmount(() => {
    if (recording.value) stopRecording()
    cleanup()
    resetResult()
  })

  return {
    config,
    recording,
    paused,
    elapsedMs,
    error,
    uiWarn,
    support,
    codec,
    ready,
    result,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    downloadRecording,
    resetResult
  }
}
