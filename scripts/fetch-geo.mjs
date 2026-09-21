#!/usr/bin/env node
// 抓取阿里 DataV.GeoAtlas 行政区划 GeoJSON 到 public/geo/
//
// 用法:
//   node scripts/fetch-geo.mjs                # 默认抓取 全国 + 省 + 市 (MAX_LEVEL=2)
//   MAX_LEVEL=3 node scripts/fetch-geo.mjs    # 额外抓取 区县（约 +290MB，建议 git-lfs 或 gitignore）
//   node scripts/fetch-geo.mjs --force        # 强制覆盖已存在文件
//
// 说明:
//   - 已存在的文件会被跳过（断点续传），脚本可反复运行补齐缺失层级
//   - DataV 在「区/县」(6 位 adcode) 即为几何下限，不再提供镇/街道多边形
//   - 镇级以点位形式由 src/map/ThreeMap.js 叠加，数据见 public/geo/towns/

import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public', 'geo')
const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound'
const MAX_LEVEL = Number(process.env.MAX_LEVEL ?? 2) // 0=全国 1=+省 2=+市 3=+区县
const FORCE = process.argv.includes('--force')
const CONCURRENCY = 12

const exists = async (p) => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function fetchJSON(adcode) {
  const url = `${BASE}/${adcode}_full.json`
  const res = await fetch(url)
  if (!res.ok) return null
  return res.json()
}

async function save(adcode, geo) {
  const p = join(OUT, `${adcode}_full.json`)
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(geo))
}

let count = 0
async function crawl(adcode, level) {
  const p = join(OUT, `${adcode}_full.json`)
  let geo
  if (!FORCE && (await exists(p))) {
    geo = JSON.parse(await readFile(p, 'utf8'))
  } else {
    geo = await fetchJSON(adcode)
    if (!geo) {
      console.warn(`跳过(无数据): ${adcode}`)
      return
    }
    await save(adcode, geo)
    count++
    if (count % 20 === 0) console.log(`  已下载 ${count} 个: ${adcode}`)
  }
  if (level < MAX_LEVEL) {
    const children = (geo.features || [])
      .map((f) => f.properties && f.properties.adcode)
      .filter((a) => a != null && String(a).length >= 6)
    await runPool(children.map((c) => () => crawl(String(c), level + 1)), CONCURRENCY)
  }
}

async function runPool(tasks, n) {
  let i = 0
  const workers = Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) {
      const t = tasks[i++]
      try {
        await t()
      } catch (e) {
        console.error('  抓取出错:', e.message)
      }
    }
  })
  await Promise.all(workers)
}

console.log(`抓取 DataV 行政区划 (MAX_LEVEL=${MAX_LEVEL}) → ${OUT}`)
await crawl('100000', 0)
console.log(`完成，本次新下载 ${count} 个文件。`)
