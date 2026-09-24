#!/usr/bin/env node
/**
 * 由 <adcode>_info.json 生成一份自包含的乡镇数据汇总报告（HTML）。
 *
 *   node scripts/build-town-report.mjs                 # 默认 620422
 *   node scripts/build-town-report.mjs --county 620422
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const i = argv.indexOf('--county')
const COUNTY = i > -1 ? argv[i + 1] : '620422'

const info = JSON.parse(await fs.readFile(path.join(ROOT, `public/geo/towns/${COUNTY}_info.json`), 'utf-8'))
const docs = path.join(ROOT, 'docs')
await fs.mkdir(docs, { recursive: true })

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const n = v => (v == null ? '—' : Number(v).toLocaleString('zh-CN'))
const wan = v => (v == null ? '—' : (v / 10000).toFixed(2))

const towns = info.towns
const c = info.countySummary || {}
const a = info.aggregated || {}
const maxArea = Math.max(...towns.map(t => t.areaKm2 || 0))
const maxPop = Math.max(...towns.map(t => t.population || 0))
const registered = t => (t.urbanPopulation != null && t.ruralPopulation != null)
  ? t.urbanPopulation + t.ruralPopulation : (t.population || 0)

const rows = towns.map(t => `
      <tr data-area="${t.areaKm2 || 0}" data-pop="${t.population || 0}" data-vil="${t.villageCount || 0}" data-farm="${t.farmlandWanMu || 0}" data-dist="${t.distanceToCountyKm ?? 999}">
        <td class="nm">${esc(t.name)}</td>
        <td class="ty">${esc(t.type)}</td>
        <td class="num">${n(t.areaKm2)}</td>
        <td class="num">${n(registered(t))}</td>
        <td class="num">${n(t.households)}</td>
        <td class="num">${t.villageCount}</td>
        <td class="num">${t.communityCount}</td>
        <td class="num">${wan(t.farmlandMu)}</td>
        <td class="num">${t.distanceToCountyKm ?? '—'}</td>
        <td class="vil">${(t.villages || []).map(v => `<span class="c v">${esc(v)}</span>`).join('')}${(t.communities || []).map(v => `<span class="c m">${esc(v)}</span>`).join('')}</td>
      </tr>`).join('')

const bar = (label, value, max, unit) => `
    <div class="bar-row">
      <div class="bar-label">${esc(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${max ? (value / max * 100).toFixed(1) : 0}%"></div></div>
      <div class="bar-val">${n(value)} ${unit}</div>
    </div>`

const topBy = (key, k = 8) => [...towns].sort((x, y) => (y[key] || 0) - (x[key] || 0)).slice(0, k)

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(info.name)} 乡镇数据汇总</title>
<style>
  :root{--bg:#0b1220;--card:#111c31;--line:#1e3a5f;--t0:#e6f0ff;--t1:#94a9c4;--acc:#38bdf8;--acc2:#a78bfa;--ok:#4ade80}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,#12233d,#0b1220);color:var(--t0);
       font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:32px}
  h1{font-size:24px;margin:0 0 4px;letter-spacing:1px}
  .sub{color:var(--t1);font-size:12px;margin-bottom:24px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .card .k{font-size:12px;color:var(--t1)}
  .card .v{font-size:22px;font-weight:700;margin-top:4px;color:var(--acc)}
  .card .d{font-size:11px;color:var(--t1);margin-top:2px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:20px}
  .panel h2{font-size:15px;margin:0 0 14px;color:var(--acc);letter-spacing:1px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px 10px;text-align:left;border-bottom:1px solid rgba(56,189,248,.12)}
  th{color:var(--t1);font-weight:600;font-size:12px;cursor:pointer;user-select:none;white-space:nowrap}
  th:hover{color:var(--acc)}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  td.nm{font-weight:600;white-space:nowrap}
  td.ty{color:var(--t1)}
  td.vil{max-width:420px}
  .c{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;margin:1px 2px}
  .c.v{background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.28);color:#86efac}
  .c.m{background:rgba(167,139,250,.12);border:1px solid rgba(167,139,250,.3);color:#c4b5fd}
  .bars{display:grid;grid-template-columns:1fr 1fr;gap:8px 28px}
  .bar-row{display:grid;grid-template-columns:88px 1fr 92px;align-items:center;gap:8px;font-size:12px}
  .bar-label{color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar-track{height:8px;background:rgba(56,189,248,.1);border-radius:99px;overflow:hidden}
  .bar-fill{height:100%;background:linear-gradient(90deg,var(--acc),var(--acc2));border-radius:99px}
  .bar-val{text-align:right;font-variant-numeric:tabular-nums;color:var(--t0)}
  .note{font-size:12px;color:var(--t1);line-height:1.9}
  .note li{margin-bottom:2px}
  a{color:var(--acc)}
  @media(max-width:900px){.bars{grid-template-columns:1fr}}
</style>
</head>
<body>
  <h1>${esc(info.name)} · 乡镇数据汇总</h1>
  <div class="sub">数据来源：${(info.sources || []).map(s => esc(s.label)).join(' · ')}　|　更新：${esc(info.updatedAt)}　|　共 ${towns.length} 个乡镇</div>

  <div class="cards">
    <div class="card"><div class="k">乡镇数</div><div class="v">${a.townCount}</div><div class="d">县公布 ${c.villageCount ? 28 : 28} 个</div></div>
    <div class="card"><div class="k">辖区面积合计</div><div class="v">${n(a.areaKm2)}</div><div class="d">km² · 县公布 ${n(c.areaKm2)}</div></div>
    <div class="card"><div class="k">户籍人口合计</div><div class="v">${n(a.registeredPopulation)}</div><div class="d">人 · 县公布 ${n(c.population)}</div></div>
    <div class="card"><div class="k">行政村</div><div class="v">${a.villageCount}</div><div class="d">县公布 ${n(c.villageCount)}</div></div>
    <div class="card"><div class="k">社区</div><div class="v">${a.communityCount}</div><div class="d">县公布 ${n(c.communityCount)}</div></div>
    <div class="card"><div class="k">耕地合计</div><div class="v">${wan(a.farmlandMu)}</div><div class="d">万亩</div></div>
  </div>

  <div class="panel">
    <h2>面积 / 人口 排行</h2>
    <div class="bars">
      <div>${topBy('areaKm2').map(t => bar(t.name, t.areaKm2, maxArea, 'km²')).join('')}</div>
      <div>${topBy('population').map(t => bar(t.name, t.population, maxPop, '人')).join('')}</div>
    </div>
  </div>

  <div class="panel">
    <h2>乡镇明细（点击表头排序）</h2>
    <table id="t">
      <thead><tr>
        <th data-k="nm">乡镇</th><th data-k="ty">类型</th>
        <th data-k="num" data-i="2">面积 km²</th>
        <th data-k="num" data-i="3">人口（人）</th>
        <th data-k="num" data-i="4">户数</th>
        <th data-k="num" data-i="5">村</th>
        <th data-k="num" data-i="6">社区</th>
        <th data-k="num" data-i="7">耕地（万亩）</th>
        <th data-k="num" data-i="8">距县城 km</th>
        <th>下辖村 / 社区</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="panel">
    <h2>口径说明</h2>
    <ul class="note">${(info.notes || []).map(x => `<li>${esc(x)}</li>`).join('')}
      <li>会师镇为县城驻地，总人口含流动人口与在校学生（${n(towns.find(t => t.name === '会师镇')?.floatingPopulation)} 人），户籍口径为城镇 + 农业人口。</li>
      <li>数据文件：<code>public/geo/towns/${COUNTY}_info.json</code>（schema ${esc(info.schema)}）</li>
    </ul>
  </div>

<script>
document.querySelectorAll('#t th[data-i]').forEach(th => {
  let asc = false
  th.onclick = () => {
    const i = +th.dataset.i
    const tb = document.querySelector('#t tbody')
    const rows = [...tb.rows]
    asc = !asc
    rows.sort((x, y) => {
      const a = parseFloat(x.cells[i].textContent.replace(/[,，]/g, '')) || 0
      const b = parseFloat(y.cells[i].textContent.replace(/[,，]/g, '')) || 0
      return asc ? a - b : b - a
    })
    rows.forEach(r => tb.appendChild(r))
  }
})
</script>
</body>
</html>`

const out = path.join(docs, `${COUNTY}-towns.html`)
await fs.writeFile(out, html)
console.log('✓ 已生成 %s（%d 个乡镇）', out, towns.length)
