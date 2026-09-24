/**
 * 业务数据导入模板。
 *
 * 两条硬规矩：
 * 1. 编码与名称一律取自 public/geo 下的真实数据，不臆造；
 * 2. 业务数值列一律留空 —— 真实数据只能由用户填，模板不能替用户"举例"。
 *
 * 列名的选取对齐 dataParser.js 的自动识别别名（ADCODE_ALIASES / NAME_ALIASES /
 * LEVEL_ALIASES），因此模板下载后直接可用，无需手工调整映射。
 */

/** 模板清单：UI 直接遍历渲染 */
export const TEMPLATES = [
  {
    key: 'county',
    label: '区县级模板',
    desc: '6 位行政区划代码，示例含白银市 5 个区县真实编码',
    file: '业务数据模板_区县级.csv'
  },
  {
    key: 'town',
    label: '乡镇级模板',
    desc: '9 位行政区划代码，按指定区县的乡镇点位生成',
    file: '业务数据模板_乡镇级.csv'
  }
]

/** 区县级模板用到的真实数据：白银市下辖区县（来源 public/geo/620400_full.json） */
const BAIYIN_COUNTIES = [
  { adcode: '620402', name: '白银区' },
  { adcode: '620403', name: '平川区' },
  { adcode: '620421', name: '靖远县' },
  { adcode: '620422', name: '会宁县' },
  { adcode: '620423', name: '景泰县' }
]

/**
 * CSV 单元格转义：含分隔符 / 引号 / 换行时用双引号包裹，内部引号翻倍
 * @param {any} v
 * @returns {string}
 */
function cell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 二维数组转 CSV 文本，行尾用 \r\n（Excel 兼容性最好）
 * @param {string[][]} rows
 * @returns {string}
 */
export function toCsv(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

/**
 * 读取某区县的乡镇点位。数据来自 public/geo/towns/<adcode>.json，
 * 该文件同时用于地图上的乡镇点位渲染，二者同源，不会出现模板能对上、地图对不上的情况。
 * @param {string} adcode 6 位区县编码
 * @returns {Promise<{adcode: string, name: string}[]>}
 */
export async function loadTownList(adcode) {
  const res = await fetch(`geo/towns/${adcode}.json`)
  if (!res.ok) throw new Error(`未找到 ${adcode} 的乡镇点位文件（public/geo/towns/${adcode}.json）`)
  const list = await res.json()
  if (!Array.isArray(list) || !list.length) throw new Error(`${adcode} 的乡镇点位文件为空`)
  return list
    .filter((t) => t && t.adcode)
    .map((t) => ({ adcode: String(t.adcode), name: t.name || '' }))
    .sort((a, b) => a.adcode.localeCompare(b.adcode))
}

/**
 * 生成模板的 CSV 内容（不含 BOM，便于单测与二次处理）
 * @param {'county'|'town'} kind
 * @param {string} [townAdcode] kind='town' 时指定区县编码，默认会宁县 620422
 * @returns {Promise<string>}
 */
export async function buildTemplateCsv(kind, townAdcode = '620422') {
  // 表头沿用 dataParser 能自动识别的常见别名
  const header = ['行政区划代码', '区域名称', '层级', '指标一', '指标二', '备注']
  const rowsOf = (list, level) => list.map((x) => [x.adcode, x.name, level, '', '', ''])

  let rows
  if (kind === 'town') {
    const towns = await loadTownList(townAdcode)
    rows = rowsOf(towns, '镇级')
  } else {
    rows = rowsOf(BAIYIN_COUNTIES, '区县级')
  }
  return toCsv([header, ...rows])
}

/**
 * 触发模板下载。
 * 加 UTF-8 BOM 是必须的：不加的话 Excel 会按系统 ANSI（中文 Windows 为 GBK）打开，中文列名全部乱码。
 * @param {'county'|'town'} kind
 * @param {string} [townAdcode]
 * @returns {Promise<{file: string, count: number}>} 下载的文件名与数据行数
 */
export async function downloadTemplate(kind, townAdcode = '620422') {
  const tpl = TEMPLATES.find((t) => t.key === kind)
  if (!tpl) throw new Error(`未知模板类型：${kind}`)

  const csv = await buildTemplateCsv(kind, townAdcode)
  const count = csv.split('\r\n').length - 1
  // \uFEFF 即 UTF-8 BOM
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = tpl.file
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立即回收会让部分浏览器的下载句柄失效，延后一拍再释放
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return { file: tpl.file, count }
}
