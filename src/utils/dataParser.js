/**
 * 数据解析工具
 *
 * 负责：文件读取（CSV / Excel / JSON）、编码自动识别、adcode 规范化、
 *       层级判定、字段配置推断、按格式格式化数值。
 *
 * 不使用 TypeScript，所有数据模型用 JSDoc typedef 描述。
 */
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

/* ------------------------------------------------------------------ */
/* 数据模型（JSDoc）                                                    */
/* ------------------------------------------------------------------ */

/**
 * @typedef {'number'|'percent'|'text'|'currency'} FieldFormat 字段展示格式
 */

/**
 * 字段配置：描述业务字段在信息面板里如何展示
 * @typedef {Object} FieldConfig
 * @property {string} key   原始列名（对应 BusinessRecord.data 的键）
 * @property {string} label 显示名称，用户可编辑
 * @property {string} unit  单位，如「万元」
 * @property {FieldFormat} format 展示格式
 * @property {boolean} visible 是否在面板中展示
 * @property {number} order 展示顺序，升序
 */

/**
 * 数据集元信息
 * @typedef {Object} BusinessDataSet
 * @property {string} id uuid
 * @property {string} name 用户命名，如「2024年经济数据」
 * @property {number} createdAt 创建时间戳
 * @property {number} recordCount 记录条数
 * @property {FieldConfig[]} fields 字段配置
 * @property {boolean} isActive 是否激活（面板中展示）
 * @property {string} [level] 数据集主层级：province / city / district / town / village / auto
 */

/**
 * 单条业务记录
 * @typedef {Object} BusinessRecord
 * @property {string} adcode 区域编码，用于匹配地图区域
 * @property {string} regionName 区域名称，备用匹配
 * @property {string} level 层级
 * @property {string} [parentAdcode] 父级编码
 * @property {Object<string, any>} data 动态业务字段
 * @property {string} [datasetId] 所属数据集（入库时补写）
 */

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

/** 支持的扩展名 */
export const ACCEPT_EXT = ['.csv', '.xlsx', '.xls', '.json']

/** 自动识别 adcode 列的候选列名（小写比较） */
const ADCODE_ALIASES = ['adcode', '行政区划代码', '区划代码', '行政代码', '区域编码', '区域代码', '区划码', '代码', 'code']
/** 自动识别区域名列的候选列名 */
const NAME_ALIASES = ['region_name', 'regionname', 'name', '区域名称', '区域名', '地区名称', '行政区划名称', '名称', '地名']
/** 自动识别层级列的候选列名 */
const LEVEL_ALIASES = ['level', '层级', '行政层级', '级别']
/** 自动识别父级编码列的候选列名 */
const PARENT_ALIASES = ['parent_adcode', 'parentadcode', 'parent_code', '父级编码', '父级代码', '上级编码', '上级代码']

/** 层级中文名，与 ThreeMap 现有口径对齐 */
export const LEVEL_TEXT = {
  province: '省级',
  city: '市级',
  district: '区县级',
  town: '镇级',
  village: '村级'
}

/* ------------------------------------------------------------------ */
/* 文件读取与编码识别                                                    */
/* ------------------------------------------------------------------ */

/**
 * 自动识别文本编码：优先 UTF-8（非严格模式），出现替换字符 U+FFFD 则判为 GBK 重解。
 * 国内政务表格大量为 GBK，这一步能避免中文列名乱码。
 * @param {ArrayBuffer} buf
 * @returns {{text: string, encoding: string}}
 */
export function decodeBuffer(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('\uFFFD')) return { text: utf8, encoding: 'UTF-8' }
  try {
    return { text: new TextDecoder('gbk').decode(buf), encoding: 'GBK' }
  } catch (e) {
    // 极旧浏览器无 GBK 解码器时退回 UTF-8，至少不抛错
    return { text: utf8, encoding: 'UTF-8（疑似 GBK，解码失败）' }
  }
}

/**
 * 去掉 UTF-8 BOM。
 * 本站下载的模板为了 Excel 不乱码带了 BOM，若不剥掉，PapaParse 会把 \uFEFF 粘在
 * 第一个列名上（变成 "\uFEFF行政区划代码"），导致后续按表名取列全部失败。
 * @param {string} s
 * @returns {string}
 */
export function stripBom(s) {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/**
 * 读取文件为 ArrayBuffer
 * @param {File} file
 */
function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('文件读取失败'))
    fr.readAsArrayBuffer(file)
  })
}

/**
 * 解析上传文件，统一返回「行对象数组」
 * @param {File} file
 * @returns {Promise<{rows: Object[], columns: string[], encoding: string, kind: string}>}
 */
export async function parseFile(file) {
  const ext = (file.name.slice(file.name.lastIndexOf('.')) || '').toLowerCase()
  if (!ACCEPT_EXT.includes(ext)) {
    throw new Error(`不支持的文件类型 ${ext}，请上传 ${ACCEPT_EXT.join(' / ')}`)
  }

  if (ext === '.xlsx' || ext === '.xls') return parseExcel(file)

  const buf = await readAsArrayBuffer(file)
  const { text, encoding } = decodeBuffer(buf)
  if (ext === '.json') return { ...parseJson(text), encoding, kind: 'JSON' }
  return { ...parseCsv(text), encoding, kind: 'CSV' }
}

/**
 * CSV 解析：自动推断分隔符、跳过全空行。
 * 注意不做 dynamicTyping，数字保持字符串，避免 adcode 前导零丢失。
 */
function parseCsv(text) {
  const res = Papa.parse(stripBom(text), {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    transformHeader: (h) => String(h).trim()
  })
  if (res.errors && res.errors.length) {
    // 只挑第一条提示给用户，PapaParse 的错误对象不带 message 字段
    const e = res.errors[0]
    console.warn('[dataParser] CSV 解析告警', e)
  }
  const columns = (res.meta.fields || []).filter(Boolean)
  return { rows: sanitizeRows(res.data), columns }
}

/** JSON：支持顶层数组或 { data: [...] } 包裹两种形态 */
function parseJson(text) {
  let obj
  try {
    obj = JSON.parse(stripBom(text))
  } catch (e) {
    throw new Error('JSON 格式错误，无法解析')
  }
  const rows = Array.isArray(obj) ? obj : Array.isArray(obj.data) ? obj.data : null
  if (!rows) throw new Error('JSON 顶层需为数组，或形如 { "data": [...] }')
  const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r || {}))))
  return { rows: sanitizeRows(rows), columns }
}

/**
 * Excel 解析。
 * 关键：raw:false 取单元格「格式化后的文本」而非原始数值，
 * 这样 adcode 列不会变成 620422 之外的浮点或科学计数法。
 */
async function parseExcel(file) {
  const buf = await readAsArrayBuffer(file)
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellFormula: false, cellHTML: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('未找到工作表')
  const sheet = wb.Sheets[sheetName]
  // 多工作表时提示只取第一张，避免用户误以为全量导入
  const rowsRaw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const columns = Array.from(new Set(rowsRaw.flatMap((r) => Object.keys(r))))
  return {
    rows: sanitizeRows(rowsRaw),
    columns,
    encoding: '—',
    kind: `Excel（${sheetName}${wb.SheetNames.length > 1 ? `，共 ${wb.SheetNames.length} 张表，仅取首张` : ''}）`
  }
}

/**
 * 安全兜底：剔除 __proto__ / constructor / prototype 等危险键。
 * xlsx@0.18.5 存在 CVE-2023-30533 原型污染风险（新版需从 SheetJS 官方 CDN 安装），
 * 这里在解析出口统一清洗，作为降级安装时的缓解措施。
 * @param {Object[]} rows
 */
function sanitizeRows(rows) {
  const BLOCK = new Set(['__proto__', 'constructor', 'prototype'])
  return rows.map((row) => {
    const out = {}
    if (!row || typeof row !== 'object') return out
    for (const [k, v] of Object.entries(row)) {
      if (BLOCK.has(k)) continue
      out[String(k).trim()] = typeof v === 'string' ? v.trim() : v
    }
    return out
  })
}

/* ------------------------------------------------------------------ */
/* adcode 规范化与层级判定                                              */
/* ------------------------------------------------------------------ */

/**
 * 规范化 adcode 为纯数字字符串，非法则返回空串。
 * 处理场景：
 *   1) Excel 数值列读出 "620422" / "620422.0"
 *   2) 科学计数法 "6.2E+5"
 *   3) 含空格、全角空格、横线
 * @param {any} raw
 * @returns {string}
 */
export function normalizeAdcode(raw) {
  if (raw == null) return ''
  let s = String(raw).replace(/[\s\u3000-]/g, '')
  if (!s) return ''
  // 6.20422E+5 形态：转回整数再说
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const n = Number(s)
    if (!Number.isFinite(n) || n >= 1e15) return ''
    s = BigInt(Math.round(n)).toString()
  }
  // 620422.0 → 620422
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '')
  // 纯小数（如 0.62）不是合法 adcode
  if (/^\d+\.\d+$/.test(s)) return ''
  return /^\d+$/.test(s) ? s : ''
}

/**
 * 校验 adcode 是否为纯数字（spec 要求导入前先校验）
 * @param {any} raw
 */
export function isValidAdcode(raw) {
  return normalizeAdcode(raw) !== ''
}

/**
 * 依据 adcode 长度判定层级。
 * 口径按民政部 / DataV 行政区划编码规范：
 *   6 位且形如 XX0000  → 省级
 *   6 位且形如 XXXX00  → 市级
 *   6 位其它           → 区县级
 *   9 / 12 位          → 镇级（统计用区划码）
 *   12 位以上          → 村级
 * （spec 原文写的「6位→省级」口径有误，这里以编码规范为准）
 * @param {string} adcode
 * @returns {'province'|'city'|'district'|'town'|'village'|'unknown'}
 */
export function inferLevelByAdcode(adcode) {
  const c = normalizeAdcode(adcode)
  if (!c) return 'unknown'
  if (c.length === 6) {
    if (/^\d{2}0{4}$/.test(c)) return 'province'
    if (/^\d{4}0{2}$/.test(c)) return 'city'
    return 'district'
  }
  if (c.length === 9 || c.length === 12) return 'town'
  if (c.length > 12) return 'village'
  return 'unknown'
}

/**
 * 推断该 adcode 的父级编码（省级无父级）
 * @param {string} adcode
 */
export function inferParentAdcode(adcode) {
  const c = normalizeAdcode(adcode)
  if (!c) return ''
  if (c.length === 6) {
    if (/^\d{2}0{4}$/.test(c)) return ''
    if (/^\d{4}0{2}$/.test(c)) return `${c.slice(0, 2)}0000`
    return `${c.slice(0, 4)}00`
  }
  if (c.length >= 9) return c.slice(0, 6)
  return ''
}

/* ------------------------------------------------------------------ */
/* 列识别与字段配置                                                      */
/* ------------------------------------------------------------------ */

/**
 * 判断某单元格值是否「长得像行政区划编码」。
 * 关键点：不能只看是否纯数字——像「下辖村数」这种值恰好为 12、13 的小数列会被误判。
 * 行政区划编码最短为 6 位（省级 XX0000），故以此作为长度下限。
 * @param {any} v
 */
function looksLikeAdcode(v) {
  const c = normalizeAdcode(v)
  return c.length >= 6
}

/**
 * 按候选名 + 值特征猜测某类列的列名
 * @param {string[]} columns
 * @param {string[]} aliases 候选列名（小写）
 * @param {(rows: Object[], col: string) => number} [score] 按值打分的额外依据
 * @param {Object[]} rows
 */
function guessColumn(columns, aliases, rows, score) {
  const lower = columns.map((c) => String(c).toLowerCase().replace(/[\s_]/g, ''))
  for (const a of aliases) {
    const i = lower.indexOf(a.toLowerCase().replace(/[\s_]/g, ''))
    if (i >= 0) return columns[i]
  }
  if (!score) return ''
  let best = ''
  let bestScore = 0
  for (const c of columns) {
    const s = score(rows, c)
    if (s > bestScore) {
      bestScore = s
      best = c
    }
  }
  return bestScore > 0 ? best : ''
}

/**
 * 依据样本行猜测列的用途
 * @param {string[]} columns
 * @param {Object[]} rows
 */
export function guessMapping(columns, rows) {
  const sample = rows.slice(0, 50)
  return {
    adcode: guessColumn(columns, ADCODE_ALIASES, sample, (rs, c) => {
      // 取值里「像行政区划编码」（≥6 位纯数字）的比例足够高，就认定是编码列
      const ok = rs.filter((r) => looksLikeAdcode(r[c])).length
      return rs.length ? ok / rs.length : 0
    }),
    regionName: guessColumn(columns, NAME_ALIASES, sample, (rs, c) => {
      const ok = rs.filter((r) => {
        const v = r[c]
        return v != null && String(v).trim() && !isValidAdcode(v)
      }).length
      return rs.length ? ok / rs.length : 0
    }),
    level: guessColumn(columns, LEVEL_ALIASES, sample),
    parentAdcode: guessColumn(columns, PARENT_ALIASES, sample, (rs, c) => {
      const ok = rs.filter((r) => looksLikeAdcode(r[c])).length
      return rs.length ? ok / rs.length : 0
    })
  }
}

/**
 * 依据「列名 + 采样值」推断每个业务字段的展示格式
 * @param {string[]} businessColumns 除映射列以外的列
 * @param {Object[]} rows
 * @returns {FieldConfig[]}
 */
export function inferFieldConfigs(businessColumns, rows) {
  const sample = rows.slice(0, 100)
  return businessColumns.map((key, i) => {
    const values = sample.map((r) => r[key]).filter((v) => v != null && String(v).trim() !== '')
    // 百分比：列值带 % 或列名含「率 / 占比 / 比重」
    const hasPercent = values.some((v) => String(v).includes('%')) || /(率|占比|比重|增速)$/.test(key)
    const numeric = values.length > 0 && values.every((v) => /^-?[\d,.\s%¥$]+$/.test(String(v).replace(/%$/, '')))
    const money = /(金额|收入|产值|GDP|税收|财政|投资|费用|利润)/i.test(key)
    let format = 'text'
    if (numeric) format = hasPercent ? 'percent' : money ? 'currency' : 'number'
    return {
      key,
      label: key,
      unit: '',
      format,
      visible: true,
      order: i
    }
  })
}

/* ------------------------------------------------------------------ */
/* 格式化                                                              */
/* ------------------------------------------------------------------ */

/**
 * 按 FieldConfig.format 格式化单元格值
 * @param {any} raw
 * @param {FieldConfig} field
 */
export function formatValue(raw, field) {
  if (raw == null || String(raw).trim() === '') return '—'
  const s = String(raw).trim()

  if (field.format === 'text') return s

  // 去千分位逗号、货币符号后转数字；含百分号则按百分比处理
  const hasPercent = s.includes('%')
  const num = Number(s.replace(/[,\s¥$%]/g, ''))
  if (!Number.isFinite(num)) return s

  if (field.format === 'percent' || hasPercent) {
    // 约定：≤1 视为小数比例需 ×100；>1 视为已按百分点给出（如 "12.5%" 已百分化）
    const v = hasPercent || Math.abs(num) > 1 ? num : num * 100
    return `${v.toFixed(2).replace(/\.?0+$/, '')}%`
  }
  if (field.format === 'currency') {
    return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
  }
  return num.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
}

/**
 * 生成 uuid，优先用浏览器 crypto API，不支持时降级为时间戳 + 随机串
 */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'ds-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}
