<template>
  <div class="mask" @click.self="$emit('close')">
    <div class="modal" role="dialog" aria-label="导入军事要素">
      <header class="head">
        <h3 class="title">导入军事要素</h3>
        <ol class="steps">
          <li v-for="s in STEPS" :key="s.no" class="step" :class="{ on: s.no === step, done: s.no < step }">
            <span class="dot">{{ s.no }}</span>
            <span class="st">{{ s.label }}</span>
          </li>
        </ol>
        <button class="x" title="关闭" @click="$emit('close')">×</button>
      </header>

      <div class="body">
        <!-- ---------- 1：选文件 + 模板 ---------- -->
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
            <p class="dp1">{{ parsing ? '正在解析…' : '拖拽文件到此处，或点击选择' }}</p>
            <p class="dp2">支持 CSV、Excel（.xlsx / .xls）、GeoJSON</p>
            <input
              ref="fileInput"
              type="file"
              class="hidden-input"
              accept=".csv,.xlsx,.xls,.json,.geojson"
              @change="onPick"
            />
          </div>
          <p v-if="fileInfo" class="file-card">
            <span class="fname">{{ fileInfo.name }}</span>
            <span class="fsize">{{ fileInfo.size }}</span>
            <span class="fkind">{{ fileInfo.kind }}</span>
          </p>
          <p v-if="error" class="err">{{ error }}</p>

          <div class="tpl">
            <div class="tpl-head">
              <h4>还没有数据？先下载模板</h4>
              <p class="tpl-desc">
                模板预填<strong>真实行政区划代码与乡镇点位坐标</strong>（与本站底图同源），
                涉及史实的内容（名称、阵营、兵力、时期）一律留空待填——这些只能由你提供，系统不代填。
              </p>
            </div>
            <div class="tpl-row">
              <label class="tpl-adcode">
                <span>所属区县编码</span>
                <input v-model="tplAdcode" class="ipt" maxlength="6" placeholder="620422" />
              </label>
              <button v-for="t in TEMPLATES" :key="t.key" class="btn" :disabled="tplBusy" @click="doDownload(t.key)">
                下载{{ t.label }}
              </button>
            </div>
            <p v-if="tplMsg" class="tpl-msg" :class="{ bad: tplBad }">{{ tplMsg }}</p>

            <details class="how">
              <summary>字段怎么填（点开看说明）</summary>
              <table class="grid compact">
                <thead>
                  <tr><th>字段</th><th>说明</th></tr>
                </thead>
                <tbody>
                  <tr v-for="f in FIELDS" :key="f.key">
                    <td>{{ f.label }}<em v-if="f.required" class="req">必填</em></td>
                    <td>{{ f.desc }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="note">
                折线类要素（行军路线 / 战线）：同一「要素名称 + 阵营 + 时期」的多行按<strong>序号</strong>
                连成一条路线，因此务必填<strong>时期</strong>区分年代。
              </p>
            </details>
          </div>
        </section>

        <!-- ---------- 2：字段映射 ---------- -->
        <section v-else-if="step === 2" class="pane">
          <div class="meta-row">
            <span class="pill">共 {{ rows.length }} 行</span>
            <span class="pill">共 {{ columns.length }} 列</span>
            <span v-if="fileInfo && fileInfo.encoding" class="pill">编码 {{ fileInfo.encoding }}</span>
          </div>
          <p class="lead">确认每一列对应哪个字段。系统已按列名自动推断，不对的地方手动改。</p>

          <div class="map-grid">
            <div v-for="f in MIL_FIELDS" :key="f.key" class="fld">
              <label class="lb">{{ f.label }}<em v-if="f.required">必填</em></label>
              <select v-model="mapping[f.key]">
                <option value="">— 不导入 —</option>
                <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
          </div>

          <div class="sub-head">
            <h4>数据预览</h4>
            <span class="cnt">前 {{ previewRows.length }} 行</span>
          </div>
          <div class="table-wrap">
            <table class="grid compact">
              <thead>
                <tr>
                  <th class="idx">#</th>
                  <th v-for="c in columns" :key="c">{{ c }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in previewRows" :key="i">
                  <td class="idx">{{ i + 1 }}</td>
                  <td v-for="c in columns" :key="c">{{ brief(r[c]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="error" class="err">{{ error }}</p>
        </section>

        <!-- ---------- 3：校验与入库 ---------- -->
        <section v-else class="pane">
          <div class="meta-row">
            <span class="pill ok">可导入 {{ result.features.length }} 个要素</span>
            <span v-if="result.errors.length" class="pill bad">跳过 {{ result.errors.length }} 行</span>
            <span v-if="result.warnings.length" class="pill warn">提醒 {{ result.warnings.length }} 条</span>
          </div>

          <div v-if="statRows.length" class="kinds">
            <span v-for="k in statRows" :key="k.key" class="kpill" :style="{ '--kc': k.color }">
              <i></i>{{ k.label }} {{ k.n }}
            </span>
          </div>

          <div v-if="result.errors.length" class="log bad-box">
            <h4>未导入的行</h4>
            <ul><li v-for="(e, i) in result.errors.slice(0, 8)" :key="i">{{ e }}</li></ul>
            <p v-if="result.errors.length > 8" class="more">…另有 {{ result.errors.length - 8 }} 条</p>
          </div>
          <div v-if="result.warnings.length" class="log warn-box">
            <h4>提醒</h4>
            <ul><li v-for="(w, i) in result.warnings.slice(0, 8)" :key="i">{{ w }}</li></ul>
            <p v-if="result.warnings.length > 8" class="more">…另有 {{ result.warnings.length - 8 }} 条</p>
          </div>

          <div class="table-wrap">
            <table class="grid compact">
              <thead>
                <tr><th class="idx">#</th><th>名称</th><th>类型</th><th>阵营</th><th>时期</th><th>定位</th></tr>
              </thead>
              <tbody>
                <tr v-for="(f, i) in result.features.slice(0, 12)" :key="i">
                  <td class="idx">{{ i + 1 }}</td>
                  <td>{{ f.name }}</td>
                  <td>{{ kindLabel(f.kind) }}</td>
                  <td>{{ f.side || '—' }}</td>
                  <td>{{ f.era || '—' }}</td>
                  <td>{{ locate(f) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="fld block">
            <label class="lb">数据集名称<em>用于区分不同年代 / 不同来源的态势</em></label>
            <input v-model="setName" class="ipt wide" maxlength="40" placeholder="例如：1936 年秋 会宁周边布防" />
          </div>
          <p v-if="error" class="err">{{ error }}</p>
        </section>
      </div>

      <footer class="foot">
        <button class="btn ghost" @click="$emit('close')">取消</button>
        <button v-if="step > 1" class="btn" @click="step--">上一步</button>
        <button v-if="step === 2" class="btn primary" :disabled="busy" @click="doValidate">
          {{ busy ? '校验中…' : '下一步：校验' }}
        </button>
        <button v-else-if="step === 3" class="btn primary" :disabled="busy || !result.features.length" @click="doImport">
          {{ busy ? '写入中…' : `导入 ${result.features.length} 个要素` }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { parseFile } from '../utils/dataParser.js'
import {
  MIL_FIELDS,
  MIL_KINDS,
  milKind,
  guessMilMapping,
  rowsToMilFeatures,
  geoJsonToMilFeatures,
  normalizeMilAdcode,
  resolveAdcodeCenters
} from '../utils/militarySchema.js'
import { MIL_TEMPLATES, downloadMilTemplate } from '../utils/militaryTemplate.js'

const emit = defineEmits(['close', 'imported'])

const STEPS = [
  { no: 1, label: '选择文件' },
  { no: 2, label: '字段映射' },
  { no: 3, label: '校验入库' }
]

/** 步骤 1 里给用户看的字段说明 */
const FIELDS = [
  { key: 'name', label: '要素名称', required: true, desc: '驻地 / 阵地 / 路线名，同一路线的多点填同一个名称' },
  { key: 'kind', label: '要素类型', required: false, desc: '驻军 / 布防 / 行军路线 / 战线 / 关隘 / 堡寨 / 营地 / 战场 / 补给 / 指挥所；空则按未分类' },
  { key: 'side', label: '阵营 / 部队', required: false, desc: '所属方面或部队番号，用于图面区分敌我' },
  { key: 'era', label: '时期', required: false, desc: '年代标签，如「1936 年会师时期」；同一地点的不同年代靠它区分' },
  { key: 'date', label: '时间', required: false, desc: '具体到日的时间，如 1936.10.08' },
  { key: 'lng', label: '经度', required: false, desc: '十进制度；与纬度二选一必填，否则靠行政区划代码定位' },
  { key: 'lat', label: '纬度', required: false, desc: '十进制度；注意不要与经度写反' },
  { key: 'adcode', label: '行政区划代码', required: false, desc: '没有经纬度时填此项，系统按公开区划数据反查中心点' },
  { key: 'seq', label: '序号', required: false, desc: '仅折线类需要：同一路线内按此顺序连点' },
  { key: 'strength', label: '兵力', required: false, desc: '兵力规模，纯文本，不做单位换算' },
  { key: 'commander', label: '指挥官', required: false, desc: '主官姓名' },
  { key: 'note', label: '备注', required: false, desc: '补充说明 / 史料出处，点击要素时一并显示' }
]

const TEMPLATES = MIL_TEMPLATES

const step = ref(1)
const dragging = ref(false)
const parsing = ref(false)
const busy = ref(false)
const error = ref('')
const fileInput = ref(null)
const fileInfo = ref(null)
const tplAdcode = ref('620422')
const tplBusy = ref(false)
const tplMsg = ref('')
const tplBad = ref(false)
const setName = ref('')

const rows = ref([])
const columns = ref([])
const mapping = ref({})
const result = ref({ features: [], errors: [], warnings: [] })

const previewRows = computed(() => rows.value.slice(0, 6))

const statRows = computed(() => {
  const out = []
  for (const k of MIL_KINDS) {
    const n = (result.value.features || []).filter((f) => f.kind === k.key).length
    if (n) out.push({ key: k.key, label: k.label, color: k.color, n })
  }
  return out
})

function kindLabel(key) {
  return milKind(key).label
}

function locate(f) {
  if (f.shape === 'line') return `${f.path.length} 点折线`
  if (f.point) return `${f.point.lng.toFixed(4)}, ${f.point.lat.toFixed(4)}`
  return '未定位'
}

function brief(v) {
  const s = v == null ? '' : String(v)
  return s.length > 18 ? s.slice(0, 18) + '…' : s
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/* ---------- 模板下载 ---------- */
async function doDownload(kind) {
  tplBusy.value = true
  tplMsg.value = ''
  tplBad.value = false
  try {
    const code = /^\d{6}$/.test(tplAdcode.value.trim()) ? tplAdcode.value.trim() : '620422'
    const r = await downloadMilTemplate(kind, code)
    tplMsg.value = `已下载「${r.file}」：${kind === 'geojson' ? `${r.count} 个示例要素` : `${r.count} 行`}`
  } catch (e) {
    tplBad.value = true
    tplMsg.value = `下载失败：${(e && e.message) || e}`
  } finally {
    tplBusy.value = false
  }
}

/* ---------- 文件 ---------- */
function pickFile() {
  if (fileInput.value) fileInput.value.click()
}

function onDrop(e) {
  dragging.value = false
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (f) handleFile(f)
}

function onPick(e) {
  const f = e.target.files && e.target.files[0]
  if (f) handleFile(f)
  e.target.value = ''
}

async function handleFile(file) {
  error.value = ''
  parsing.value = true
  try {
    const p = await parseFile(file)
    rows.value = p.rows || []
    columns.value = p.columns || []
    fileInfo.value = {
      name: file.name,
      size: fmtSize(file.size),
      kind: p.kind || '表格',
      encoding: p.encoding || ''
    }
    if (!rows.value.length) throw new Error('文件里没有数据行')

    // GeoJSON：几何自带坐标与属性，不需要列映射
    const isGeo = rows.value.some((r) => r && r.geometry)
    if (isGeo) {
      const g = geoJsonToMilFeatures(rows.value, {})
      result.value = { features: g.features, errors: g.errors, warnings: g.warnings }
      setName.value = file.name.replace(/\.[^.]+$/, '')
      step.value = 3
      return
    }

    mapping.value = guessMilMapping(columns.value)
    if (!mapping.value.name) error.value = '未识别到名称列，请在下一步手动指定'
    step.value = 2
  } catch (e) {
    error.value = `解析失败：${(e && e.message) || e}`
    rows.value = []
    columns.value = []
  } finally {
    parsing.value = false
  }
}

/* ---------- 校验 ---------- */
async function doValidate() {
  error.value = ''
  busy.value = true
  try {
    if (!mapping.value.name) throw new Error('请至少指定「要素名称」对应的列')
    // 先跑一遍：只为拿到「只有 adcode 没有坐标」的代码清单
    const first = rowsToMilFeatures(rows.value, mapping.value, {})
    let out = first
    if (first.needAdcode.length) {
      const { resolved, failed } = await resolveAdcodeCenters(first.needAdcode)
      if (mapping.value.lng && mapping.value.lat) {
        // 把反查到的中心点回填进原行，再整体重算（折线也要用补出来的点）
        for (const row of rows.value) {
          const code = normalizeMilAdcode(row[mapping.value.adcode])
          if (!code) continue
          if (String(row[mapping.value.lng] || '').trim() || String(row[mapping.value.lat] || '').trim()) continue
          const p = resolved.get(code)
          if (p) {
            row[mapping.value.lng] = String(p.lng)
            row[mapping.value.lat] = String(p.lat)
          }
        }
        out = rowsToMilFeatures(rows.value, mapping.value, {})
      }
      if (failed.length) {
        out.warnings = [...out.warnings, `以下行政区划代码反查不到中心点：${failed.join('、')}`]
      }
    }
    result.value = out
    if (!out.features.length) {
      error.value = '没有可导入的要素：请检查坐标 / 行政区划代码与名称列'
      return
    }
    if (!setName.value) setName.value = (fileInfo.value && fileInfo.value.name || '').replace(/\.[^.]+$/, '')
    step.value = 3
  } catch (e) {
    error.value = `校验失败：${(e && e.message) || e}`
  } finally {
    busy.value = false
  }
}

async function doImport() {
  error.value = ''
  busy.value = true
  try {
    const name = setName.value.trim() || '未命名军事要素集'
    emit('imported', { name, features: result.value.features })
    emit('close')
  } catch (e) {
    error.value = `导入失败：${(e && e.message) || e}`
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(4, 10, 20, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(3px);
}
:global(:root.theme-paper) .mask {
  background: rgba(60, 44, 24, 0.35);
}
.modal {
  width: min(880px, 92vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--panel-border);
}
.title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-0);
  letter-spacing: 1px;
}
.steps {
  display: flex;
  gap: 14px;
  list-style: none;
  margin-left: auto;
}
.step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-1);
}
.step .dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  border: 1px solid var(--panel-border);
}
.step.on {
  color: var(--accent);
}
.step.on .dot {
  border-color: var(--accent);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.4);
}
.step.done .dot {
  background: var(--accent);
  color: #04101f;
  border-color: transparent;
}
.x {
  background: none;
  border: none;
  color: var(--text-1);
  font-size: 20px;
  line-height: 1;
}
.body {
  flex: 1;
  overflow: auto;
  padding: 16px 18px;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.drop {
  border: 1.5px dashed var(--panel-border);
  border-radius: 12px;
  padding: 26px;
  text-align: center;
  color: var(--text-1);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.drop:hover,
.drop.over {
  border-color: var(--accent);
  background: rgba(56, 189, 248, 0.06);
}
.drop svg {
  stroke: currentColor;
  fill: none;
  stroke-width: 1.6;
  opacity: 0.7;
}
.dp1 {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-0);
}
.dp2 {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.75;
}
.hidden-input {
  display: none;
}
.file-card {
  display: flex;
  gap: 12px;
  align-items: baseline;
  font-size: 12px;
  color: var(--text-1);
}
.fname {
  color: var(--text-0);
}
.err {
  color: #ff8a8a;
  font-size: 12px;
}
:global(:root.theme-paper) .err {
  color: #a83232;
}
.tpl {
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tpl-head h4 {
  font-size: 13px;
  color: var(--text-0);
}
.tpl-desc {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-1);
}
.tpl-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.tpl-adcode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-1);
}
.tpl-msg {
  font-size: 12px;
  color: var(--accent);
}
.tpl-msg.bad {
  color: #ff8a8a;
}
.how summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--accent);
}
.how .note {
  margin-top: 8px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-1);
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pill {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  color: var(--text-1);
}
.pill.ok {
  color: var(--accent);
  border-color: var(--accent);
}
.pill.bad {
  color: #ff8a8a;
  border-color: rgba(255, 138, 138, 0.5);
}
.pill.warn {
  color: #ffc46b;
  border-color: rgba(255, 196, 107, 0.5);
}
.lead {
  font-size: 12px;
  color: var(--text-1);
}
.map-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
  margin-left: 5px;
}
.req {
  font-style: normal;
  font-size: 10px;
  color: var(--accent-2);
  margin-left: 4px;
}
select,
.ipt {
  height: 30px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--panel-border);
  background: rgba(5, 12, 24, 0.6);
  color: var(--text-0);
  font-size: 12px;
  font-family: inherit;
}
:global(:root.theme-paper) select,
:global(:root.theme-paper) .ipt {
  background: rgba(255, 252, 240, 0.75);
}
.ipt.wide {
  width: 100%;
}
.sub-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
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
.table-wrap {
  max-height: 240px;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid var(--panel-border);
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
  border-bottom: 1px solid var(--panel-border);
  white-space: nowrap;
}
.grid th {
  position: sticky;
  top: 0;
  color: var(--accent);
  background: var(--panel-bg);
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
.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.kpill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  color: var(--text-0);
}
.kpill i {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--kc);
}
.log {
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 11.5px;
  line-height: 1.8;
}
.log h4 {
  font-size: 12px;
  margin-bottom: 4px;
}
.log ul {
  margin: 0;
  padding-left: 18px;
}
.bad-box {
  border: 1px solid rgba(255, 138, 138, 0.4);
  color: #ffb4b4;
  background: rgba(255, 90, 90, 0.08);
}
.warn-box {
  border: 1px solid rgba(255, 196, 107, 0.4);
  color: #ffd79a;
  background: rgba(255, 180, 80, 0.08);
}
:global(:root.theme-paper) .bad-box {
  color: #8e2f2f;
}
:global(:root.theme-paper) .warn-box {
  color: #7a5420;
}
.more {
  opacity: 0.7;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--panel-border);
}
.btn {
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--panel-border);
  background: transparent;
  color: var(--text-1);
}
.btn:hover {
  color: var(--text-0);
  border-color: var(--accent);
}
.btn.primary {
  color: #04101f;
  background: var(--accent);
  border-color: var(--accent);
}
.btn.ghost {
  border-color: transparent;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
