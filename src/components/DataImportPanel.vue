<template>
  <div class="mask" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-label="导入业务数据">
      <!-- 头部：步骤指示器 -->
      <header class="head">
        <h3 class="title">导入业务数据</h3>
        <ol class="steps">
          <li
            v-for="s in STEPS"
            :key="s.no"
            class="step"
            :class="{ on: s.no === step, done: s.no < step }"
          >
            <span class="dot">{{ s.no }}</span>
            <span class="st">{{ s.label }}</span>
          </li>
        </ol>
        <button class="x" title="关闭" @click="$emit('close')">×</button>
      </header>

      <div class="body">
        <!-- ---------- 步骤 1：选择文件 ---------- -->
        <section v-if="step === 1" class="pane">
          <div
            class="drop"
            :class="{ over: dragging, busy: parsing }"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
            @click="pickFile"
          >
            <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
              <path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
            <p class="dp1">拖拽文件到此处，或点击选择</p>
            <p class="dp2">支持 CSV、Excel（.xlsx / .xls）、JSON，单个文件建议不超过 20MB</p>
            <input
              ref="fileInput"
              type="file"
              class="hidden-input"
              accept=".csv,.xlsx,.xls,.json"
              @change="onPick"
            />
          </div>
          <p v-if="fileInfo" class="file-card">
            <span class="fname">{{ fileInfo.name }}</span>
            <span class="fsize">{{ fileInfo.size }}</span>
            <span class="fkind">{{ fileInfo.kind }}</span>
          </p>
          <p v-if="error" class="err">{{ error }}</p>
          <p class="tip">
            <strong>提示：</strong>文件至少需要一列区域编码（adcode）。区域编码列为文本格式最佳，
            若 Excel 中存为数字，系统会自动还原（如 <code>620422.0</code> → <code>620422</code>）。
          </p>

          <!-- 模板下载：省去用户猜格式的环节 -->
          <div class="tpl">
            <div class="tpl-head">
              <h4>还没有现成文件？先下载模板</h4>
              <p class="tpl-desc">
                模板已预填<strong>真实行政区划代码与名称</strong>（取自本站地图数据），业务数值列留空待填。
              </p>
            </div>
            <div class="tpl-row">
              <label class="tpl-adcode">
                <span>乡镇模板的区县编码</span>
                <input v-model="tplAdcode" class="ipt" maxlength="6" placeholder="620422" />
              </label>
              <button class="btn" :disabled="tplBusy" @click="doDownload('town')">
                下载乡镇级模板
              </button>
              <button class="btn" :disabled="tplBusy" @click="doDownload('county')">
                下载区县级模板
              </button>
            </div>
            <p v-if="tplMsg" class="tpl-msg" :class="{ bad: tplBad }">{{ tplMsg }}</p>
          </div>
        </section>

        <!-- ---------- 步骤 2：解析预览 ---------- -->
        <section v-else-if="step === 2" class="pane">
          <div class="meta-row">
            <span class="pill">编码 {{ meta.encoding }}</span>
            <span class="pill">共 {{ rows.length }} 行</span>
            <span class="pill">共 {{ columns.length }} 列</span>
          </div>
          <div class="table-wrap">
            <table class="grid">
              <thead>
                <tr>
                  <th class="idx">#</th>
                  <th v-for="c in columns" :key="c">{{ c }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in previewRows" :key="i">
                  <td class="idx">{{ i + 1 }}</td>
                  <td v-for="c in columns" :key="c">{{ short(r[c]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="tip">以上为前 {{ previewRows.length }} 行预览，用于确认解析是否正确。</p>
        </section>

        <!-- ---------- 步骤 3：字段映射 ---------- -->
        <section v-else-if="step === 3" class="pane">
          <div class="map-grid">
            <label class="fld">
              <span class="lb">区域编码列 <em>建议必选</em></span>
              <select v-model="mapping.adcode">
                <option value="">（不使用编码列）</option>
                <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label class="fld">
              <span class="lb">区域名称列 <em>备用匹配</em></span>
              <select v-model="mapping.regionName">
                <option value="">（不使用名称列）</option>
                <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label class="fld">
              <span class="lb">层级列 <em>可选</em></span>
              <select v-model="mapping.level">
                <option value="">（不使用层级列）</option>
                <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label class="fld">
              <span class="lb">父级编码列 <em>可选</em></span>
              <select v-model="mapping.parentAdcode">
                <option value="">（不使用父级编码列）</option>
                <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
          </div>

          <p v-if="!mapping.adcode" class="warn">
            未选择区域编码列。仍可继续，但只能按「区域名称」匹配，成功率通常较低。
          </p>

          <div class="sub-head">
            <h4>业务字段</h4>
            <span class="cnt">{{ visibleCount }} / {{ fields.length }} 个字段将在面板展示</span>
          </div>

          <div class="fields">
            <div v-for="(f, i) in fields" :key="f.key" class="frow" :class="{ off: !f.visible }">
              <input v-model="f.visible" type="checkbox" class="ck" :title="f.visible ? '在面板中展示' : '不展示'" />
              <span class="fkey" :title="f.key">{{ f.key }}</span>
              <input v-model="f.label" class="ipt" placeholder="显示名称" />
              <input v-model="f.unit" class="ipt unit" placeholder="单位" />
              <select v-model="f.format" class="sel">
                <option value="number">数值</option>
                <option value="percent">百分比</option>
                <option value="currency">货币</option>
                <option value="text">文本</option>
              </select>
              <span class="mv">
                <button :disabled="i === 0" title="上移" @click="move(i, -1)">↑</button>
                <button :disabled="i === fields.length - 1" title="下移" @click="move(i, 1)">↓</button>
              </span>
            </div>
            <p v-if="!fields.length" class="dim">没有剩余业务字段（所有列都被用作匹配列）。</p>
          </div>
        </section>

        <!-- ---------- 步骤 4：层级选择 ---------- -->
        <section v-else-if="step === 4" class="pane">
          <label class="fld block">
            <span class="lb">数据所属层级</span>
            <select v-model="levelMode">
              <option v-for="o in LEVEL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
          <p class="tip">
            选定层级后，系统会按该层级去内置地理数据中核对编码。选「自动」时依据民政部编码规范判断：
            6 位且形如 <code>620000</code> 为省级，形如 <code>620400</code> 为市级，
            其余 6 位为区县级，9 / 12 位为镇级。
          </p>
          <div class="sample">
            <h4>编码解析抽样</h4>
            <table class="grid compact">
              <thead>
                <tr><th>原始编码</th><th>规范化</th><th>判定层级</th><th>父级编码</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in levelSamples" :key="s.raw">
                  <td>{{ s.raw }}</td>
                  <td>{{ s.code || '—' }}</td>
                  <td>{{ s.text }}</td>
                  <td>{{ s.parent || '—' }}</td>
                </tr>
                <tr v-if="!levelSamples.length"><td colspan="4" class="dim">当前没有可用的编码行</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ---------- 步骤 5：校验与匹配 ---------- -->
        <section v-else-if="step === 5" class="pane">
          <p v-if="validating" class="progress">{{ progressText }}</p>

          <template v-if="result">
            <div class="stat-row">
              <div class="sb ok">
                <div class="sbk">匹配成功</div>
                <div class="sbv">{{ result.matchedCount }}</div>
                <div class="sbs">条记录</div>
              </div>
              <div class="sb bad">
                <div class="sbk">无法匹配</div>
                <div class="sbv">{{ result.missingCount }}</div>
                <div class="sbs">条记录</div>
              </div>
              <div class="sb">
                <div class="sbk">合计</div>
                <div class="sbv">{{ result.total }}</div>
                <div class="sbs">条记录</div>
              </div>
            </div>

            <p class="tip">本次核对调用了内置数据：{{ result.files.join('、') || '无' }}</p>

            <div v-if="result.missingList.length" class="miss">
              <h4>未匹配记录（最多显示 10 条）</h4>
              <table class="grid compact">
                <thead>
                  <tr><th>行号</th><th>原始编码</th><th>区域名称</th><th>原因</th></tr>
                </thead>
                <tbody>
                  <tr v-for="m in result.missingList" :key="m.row">
                    <td>{{ m.row }}</td>
                    <td>{{ m.raw }}</td>
                    <td>{{ m.name || '—' }}</td>
                    <td>{{ m.reason }}</td>
                  </tr>
                </tbody>
              </table>
              <label class="ck-line">
                <input v-model="keepUnmatched" type="checkbox" />
                <span>仍导入无法匹配的记录（面板中不会显示，后续可用于核对）</span>
              </label>
              <p class="tip">
                若大量编码无法匹配，通常是层级选错（例如数据实际是区县级却选了市级），
                可返回上一步调整层级。
              </p>
            </div>
            <p v-else class="ok-line">全部记录均已在内置区域中找到对应行政区。</p>
          </template>
        </section>

        <!-- ---------- 步骤 6：命名与存储 ---------- -->
        <section v-else-if="step === 6" class="pane">
          <label class="fld block">
            <span class="lb">数据集名称</span>
            <input v-model="dataSetName" class="ipt wide" placeholder="如：2024 年各乡镇经济数据" />
          </label>
          <div class="meta-row">
            <span class="pill">层级 {{ levelText }}</span>
            <span class="pill">字段 {{ visibleCount }} 个</span>
            <span class="pill">将入库 {{ importCount }} 条</span>
          </div>
          <p class="tip">数据保存在本机浏览器 IndexedDB 中，不上传服务器；清除浏览器数据会一并删除。</p>
          <p v-if="error" class="err">{{ error }}</p>
        </section>
      </div>

      <!-- 底部操作条 -->
      <footer class="foot">
        <button class="btn" :disabled="step === 1 || busy" @click="back">
          {{ step === 1 ? '取消' : '上一步' }}
        </button>
        <div class="spacer"></div>
        <span v-if="busy" class="busy">处理中…</span>
        <button v-if="step === 1" class="btn primary" :disabled="!fileInfo || busy" @click="doParse">
          解析文件
        </button>
        <!-- 第 5 步：未核对时主按钮为「开始核对」；核对完成后主按钮变「下一步」， -->
        <!-- 「重新核对」退为次要按钮，否则用户会卡在这一步前进不了 -->
        <template v-else-if="step === 5">
          <button v-if="result" class="btn" :disabled="busy" @click="doValidate">重新核对</button>
          <button class="btn primary" :disabled="busy" @click="result ? next() : doValidate()">
            {{ result ? '下一步' : '开始核对' }}
          </button>
        </template>
        <button v-else-if="step === 6" class="btn primary" :disabled="busy" @click="doSave">
          确认导入
        </button>
        <button v-else class="btn primary" :disabled="busy" @click="next">下一步</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
/**
 * 业务数据导入面板（六步向导）
 *
 * 1 选文件 → 2 解析预览 → 3 字段映射 → 4 层级选择 → 5 校验匹配 → 6 命名存储
 * 产出写入 IndexedDB，由 businessDataStore 统一管理。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useBusinessDataStore } from '../stores/businessDataStore.js'
import {
  ACCEPT_EXT,
  LEVEL_TEXT,
  inferFieldConfigs,
  guessMapping,
  normalizeAdcode,
  inferLevelByAdcode,
  inferParentAdcode,
  isValidAdcode,
  parseFile
} from '../utils/dataParser.js'
import { matchAdcodes } from '../utils/regionTree.js'
import { downloadTemplate } from '../utils/dataTemplate.js'

const emit = defineEmits(['close', 'imported'])
const store = useBusinessDataStore()

const STEPS = [
  { no: 1, label: '选择文件' },
  { no: 2, label: '解析预览' },
  { no: 3, label: '字段映射' },
  { no: 4, label: '层级选择' },
  { no: 5, label: '校验匹配' },
  { no: 6, label: '命名存储' }
]

const LEVEL_OPTIONS = [
  { value: 'auto', label: '自动（按 adcode 结构判断）' },
  { value: 'province', label: '省级' },
  { value: 'city', label: '市级' },
  { value: 'district', label: '区县级' },
  { value: 'town', label: '镇级' },
  { value: 'village', label: '村级' }
]

/* ---------------- 状态 ---------------- */
const step = ref(1)
const dragging = ref(false)
const parsing = ref(false)
const validating = ref(false)
const saving = ref(false)
// 任一异步步骤进行中都禁用按钮，避免重复点击造成重复入库
const busy = computed(() => parsing.value || validating.value || saving.value)
const error = ref('')
const progressText = ref('准备核对…')

const fileInput = ref(null)
const rawFile = ref(null)
const fileInfo = ref(null)

/** 解析后的完整数据 */
const rows = ref([])
const columns = ref([])
const meta = reactive({ encoding: '—', kind: '' })

/** 步骤 3 的列映射 */
const mapping = reactive({ adcode: '', regionName: '', level: '', parentAdcode: '' })
/** 步骤 3 的字段配置，用户可以编辑 */
const fields = ref([])
/** 步骤 4 的层级模式 */
const levelMode = ref('auto')
/** 步骤 5 结果 */
const result = ref(null)
/** 是否保留未匹配记录 */
const keepUnmatched = ref(false)
/** 步骤 6 名称 */
const dataSetName = ref('')

/* ---------------- 模板下载 ---------------- */
/** 乡镇模板的区县编码，默认会宁县（620422） */
const tplAdcode = ref('620422')
const tplBusy = ref(false)
const tplMsg = ref('')
const tplBad = ref(false)

async function doDownload(kind) {
  tplBusy.value = true
  tplMsg.value = ''
  tplBad.value = false
  try {
    // 乡镇模板要按用户填的区县编码去 points 文件取值，这里先做一次格式兜底
    let arg
    if (kind === 'town') {
      const code = String(tplAdcode.value || '').trim()
      if (!/^\d{6}$/.test(code)) throw new Error('区县编码需为 6 位数字，如白银市会宁县为 620422')
      arg = code
    }
    const { file, count } = await downloadTemplate(kind, arg)
    tplMsg.value = `已下载「${file}」，含 ${count} 行真实区划数据，业务数值列已留空`
  } catch (e) {
    tplBad.value = true
    tplMsg.value = `模板下载失败：${(e && e.message) || e}`
  } finally {
    tplBusy.value = false
  }
}

/* ---------------- 步骤 1：选文件 ---------------- */
function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function pickFile() {
  if (fileInput.value) fileInput.value.click()
}

function takeFile(file) {
  error.value = ''
  rawFile.value = file
  fileInfo.value = {
    name: file.name,
    size: fmtSize(file.size),
    kind: (file.name.slice(file.name.lastIndexOf('.') || 0) || '').toUpperCase()
  }
}

function onPick(e) {
  const f = e.target.files && e.target.files[0]
  if (f) takeFile(f)
}

function onDrop(e) {
  dragging.value = false
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (!f) return
  const ext = (f.name.slice(f.name.lastIndexOf('.')) || '').toLowerCase()
  if (!ACCEPT_EXT.includes(ext)) {
    error.value = `不支持的文件类型 ${ext}，请上传 ${ACCEPT_EXT.join(' / ')}`
    return
  }
  takeFile(f)
}

/* ---------------- 步骤 2：解析 ---------------- */
async function doParse() {
  if (!rawFile.value) return
  parsing.value = true
  error.value = ''
  try {
    const res = await parseFile(rawFile.value)
    rows.value = res.rows
    columns.value = res.columns
    meta.encoding = res.encoding
    meta.kind = res.kind || meta.kind
    if (!res.rows.length) {
      error.value = '文件解析成功，但没有读取到任何数据行'
      return
    }
    // 依据初始值猜一次列用途，用户可以再改
    const guess = guessMapping(res.columns, res.rows)
    Object.assign(mapping, guess)
    step.value = 2
  } catch (e) {
    error.value = `解析失败：${(e && e.message) || e}`
    console.error('[DataImportPanel] parse', e)
  } finally {
    parsing.value = false
  }
}

const previewRows = computed(() => rows.value.slice(0, 5))
function short(v) {
  const s = v == null ? '' : String(v)
  return s.length > 24 ? `${s.slice(0, 24)}…` : s
}

/* ---------------- 步骤 3：字段配置同步 ---------------- */
/** 未被用作匹配列的其余列，即业务字段 */
const businessColumns = computed(() =>
  columns.value.filter((c) => c !== mapping.adcode && c !== mapping.regionName && c !== mapping.level && c !== mapping.parentAdcode)
)

/**
 * 同步业务字段列表。
 * 采取「保留已有配置」的合并策略：用户改过名称/单位后，再切换映射列不会丢失编辑结果。
 */
watch(
  businessColumns,
  (cols) => {
    const existing = new Map(fields.value.map((f) => [f.key, f]))
    const hasConfig = fields.value.length > 0
    if (!hasConfig) {
      // 首次进入：按采样值推断每个字段的展示格式
      fields.value = inferFieldConfigs(cols, rows.value)
      return
    }
    fields.value = cols.map((key, i) => {
      const old = existing.get(key)
      return old ? { ...old, key, order: i } : { key, label: key, unit: '', format: 'text', visible: true, order: i }
    })
  },
  { immediate: true }
)

const visibleCount = computed(() => fields.value.filter((f) => f.visible).length)

/** 上下移动：直接交换数组元素并重排 order */
function move(i, delta) {
  const j = i + delta
  if (j < 0 || j >= fields.value.length) return
  const arr = fields.value.slice()
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  arr.forEach((f, k) => (f.order = k))
  fields.value = arr
}

/* ---------------- 步骤 4：层级 ---------------- */
const levelSamples = computed(() =>
  rows.value.slice(0, 8).map((r) => {
    const raw = mapping.adcode ? r[mapping.adcode] : ''
    const code = normalizeAdcode(raw)
    const lv = levelMode.value === 'auto' ? inferLevelByAdcode(code) : levelMode.value
    return {
      raw: raw == null || raw === '' ? '—' : String(raw),
      code,
      text: code ? LEVEL_TEXT[lv] || '未知层级' : '编码无效',
      parent: code ? inferParentAdcode(code) : ''
    }
  })
)

const levelText = computed(() => {
  const o = LEVEL_OPTIONS.find((x) => x.value === levelMode.value)
  return o ? o.label.replace('（按 adcode 结构判断）', '') : levelMode.value
})

/* ---------------- 步骤 5：校验与匹配 ---------------- */
/** 把原始数据转成待入库记录（含有效 / 无效编码两类） */
const candidates = computed(() => {
  const out = []
  for (let i = 0; i < rows.value.length; i++) {
    const r = rows.value[i]
    const rawCode = mapping.adcode ? r[mapping.adcode] : ''
    const code = normalizeAdcode(rawCode)
    const data = {}
    for (const f of fields.value) data[f.key] = r[f.key]
    out.push({
      row: i + 2, // 表头占第 1 行，数据从第 2 行开始，便于用户回表查找
      adcode: code,
      rawCode: rawCode == null ? '' : String(rawCode),
      regionName: mapping.regionName ? String(r[mapping.regionName] || '').trim() : '',
      level: resolveLevel(r, code),
      parentAdcode: mapping.parentAdcode ? normalizeAdcode(r[mapping.parentAdcode]) : inferParentAdcode(code),
      data
    })
  }
  return out
})

/** 层级取值优先级：数据里的层级列 > 面板选定的层级模式 > 按编码自动推断 */
function resolveLevel(row, code) {
  if (mapping.level) {
    const v = String(row[mapping.level] || '').trim()
    const hit = Object.keys(LEVEL_TEXT).find((k) => LEVEL_TEXT[k] === v)
    if (hit) return hit
  }
  if (levelMode.value !== 'auto') return levelMode.value
  return code ? inferLevelByAdcode(code) : 'unknown'
}

async function doValidate() {
  validating.value = true
  error.value = ''
  progressText.value = '准备核对…'
  try {
    // 先在本地做纯数字校验，未通过的直接不算入核对请求
    const valid = candidates.value.filter((c) => c.adcode)
    const badFormat = candidates.value.filter((c) => !c.adcode)

    const { matched, missing, loadedFiles } = await matchAdcodes(
      valid.map((c) => c.adcode),
      levelMode.value,
      (msg) => (progressText.value = msg)
    )

    // 把「未命中」与「编码非法」合并成一份清单，统一回显给用户
    const missingList = []
    const reasonByCode = new Map(missing.map((m) => [m.adcode, m.reason]))
    for (const c of valid) {
      if (!matched.has(c.adcode)) {
        missingList.push({
          row: c.row,
          raw: c.rawCode,
          name: c.regionName,
          reason: reasonByCode.get(c.adcode) || '内置数据中查无此编码'
        })
      }
    }
    for (const c of badFormat) {
      missingList.push({
        row: c.row,
        raw: c.rawCode || '（空）',
        name: c.regionName,
        reason: '区域编码不是纯数字'
      })
    }

    // 命中集合留给「是否保留未匹配记录」开关实时重算，避免反复核对
    result.value = {
      matchedCount: valid.length - (missingList.length - badFormat.length),
      missingCount: missingList.length,
      total: candidates.value.length,
      missingList: missingList.slice(0, 10),
      files: loadedFiles,
      matchedSet: matched
    }
  } catch (e) {
    error.value = `核对失败：${(e && e.message) || e}`
    console.error('[DataImportPanel] validate', e)
  } finally {
    validating.value = false
  }
}

/* ---------------- 步骤 6：落库 ---------------- */

/**
 * 最终入库的记录列表。
 * 默认只保留「编码合法且命中内置区域」的记录；
 * 勾选「仍导入无法匹配的记录」后，编码合法但未命中的记录也会进来。
 * 编码非法的记录始终排除——没有有效 adcode 就无法挂到任何区域上。
 */
const importRecords = computed(() => {
  if (!result.value) return []
  if (keepUnmatched.value) return candidates.value.filter((c) => c.adcode)
  return candidates.value.filter((c) => c.adcode && result.value.matchedSet.has(c.adcode))
})
const importCount = computed(() => importRecords.value.length)
async function doSave() {
  if (!importCount.value) {
    error.value = '没有可入库的记录，请先核对数据或调整保留策略'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const records = importRecords.value.map(({ adcode, regionName, level, parentAdcode, data }) => ({
      adcode,
      regionName,
      level,
      parentAdcode,
      data
    }))
    const ds = await store.create({
      name: dataSetName.value || '未命名数据集',
      fields: fields.value.filter((f) => f.visible).map((f, i) => ({ ...f, order: i })),
      records,
      level: levelMode.value
    })
    if (ds) {
      emit('imported', ds)
      emit('close')
    } else {
      error.value = store.error || '导入失败，请重试'
    }
  } catch (e) {
    error.value = `导入失败：${(e && e.message) || e}`
  } finally {
    saving.value = false
  }
}

/* ---------------- 导航 ---------------- */
function next() {
  if (step.value < 6) step.value++
}
function back() {
  if (step.value === 1) emit('close')
  else step.value--
}
</script>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: rgba(3, 6, 14, 0.72);
  backdrop-filter: blur(6px);
}
.modal {
  width: min(920px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 16px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(56, 189, 248, 0.16);
}
.title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--text-0);
  flex: none;
}
.steps {
  display: flex;
  align-items: center;
  gap: 4px;
  list-style: none;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.step {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-1);
  white-space: nowrap;
}
.step .dot {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  border: 1px solid rgba(56, 189, 248, 0.3);
}
.step.on {
  color: var(--accent-2);
}
.step.on .dot {
  background: rgba(34, 211, 238, 0.18);
  border-color: var(--accent-2);
}
.step.done {
  color: var(--text-0);
}
.step.done .dot {
  background: rgba(34, 197, 94, 0.18);
  border-color: rgba(34, 197, 94, 0.5);
}
.x {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: var(--text-0);
  font-size: 17px;
  line-height: 1;
}
.x:hover {
  background: rgba(255, 255, 255, 0.1);
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 拖拽区 */
.drop {
  border: 1px dashed rgba(56, 189, 248, 0.4);
  border-radius: 14px;
  padding: 34px 20px;
  text-align: center;
  color: var(--text-1);
  background: rgba(56, 189, 248, 0.04);
  transition: border-color 0.2s, background 0.2s;
}
.drop:hover,
.drop.over {
  border-color: var(--accent-2);
  background: rgba(56, 189, 248, 0.09);
}
.drop.busy {
  opacity: 0.6;
}
.drop svg {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.dp1 {
  margin-top: 8px;
  font-size: 14px;
  color: var(--text-0);
}
.dp2 {
  margin-top: 5px;
  font-size: 12px;
}
.hidden-input {
  display: none;
}
.file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.18);
  font-size: 13px;
}
.fname {
  color: var(--text-0);
  font-weight: 600;
}
.fsize,
.fkind {
  color: var(--text-1);
  font-size: 12px;
}

/* 通用文本 */
.tip {
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-1);
}
.tip code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.12);
  color: var(--accent-2);
  font-size: 11px;
}
.warn {
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  color: #fcd34d;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.3);
}
.err {
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.32);
}
.ok-line {
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  color: #86efac;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.dim {
  font-size: 12px;
  color: var(--text-1);
}
.meta-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.pill {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  color: var(--text-1);
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.18);
}

/* 表格 */
.table-wrap {
  max-height: 300px;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid rgba(56, 189, 248, 0.16);
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.grid th,
.grid td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid rgba(56, 189, 248, 0.12);
  white-space: nowrap;
}
.grid th {
  position: sticky;
  top: 0;
  color: var(--accent);
  background: rgba(10, 20, 38, 0.96);
  font-weight: 600;
}
.grid td {
  color: var(--text-1);
}
.grid .idx {
  color: var(--text-1);
  opacity: 0.6;
  width: 42px;
}
.grid.compact th,
.grid.compact td {
  padding: 5px 8px;
}

/* 表单控件 */
.map-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
}
.fld.block {
  width: 100%;
}
.lb {
  color: var(--text-1);
}
.lb em {
  font-style: normal;
  font-size: 11px;
  color: var(--accent-2);
  margin-left: 4px;
}
select,
.ipt {
  height: 30px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid rgba(56, 189, 248, 0.22);
  background: rgba(5, 12, 24, 0.7);
  color: var(--text-0);
  font-size: 12px;
  font-family: inherit;
}
.ipt.wide {
  width: 100%;
}
select:focus,
.ipt:focus {
  outline: none;
  border-color: var(--accent-2);
}

/* 字段列表 */
.sub-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 4px;
}
.sub-head h4 {
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 1px;
}
.cnt {
  font-size: 11px;
  color: var(--text-1);
}
.fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
  padding-right: 2px;
}
.frow {
  display: grid;
  grid-template-columns: 20px minmax(90px, 1.2fr) minmax(110px, 1.3fr) 84px 88px 52px;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: 8px;
  background: rgba(56, 189, 248, 0.06);
  border: 1px solid rgba(56, 189, 248, 0.14);
}
.frow.off {
  opacity: 0.45;
}
.ck {
  width: 14px;
  height: 14px;
  accent-color: var(--accent-2);
}
.fkey {
  font-size: 12px;
  color: var(--text-0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ipt.unit {
  width: 100%;
}
.mv {
  display: inline-flex;
  gap: 3px;
}
.mv button {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(56, 189, 248, 0.2);
  background: transparent;
  color: var(--text-1);
  font-size: 11px;
  line-height: 1;
}
.mv button:hover:not(:disabled) {
  color: var(--text-0);
  border-color: var(--accent-2);
}
.mv button:disabled {
  opacity: 0.3;
}

/* 校验结果 */
.progress {
  font-size: 12px;
  color: var(--accent-2);
}
.stat-row {
  display: flex;
  gap: 10px;
}
.sb {
  flex: 1;
  padding: 12px;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.06);
  border: 1px solid rgba(56, 189, 248, 0.16);
  text-align: center;
}
.sb.ok {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.08);
}
.sb.bad {
  border-color: rgba(239, 68, 68, 0.32);
  background: rgba(239, 68, 68, 0.08);
}
.sbk {
  font-size: 11px;
  color: var(--text-1);
}
.sbv {
  margin-top: 3px;
  font-size: 22px;
  font-weight: 700;
  color: var(--text-0);
  font-variant-numeric: tabular-nums;
}
.sbs {
  font-size: 11px;
  color: var(--text-1);
}
.miss h4,
.sample h4 {
  font-size: 12px;
  color: #fcd34d;
  letter-spacing: 1px;
  margin-bottom: 6px;
}
.ck-line {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-1);
}
.ck-line input {
  width: 14px;
  height: 14px;
  accent-color: var(--accent-2);
}

/* 底部 */
.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid rgba(56, 189, 248, 0.16);
}
.spacer {
  flex: 1;
}
.busy {
  font-size: 12px;
  color: var(--accent-2);
}
.btn {
  height: 32px;
  padding: 0 18px;
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
}
.btn:hover:not(:disabled) {
  color: var(--text-0);
  border-color: var(--accent-2);
}
.btn.primary {
  color: #04121f;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  border-color: transparent;
  font-weight: 600;
}
/* 模板下载区 */
.tpl {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px dashed rgba(56, 189, 248, 0.3);
  background: rgba(56, 189, 248, 0.05);
}
.tpl-head h4 {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-0);
}
.tpl-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-1);
}
.tpl-desc strong {
  color: var(--accent-2);
  font-weight: 600;
}
.tpl-row {
  margin-top: 12px;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.tpl-adcode {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tpl-adcode span {
  font-size: 11px;
  color: var(--text-1);
}
.tpl-adcode .ipt {
  width: 92px;
}
.tpl-msg {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: #86efac;
}
.tpl-msg.bad {
  color: #fca5a5;
}
.btn:disabled {
  opacity: 0.4;
}
</style>
