// 乡镇名称归一化：边界数据、点位数据、政府门户数据三方来源的命名口径并不一致
//   - rooma1989 边界多为撤乡设镇前的旧名：新庄乡 / 汉家岔乡 / 侯家川乡 …
//   - 统计用点位数据用现行名：新庄镇 / 汉家岔镇 …
//   - 政府门户网站用最新名：新庄塬镇 / 汉家岔镇 …
// 统一去掉通名后比对，并对少数改名/异名做映射。

const SUFFIX = /(民族乡|回族乡|蒙古族乡|满族乡|镇|乡|街道|苏木|嘎查|农场|管委会)$/

/** 去掉行政区划通名，得到核心名 */
export function coreName(name = '') {
  return String(name).replace(SUFFIX, '').trim()
}

/** 异名 → 现行名（键为核心名） */
const ALIAS = {
  新庄: '新庄塬',
  白塬: '白草塬',
  汉岔: '汉家岔',
  头寨: '头寨子',
  河畔: '河畔',
}

/** 归一化后的比对键 */
export function townKey(name = '') {
  const c = coreName(name)
  return ALIAS[c] || c
}

/**
 * 在展示信息表中按名称查找乡镇（容忍通名差异与已知异名）
 * @param {string} name  任意来源的乡镇名
 * @param {Array}  towns info.towns 数组
 */
export function findTownInfo(name, towns = []) {
  if (!name) return null
  const key = townKey(name)
  return towns.find(t => townKey(t.name) === key)
    || towns.find(t => townKey(t.geoName || '') === key)
    || null
}

/**
 * 把官方展示信息转成地图点击时使用的 town 对象字段。
 * 只覆盖展示相关字段，不触碰 meta（行政区划归属由边界数据决定）。
 */
export function townToDisplay(info) {
  if (!info) return {}
  return {
    name: info.name,
    level: '乡镇',
    population: info.population ?? null,
    area: info.areaKm2 ?? null,
    images: [],
    info
  }
}
