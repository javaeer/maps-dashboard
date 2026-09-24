#!/usr/bin/env node
/**
 * 抓取「会宁县人民政府」网站的乡镇权威数据，生成 maps-dashboard 展示用数据。
 *
 * 数据来源（全部为官方公开信息）：
 *   1. 会宁概况   /mlhn/hngk/         —— 面积、人口、村/社区数、耕地、距县城距离、简介
 *   2. 乡镇信息公开 /xxgk/xzxxgk/      —— 各村/社区名单（村务公开栏目）、机关简介（地址/电话/邮编/邮箱）
 *
 * 输出：public/geo/towns/<adcode>_info.json
 *
 * 用法：
 *   node scripts/fetch-town-info.mjs                # 抓取并生成
 *   node scripts/fetch-town-info.mjs --refresh      # 忽略本地缓存，重新抓取
 *   node scripts/fetch-town-info.mjs --county 620422
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache/huining')
const OUT_DIR = path.join(ROOT, 'public/geo/towns')

const argv = process.argv.slice(2)
const REFRESH = argv.includes('--refresh')
const countyArg = argv.indexOf('--county')
const COUNTY = countyArg > -1 ? argv[countyArg + 1] : '620422'

const SITE = 'https://www.huining.gov.cn'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// 会宁概况栏目列表接口（页面列表为 AJAX 构建，需直接调该接口翻页）
const HNGK_UNIT = {
  webId: 'f75da4213fa94075af1b6b9aa3892631',
  pageId: 'c188d41e21ed41e198432684ec6c7742',
  parseType: 'bulidstatic',
  pageType: 'column',
  tagId: '分页列表',
  tplSetId: 'e613c559866140c9bfc64edcc9f3c304',
}

// ——————————————————————————— 基础工具 ———————————————————————————

async function cached(name, producer) {
  const f = path.join(CACHE, name)
  if (!REFRESH) {
    try { return await fs.readFile(f, 'utf-8') } catch { /* miss */ }
  }
  const body = await producer()
  await fs.mkdir(path.dirname(f), { recursive: true })
  await fs.writeFile(f, body)
  return body
}

async function get(url, referer = SITE + '/') {
  return cached(url.replace(/^https?:\/\//, '').replace(/[/?=&:]+/g, '_').slice(-120) + '.html', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const ctl = new AbortController()
        const t = setTimeout(() => ctl.abort(), 25000)
        const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: referer }, signal: ctl.signal })
        clearTimeout(t)
        if (r.ok) return Buffer.from(await r.arrayBuffer()).toString('utf-8')
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 600))
    }
    throw new Error('fetch failed: ' + url)
  })
}

async function getUnit(pageNo) {
  return cached(`unit_${pageNo}.json`, async () => {
    const u = new URL(SITE + '/api-gateway/jpaas-publish-server/front/page/build/unit')
    for (const [k, v] of Object.entries(HNGK_UNIT)) u.searchParams.set(k, v)
    u.searchParams.set('paramJson', JSON.stringify({ pageNo, pageSize: 15 }))
    const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: SITE + '/mlhn/hngk/index.html' } })
    return await r.text()
  })
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', hellip: '…', deg: '°' }
const NOISE = /^(发布时间|来源|作者|字号|打印|关闭|上一篇|下一篇|分享到|浏览量|审核|编辑|责编|索引号|生成日期|公开方式|信息分类|【)/

function text(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  s = s.replace(/<[^>]+>/g, '\n')
  s = s.replace(/&([a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m).replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  return s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** 去重后的正文段落（页面正文常被渲染两次） */
function paragraphs(html, min = 12) {
  const seen = new Set(), out = []
  for (const l of text(html)) {
    if (l.length < min || seen.has(l) || NOISE.test(l)) continue
    seen.add(l); out.push(l)
  }
  return out
}

// ——————————————————————————— 字段抽取 ———————————————————————————

const N = String.raw`(\d+(?:\.\d+)?)`
const SEP = String.raw`[，,、\s]*`
const WAN = String.raw`\s*(?:万)?人`

function pick(t, res) {
  for (const re of res) { const m = t.match(re); if (m) return m }
  return null
}
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null }

/** 取字符串中所有数字 */
function allNums(s) {
  return [...String(s).matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0]))
}
/**
 * 人数：取原文中最后出现的数字（避开 “4625户19494人” 里的户数）。
 * “13.6万人” → 136000，“19494人” → 19494。
 */
function toPeople(raw, m) {
  const src = m ? m[0] : String(raw ?? '')
  const ns = allNums(src)
  if (!ns.length) return null
  const v = ns[ns.length - 1]
  return /万人/.test(src) ? Math.round(v * 10000) : v
}
/** 户数：取原文中第一个数字 */
function toHouseholds(m) {
  const ns = allNums(m ? m[0] : '')
  return ns.length ? ns[0] : null
}

const RE = {
  area: [
    new RegExp(`(?:总)?(?:流域)?面积(?:为)?\\s*${N}\\s*(?:平方公里|平方千米)`, 'i'),
    new RegExp(`区域面积\\s*${N}\\s*(?:平方公里|平方千米)`, 'i'),
    new RegExp(`总面积\\s*${N}\\s*(?:平方公里|平方千米)`, 'i'),
    new RegExp(`${N}\\s*(?:平方公里|平方千米)`),
    new RegExp(`${N}\\s*km2`, 'i'),
  ],
  pop: [
    new RegExp(`总人口(?:达到|为|达)?\\s*${N}\\s*万人`),
    new RegExp(`总人口(?:达到|为|达)?\\s*${N}\\s*人`),
    new RegExp(`户籍人口\\s*${N}\\s*户${SEP}${N}\\s*人`),
    new RegExp(`${N}\\s*户${SEP}${N}\\s*人`),
    new RegExp(`${N}\\s*户[^0-9。；]{0,10}?${N}\\s*人`),
    new RegExp(`人口为?\\s*${N}\\s*人`),
    new RegExp(`${N}\\s*万人`),
  ],
  households: [
    new RegExp(`(${N})\\s*户${SEP}(?:${N}\\s*人|(?:${N}\\s*)?万人)`),
    new RegExp(`总户数${SEP}(${N})\\s*户`),
    new RegExp(`共${SEP}(${N})\\s*户`),
    new RegExp(`(${N})\\s*户[^0-9。；]{0,10}?${N}\\s*人`),
  ],
  village: [
    new RegExp(`(?:辖|共有|共辖|下辖|全镇辖|全乡辖|所辖)[^，。；]{0,80}?(${N})\\s*个(?:行政村|村)(?!民小组)`),
    new RegExp(`(${N})\\s*个(?:行政村|村)(?!民小组)`),
    new RegExp(`(${N})\\s*村\\s*${N}\\s*社区`),
    new RegExp(`(${N})\\s*村`),
  ],
  community: [
    new RegExp(`(${N})\\s*村\\s*(${N})\\s*社区`),
    new RegExp(`(${N})\\s*个?社区`),
  ],
  vgroup: [new RegExp(`(${N})\\s*个?村民小组`)],
  rgroup: [new RegExp(`(${N})\\s*个?居民小组`)],
  groupAll: [
    new RegExp(`(${N})\\s*个?村\\(?(?:居)?\\)?民?小组`),
    new RegExp(`村[(（]?(?:居)?[)）]?民?小组\\s*(${N})\\s*个`),
  ],
  farm: [
    new RegExp(`耕地(?:面积)?(?:为|约|达)?\\s*${N}\\s*万亩`),
    new RegExp(`耕地(?:面积)?(?:为|约|达)?\\s*(${N})\\s*亩`),
    new RegExp(`水浇地\\s*(${N})\\s*万亩`),
  ],
  dist: [new RegExp(`距(?:会宁)?县城\\s*${N}\\s*(?:公里|千米)`)],
  alt: [
    new RegExp(`海拔(?:在)?\\s*${N}\\s*(?:米|m)?\\s*(?:—|-|~|～|至)\\s*${N}\\s*(?:米|m)`),
    new RegExp(`平均海拔\\s*${N}\\s*(?:米|m)`),
    new RegExp(`海拔\\s*${N}\\s*(?:米|m)`),
  ],
  rain: [
    new RegExp(`(?:年)?平均(?:降)?雨量(?:约)?(?:为)?\\s*${N}\\s*(?:毫米|ml|㎜|mm)`),
    new RegExp(`年降雨量(?:约)?\\s*${N}\\s*(?:—|-|~|～)?\\s*(${N})?\\s*(?:毫米|ml|㎜|mm)`),
    new RegExp(`降雨量\\s*${N}\\s*(?:毫米|ml|㎜|mm)`),
  ],
  temp: [new RegExp(`(?:年)?平均气温\\s*${N}\\s*℃`)],
  frost: [new RegExp(`无霜期\\s*${N}\\s*(?:—|-|~|～)?\\s*(${N})?\\s*天`)],
  urban: [new RegExp(`城镇人口[^0-9]{0,6}(${N}\\s*户)?\\s*(${N})\\s*万?人`)],
  rural: [new RegExp(`农业人口[^0-9]{0,6}(${N}\\s*户)?\\s*(${N})\\s*万?人`)],
  permanent: [
    new RegExp(`常住人口[^0-9]{0,10}(${N})\\s*万?人`),
    new RegExp(`常住人口\\s*${N}\\s*户\\s*(${N})\\s*人`),
  ],
  floating: [new RegExp(`流动人口（?[^）]{0,8}）?\\s*(${N})\\s*万?人`)],
}

// ——————————————————————————— 名称对齐 ———————————————————————————

/** 去掉行政区划通名，得到可用于跨源比对的核心名 */
function core(name = '') {
  return name.replace(/(民族乡|回族乡|蒙古族乡|镇|乡|街道|苏木|嘎查)$/, '').trim()
}
/** 历史/异名 → 官网现行名 */
const ALIAS = { 新庄: '新庄塬', 白塬: '白草塬', 汉岔: '汉家岔', 头寨: '头寨子' }

function matchName(name, pool) {
  const c = core(name)
  const target = ALIAS[c] || c
  return pool.find(p => core(p) === target) || pool.find(p => core(p) === c) || null
}

// ——————————————————————————— 主流程 ———————————————————————————

async function main() {
  await fs.mkdir(CACHE, { recursive: true })

  // —— 1. 乡镇列表（乡镇信息公开栏目）——
  console.log('· 抓取乡镇信息公开目录 …')
  const xzIndex = await get(SITE + '/xxgk/xzxxgk/index.html')
  const towns = []
  for (const m of xzIndex.matchAll(/href="\/xxgk\/xzxxgk\/([a-z]+)\/index\.html"[^>]*>\s*([^<]{2,20})/g)) {
    const [, slug, rawName] = m
    const name = rawName.trim()
    if (!towns.some(t => t.slug === slug)) towns.push({ slug, name })
  }
  console.log(`  乡镇：${towns.length} 个`)

  // —— 2. 会宁概况文章列表 ——
  console.log('· 抓取会宁概况文章 …')
  const gkList = new Map()
  for (let p = 1; p <= 4; p++) {
    const raw = await getUnit(p)
    let html = ''
    try { html = JSON.parse(raw)?.data?.html || '' } catch { break }
    const items = [...html.matchAll(/href="([^"]*\/mlhn\/hngk\/art\/[^"]+)"[^>]*title="([^"]*)"/g)]
    if (!items.length) break
    for (const it of items) gkList.set(it[1], it[2])
  }
  console.log(`  概况文章：${gkList.size} 篇`)

  // —— 3. 逐篇解析概况 ——
  const profile = new Map()
  let countyProfile = null
  for (const [url, title] of gkList) {
    const ps = paragraphs(await get(SITE + url))
    const head = (ps[0] || '') + '\n' + (ps[1] || '')
    const body = ps.join('\n')
    const rec = { title, url: SITE + url, intro: ps[0] || '' }

    const area = pick(head, RE.area); rec.area = area ? num(area[1]) : null
    const pop = pick(head, RE.pop) || pick(body, RE.pop)
    rec.popRaw = pop ? pop[0] : null
    rec.population = pop ? toPeople(null, pop) : null
    const hh = pick(head, RE.households) || pick(body, RE.households)
    rec.households = hh ? toHouseholds(hh) : null

    const v = pick(head, RE.village) || pick(body, RE.village); rec.villageCount = v ? num(v[1]) : null
    const c = pick(head, RE.community) || pick(body, RE.community)
    rec.communityCount = c ? num(c[2] !== undefined ? c[2] : c[1]) : null
    const vg = pick(head, RE.vgroup) || pick(body, RE.vgroup); rec.villagerGroups = vg ? num(vg[1]) : null
    const rg = pick(head, RE.rgroup) || pick(body, RE.rgroup); rec.residentGroups = rg ? num(rg[1]) : null
    const ga = pick(head, RE.groupAll) || pick(body, RE.groupAll); rec.groupsTotal = ga ? num(ga[1]) : null

    const f = pick(head, RE.farm) || pick(body, RE.farm)
    if (f) { rec.farmRaw = f[0]; rec.farmlandMu = /万亩/.test(f[0]) ? Math.round(Number(f[1]) * 10000) : num(f[1]) }
    else rec.farmlandMu = null

    const d = pick(head, RE.dist) || pick(body, RE.dist); rec.distanceToCountyKm = d ? num(d[1]) : null
    const al = pick(head, RE.alt) || pick(body, RE.alt); rec.altitude = al ? al[0] : null
    const rn = pick(head, RE.rain) || pick(body, RE.rain); rec.rainfall = rn ? rn[0] : null
    const tp = pick(head, RE.temp) || pick(body, RE.temp); rec.temperature = tp ? tp[0] : null
    const fr = pick(head, RE.frost) || pick(body, RE.frost); rec.frostFreeDays = fr ? fr[0] : null

    const u = pick(body, RE.urban); rec.urbanPopulation = u ? toPeople(null, u) : null
    const ru = pick(body, RE.rural); rec.ruralPopulation = ru ? toPeople(null, ru) : null
    const pe = pick(body, RE.permanent); rec.permanentPopulation = pe ? toPeople(null, pe) : null
    const fl = pick(body, RE.floating); rec.floatingPopulation = fl ? toPeople(null, fl) : null

    if (/^会宁概述/.test(title)) countyProfile = rec
    else profile.set(title, rec)
  }

  // —— 4. 村务公开：各村/社区名单 + 机关简介联系方式 ——
  console.log('· 抓取各村（社区）名单与机关简介 …')
  for (const t of towns) {
    const cw = await get(`${SITE}/xxgk/xzxxgk/${t.slug}/fdzdgknr/cwgk/index.html`)
    const pat = new RegExp(`href="/xxgk/xzxxgk/${t.slug}/fdzdgknr/cwgk/([a-z]+)/index\\.html"[^>]*>\\s*([^<]{2,30})`, 'g')
    const seen = new Set()
    t.villages = []
    t.communities = []
    for (const m of cw.matchAll(pat)) {
      const nm = m[2].trim()
      if (seen.has(nm)) continue
      seen.add(nm)
      ;(/社区$/.test(nm) ? t.communities : t.villages).push(nm)
    }

    const jj = text(await get(`${SITE}/xxgk/xzxxgk/${t.slug}/fdzdgknr/jgjj/index.html`))
    const find = re => { for (const l of jj) { const m = l.match(re); if (m) return m[1].trim() } return null }
    t.govAddress = find(/(?:通讯地址|单位地址|通信地址|办公地址)\s*[:：]\s*(.{4,40})/)
    const ph = find(/(?:联系电话|办公电话|电话)\s*[:：]\s*(0\d{3,4}[-—－]?\d{5,8})/) || find(/(0\d{3,4}[-—－]\d{5,8})/)
    // 统一区号分隔符为半角连字符
    t.phone = ph ? ph.replace(/^0(\d{3,4})[-—－]?(\d{5,8})$/, '0$1-$2') : null
    t.zipCode = find(/(?:邮政编码|邮编)\s*[:：]?\s*(\d{6})/) || find(/^(\d{6})$/)
    t.email = find(/电子邮箱\s*[:：]\s*([^\s]+@[^\s，。]+)/) || find(/([^\s]+@[^\s，。]+\.(?:com|cn|gov\.cn))/)
    t.officeHours = find(/办公时间\s*[:：]\s*(.{4,40})/)
    if (t.email) t.email = t.email.replace(/^@\./, '@').replace('@.', '@')
    process.stdout.write(`\r  ${t.name} 村${t.villages.length} 社区${t.communities.length}   `)
  }
  console.log()

  // —— 5. 与本地地理数据对齐（adcode / 经纬度 / 边界名）——
  const pts = JSON.parse(await fs.readFile(path.join(OUT_DIR, `${COUNTY}.json`), 'utf-8'))
  let geoNames = []
  try {
    const gj = JSON.parse(await fs.readFile(path.join(OUT_DIR, `${COUNTY}_geo.json`), 'utf-8'))
    geoNames = gj.features.map(f => f.properties?.name).filter(Boolean)
  } catch { /* 无边界数据 */ }

  const officialNames = towns.map(t => t.name)
  const seat = pts.find(p => core(p.name) === '会师') || pts[0]   // 县城（会师镇）坐标
  const straightKm = (t) => {
    if (!t.lng || !t.lat || !seat?.lng) return null
    const R = 6371, rad = d => d * Math.PI / 180
    const dLat = rad(t.lat - seat.lat), dLng = rad(t.lng - seat.lng)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(seat.lat)) * Math.cos(rad(t.lat)) * Math.sin(dLng / 2) ** 2
    return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10
  }

  const rows = towns.map(t => {
    const pr = profile.get(t.name) || {}
    const pt = pts.find(p => matchName(p.name, officialNames) === t.name)
    const geoName = matchName(t.name, geoNames) || geoNames.find(g => matchName(g, officialNames) === t.name) || null
    const farmlandMu = pr.farmlandMu ?? null
    return {
      name: t.name,
      adcode: pt?.adcode ?? null,
      type: pt?.type ?? (/乡$/.test(t.name) ? '乡' : '镇'),
      lng: pt?.lng ?? null,
      lat: pt?.lat ?? null,
      slug: t.slug,
      geoName,                                        // 边界数据中的名称（可能为旧名）
      renamed: Boolean(geoName && geoName !== t.name), // 与边界数据名称不一致
      areaKm2: pr.area ?? null,
      population: pr.population ?? null,
      households: pr.households ?? null,
      permanentPopulation: pr.permanentPopulation ?? null,
      urbanPopulation: pr.urbanPopulation ?? null,
      ruralPopulation: pr.ruralPopulation ?? null,
      floatingPopulation: pr.floatingPopulation ?? null,
      villages: t.villages,
      communities: t.communities,
      villageCount: t.villages.length || pr.villageCount || null,
      communityCount: t.communities.length || pr.communityCount || null,
      profileVillageCount: pr.villageCount ?? null,   // 概况页公布值（对照）
      profileCommunityCount: pr.communityCount ?? null,
      villagerGroups: pr.villagerGroups ?? null,
      residentGroups: pr.residentGroups ?? null,
      groupsTotal: pr.groupsTotal ?? null,
      farmlandMu,
      farmlandWanMu: farmlandMu ? Number((farmlandMu / 10000).toFixed(2)) : null,
      // 人均耕地显著偏离常识区间（<1 亩或 >30 亩）时标注，多为官网原文笔误
      // 用户籍口径人口计算（会师镇总人口含大量流动人口，直接用会低估人均耕地）
      farmlandSuspicious: (() => {
        if (!farmlandMu) return false
        const base = (pr.urbanPopulation != null && pr.ruralPopulation != null)
          ? pr.urbanPopulation + pr.ruralPopulation
          : pr.population
        if (!base) return false
        const per = farmlandMu / base
        return per < 1 || per > 30
      })(),
      altitude: pr.altitude ?? null,
      rainfall: pr.rainfall ?? null,
      temperature: pr.temperature ?? null,
      frostFreeDays: pr.frostFreeDays ?? null,
      distanceToCountyKm: core(t.name) === '会师' ? 0 : pr.distanceToCountyKm ?? null, // 官网公布的公路里程
      straightLineKm: null,                                                           // 直线距离（下方补齐）
      govAddress: t.govAddress ?? null,
      phone: t.phone ?? null,
      zipCode: t.zipCode ?? null,
      email: t.email ?? null,
      officeHours: t.officeHours ?? null,
      intro: (pr.intro || '').slice(0, 500),
      profileUrl: pr.url ?? null,
      infoUrl: `${SITE}/xxgk/xzxxgk/${t.slug}/index.html`,
    }
  }).sort((a, b) => String(a.adcode).localeCompare(String(b.adcode)))

  // 直线距离：始终计算，与官网公路里程分列展示
  for (const r of rows) r.straightLineKm = straightKm(r)

  const sum = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  /** 户籍口径人口：有城乡拆分时取二者之和，否则取公布人口 */
  const registered = r => (r.urbanPopulation != null && r.ruralPopulation != null)
    ? r.urbanPopulation + r.ruralPopulation
    : (r.population ?? 0)
  const out = {
    schema: 'maps-dashboard/town-info@1',
    county: COUNTY,
    name: '会宁县',
    updatedAt: new Date().toISOString().slice(0, 10),
    sources: [
      { label: '会宁县人民政府 · 会宁概况', url: `${SITE}/mlhn/hngk/index.html` },
      { label: '会宁县人民政府 · 乡镇信息公开（村务公开 / 机关简介）', url: `${SITE}/xxgk/xzxxgk/index.html` },
    ],
    notes: [
      '面积、人口、耕地、村/社区数量来自官网「会宁概况」栏目，各篇更新年份不同（2018—2026），属官方公布值而非同一普查口径。',
      '村、社区名单来自「村务公开」栏目（现行建制，更新至 2026 年），比概况页数字更实时，故以名单实际条数为准，概况数字保留在 profileVillageCount 供对照。',
      '会师镇人口含县城流动人口与在校学生，会师镇、郭城驿镇、柴家门镇等同时公布城镇/农业人口，已单列。',
      '村/社区采集数略少于县公布数，系部分乡镇「村务公开」栏目未公开全部建制村，属可采集范围内的上限。',
      '距县城：优先用官网公布的公路里程（distanceToCountyKm），另附按经纬度计算的直线距离（straightLineKm）供参考，两者不可混用。',
    ],
    countySummary: countyProfile ? {
      areaKm2: countyProfile.area,
      population: countyProfile.population,
      villageCount: countyProfile.villageCount,
      communityCount: countyProfile.communityCount,
      villagerGroups: countyProfile.villagerGroups,
      intro: countyProfile.intro,
      url: countyProfile.url,
    } : null,
    aggregated: {
      townCount: rows.length,
      areaKm2: Number(sum('areaKm2').toFixed(1)),
      population: sum('population'),                                  // 公布口径合计（会师镇含流动人口）
      registeredPopulation: rows.reduce((s, r) => s + registered(r), 0), // 剔除会师镇流动人口后的户籍口径
      households: sum('households'),
      villageCount: sum('villageCount'),
      communityCount: sum('communityCount'),
      farmlandMu: sum('farmlandMu'),
    },
    towns: rows,
  }

  await fs.writeFile(path.join(OUT_DIR, `${COUNTY}_info.json`), JSON.stringify(out, null, 2))
  console.log('\n✓ 已写入 public/geo/towns/%s_info.json', COUNTY)
  console.log('  乡镇 %d · 村 %d · 社区 %d · 面积合计 %s km² · 人口合计 %s',
    out.aggregated.townCount, out.aggregated.villageCount, out.aggregated.communityCount,
    out.aggregated.areaKm2, out.aggregated.population)
  const miss = rows.filter(r => !r.adcode || r.areaKm2 == null || r.population == null)
  if (miss.length) console.log('  ⚠ 字段缺失：', miss.map(r => `${r.name}(${[!r.adcode && 'adcode', r.areaKm2 == null && 'area', r.population == null && 'pop'].filter(Boolean).join('/')})`).join('、'))
}

main().catch(e => { console.error(e); process.exit(1) })
