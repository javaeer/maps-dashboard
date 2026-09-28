/**
 * 军事要素导入模板。
 *
 * 与业务数据模板同一条规矩：
 *   1) 坐标与区划代码一律取自本仓库 public/geo 下的真实数据（会宁县 28 个乡镇点位），
 *      保证模板里能填的编码，导入时一定反查得到；
 *   2) 涉及史实的内容（名称、阵营、兵力、时间…）一律留空 —— 这些只能由填表人填，
 *      模板不替用户"举例"。
 *
 * 军事态势随时代变化，模板因此把「时期 / 时间」设成一等字段：
 * 同一处地点在不同年代的布防可以各填各的，靠时期区分，而不是只有一个最终状态。
 */
import { milFeaturesToGeoJSON } from './militarySchema.js'
import { toCsv } from './dataTemplate.js'

/** 模板清单：UI 直接遍历渲染 */
export const MIL_TEMPLATES = [
  {
    key: 'point',
    label: '点状要素模板',
    desc: '驻军 / 布防 / 关隘 / 营地等，含会宁县 28 个乡镇真实点位坐标',
    file: '军事要素模板_点状.csv'
  },
  {
    key: 'march',
    label: '行军路线模板',
    desc: '按序号连成折线的路线类要素，示例含 4 个真实乡镇点位',
    file: '军事要素模板_行军路线.csv'
  },
  {
    key: 'geojson',
    label: 'GeoJSON 模板',
    desc: '给有 GIS 数据的场景：一个点要素 + 一条折线要素的骨架',
    file: '军事要素模板.geojson'
  }
]

/** 会宁县乡镇点位（坐标与编码来自 public/geo/towns/<adcode>.json，与地图同源） */
async function loadTownPoints(adcode) {
  const res = await fetch(`geo/towns/${adcode}.json`)
  if (!res.ok) throw new Error(`未找到 ${adcode} 的乡镇点位文件（public/geo/towns/${adcode}.json）`)
  const list = await res.json()
  if (!Array.isArray(list) || !list.length) throw new Error(`${adcode} 的乡镇点位文件为空`)
  return list
    .filter((t) => t && t.adcode && t.lng != null && t.lat != null)
    .sort((a, b) => String(a.adcode).localeCompare(String(b.adcode)))
}

/** 点状要素表头（列名刻意与 militarySchema 的别名一致，下载即可直接用） */
const POINT_HEADER = [
  '要素名称', '要素类型', '阵营/部队', '时期', '时间',
  '经度', '纬度', '行政区划代码', '所属区域',
  '兵力', '指挥官', '备注'
]

const MARCH_HEADER = [
  '要素名称', '要素类型', '阵营/部队', '时期', '序号', '时间',
  '经度', '纬度', '行政区划代码', '所属区域', '备注'
]

function pointRow(t, name = '', kind = '', side = '', era = '', date = '', strength = '', commander = '', note = '') {
  return [
    name, kind, side, era, date,
    t.lng, t.lat, String(t.adcode), t.name || '',
    strength, commander, note
  ]
}

/**
 * 生成点状模板 CSV（不含 BOM）
 * @param {string} [adcode] 区县编码，默认会宁县 620422
 */
export async function buildPointTemplate(adcode = '620422') {
  const towns = await loadTownPoints(adcode)
  const rows = []
  // 第 1 行是完整示例：告诉用户每列填什么；内容用「（示例）」前缀明示不是史实
  rows.push(
    pointRow(
      towns[0],
      '（示例）某驻地', '驻军', '（示例）某部', '', '',
      '', '', '← 示例行：请替换为本方要素的真实信息；以下各行坐标与区划代码为公开数据，待填'
    )
  )
  for (const t of towns.slice(1)) rows.push(pointRow(t))
  return toCsv([POINT_HEADER, ...rows])
}

/** 生成行军路线模板 CSV（不含 BOM） */
export async function buildMarchTemplate(adcode = '620422') {
  const towns = await loadTownPoints(adcode)
  const pick = towns.slice(0, 4)
  const rows = pick.map((t, i) => [
    '（示例）行军路线一', '行军路线', '', '', i + 1, '',
    t.lng, t.lat, String(t.adcode), t.name || '',
    i === 0 ? '← 同一「要素名称 + 阵营 + 时期」的多行按序号连成一条路线；时期留空则与其它时期合并，请务必填时期以区分年代' : ''
  ])
  return toCsv([MARCH_HEADER, ...rows])
}

/** 生成 GeoJSON 模板（骨架：一个点 + 一条折线） */
export async function buildGeoJsonTemplate(adcode = '620422') {
  const towns = await loadTownPoints(adcode)
  const a = towns[0]
  const b = towns[1] || towns[0]
  const skeleton = [
    {
      id: 'demo-point',
      shape: 'point',
      name: '', kind: 'garrison', side: '', era: '', date: '', strength: '', commander: '',
      adcode: String(a.adcode), region: a.name || '', note: '点要素骨架：properties 填空即由你补齐',
      point: { lng: a.lng, lat: a.lat }, path: null
    },
    {
      id: 'demo-line',
      shape: 'line',
      name: '', kind: 'march', side: '', era: '', date: '', strength: '', commander: '',
      adcode: '', region: '', note: '折线骨架：coordinates 按行进顺序排列',
      point: null,
      path: [
        { lng: a.lng, lat: a.lat },
        { lng: b.lng, lat: b.lat }
      ]
    }
  ]
  return JSON.stringify(milFeaturesToGeoJSON(skeleton), null, 2)
}

/** 触发浏览器下载（文本文件统一带 UTF-8 BOM，否则 Excel 打开中文列名乱码） */
function saveBlob(text, filename, mime) {
  const blob = new Blob(['\uFEFF' + text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * 下载模板
 * @param {'point'|'march'|'geojson'} kind
 * @param {string} [adcode]
 * @returns {Promise<{file: string, count: number}>} 文件名与数据行数（GeoJSON 为要素数）
 */
export async function downloadMilTemplate(kind, adcode = '620422') {
  const tpl = MIL_TEMPLATES.find((t) => t.key === kind)
  if (!tpl) throw new Error(`未知模板类型：${kind}`)
  let text
  let count
  if (kind === 'geojson') {
    text = await buildGeoJsonTemplate(adcode)
    count = 2
    saveBlob(text, tpl.file, 'application/geo+json;charset=utf-8')
  } else {
    text = kind === 'march' ? await buildMarchTemplate(adcode) : await buildPointTemplate(adcode)
    count = text.split('\r\n').length - 1
    saveBlob(text, tpl.file, 'text/csv;charset=utf-8')
  }
  return { file: tpl.file, count }
}
