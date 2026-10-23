// 端到端验证：山系 / 水系全局显隐 + 军事要素导入
// 运行：先 npm run dev，再 npm run test:e2e
// 环境可覆盖：E2E_BASE_URL / E2E_PORT / E2E_CHROME_PATH
import fs from 'fs'
import { chromium } from 'playwright-core'

// 地址与端口不写死：默认 8130，换端口或上 CI 时用 E2E_BASE_URL / E2E_PORT 指定
const BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${process.env.E2E_PORT || 8130}`
const URL = `${BASE_URL}/index.html?palette=campaign`
let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}

// 浏览器路径不写死：未指定 E2E_CHROME_PATH 时交给 playwright-core 自己找，跨 macOS / Linux / CI 通用
const launchOpts = {
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage']
}
if (process.env.E2E_CHROME_PATH) launchOpts.executablePath = process.env.E2E_CHROME_PATH
const browser = await chromium.launch(launchOpts)
process.on('uncaughtException', async (e) => {
  console.error('FATAL', e)
  try { await browser.close() } catch (x) {}
  process.exit(1)
})

const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true })
const page = await ctx.newPage()
// SwiftShader 软渲染下单帧 ~900ms，默认 30s 门槛会偶发超时，统一放宽
ctx.setDefaultTimeout(120000)
page.setDefaultTimeout(120000)
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)) })
const http404 = []
page.on('response', (r) => { if (r.status() >= 400) http404.push(`${r.status()} ${r.url()}`) })

const btn = (label) => page.locator('.topbar .tools .fsbtn', { hasText: label }).first()
const state = () => page.evaluate(() => {
  const m = window.__map
  return {
    mode: m.mode,
    terrainVisible: !!(m.terrain && m.terrain.mesh && m.terrain.mesh.mesh.visible),
    peaksVisible: !!(m.terrain && m.terrain.peaks && m.terrain.peaks.group.visible),
    hydroVisible: !!(m.hydroLayer && m.hydroLayer.group.visible),
    want: { ...m.geoWant },
    milCount: m.militaryLayer ? m.militaryLayer.count : 0,
    milVisible: !!(m.militaryLayer && m.militaryLayer.group.visible),
    rivers: m.geoSource ? m.geoSource.rivers : 0
  }
})
const legendText = () => page.locator('.legend').evaluate((e) => e.textContent || '', null, { timeout: 120000 })

// 软渲染（SwiftShader）下主线程被 WebGL 吃满，Playwright 的稳定性检查等不到帧，
// 真鼠标点击会 30s 超时。改为在页面内直接派发事件——触发的是同一套 Vue 处理逻辑。
async function clickIt(loc) {
  await loc.evaluate((el) => el.click(), null, { timeout: 120000 })
  await page.waitForTimeout(250)
}
async function selectIt(loc, value) {
  await loc.evaluate((el, v) => {
    el.value = v
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value, { timeout: 120000 })
  await page.waitForTimeout(350)
}
async function checkIt(loc, checked) {
  await loc.evaluate((el, v) => {
    if (el.checked !== v) el.click()
  }, checked, { timeout: 120000 })
  await page.waitForTimeout(350)
}

await page.goto(URL, { waitUntil: 'load' })
try {
  await page.waitForFunction(() => !!window.__map, null, { timeout: 60000 })
} catch (e) {
  console.log('!! __map 未就绪，页面错误：', JSON.stringify(errs.slice(0, 5), null, 1))
  console.log('!! body:', (await page.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\n/g, ' | '))
  console.log('!! typeof __map =', await page.evaluate(() => typeof window.__map).catch((x) => 'ERR ' + x.message))
  throw e
}
await page.waitForFunction(() => !!(window.__map && window.__map.geoSource), null, { timeout: 90000 })
await page.waitForTimeout(800)

console.log('\n[1] 顶栏三个新按钮存在')
ok('有「山系」按钮', (await btn('山系').count()) === 1)
ok('有「水系」按钮', (await btn('水系').count()) === 1)
ok('有「军事要素」按钮', (await btn('军事要素').count()) === 1)
let s = await state()
ok('默认山系与水系都显示', s.terrainVisible && s.hydroVisible && s.want.terrain && s.want.hydro)
ok('全国视图河川已载入', s.rivers > 0, `rivers=${s.rivers}`)

console.log('\n[2] 山系开关')
await clickIt(btn('山系'))
await page.waitForTimeout(300)
s = await state()
ok('关掉后晕渲隐藏', s.terrainVisible === false)
ok('山头符号跟着隐藏', s.peaksVisible === false)
ok('按钮取消激活态', !(await btn('山系').getAttribute('class')).includes('active'))
const lg1 = await legendText()
ok('图注不再列山形晕渲', !lg1.includes('山形晕渲'), lg1.replace(/\s+/g, ' ').slice(0, 90))
ok('图注仍列河川（水系没关）', lg1.includes('河川'))
await clickIt(btn('山系'))
await page.waitForTimeout(300)
s = await state()
ok('再点恢复山系', s.terrainVisible === true)
ok('图注恢复山形晕渲', (await legendText()).includes('山形晕渲'))

console.log('\n[3] 水系开关')
await clickIt(btn('水系'))
await page.waitForTimeout(300)
s = await state()
ok('关掉后水系隐藏', s.hydroVisible === false)
const lg2 = await legendText()
ok('图注不再列河川', !lg2.includes('河川'))
ok('山系不受影响', s.terrainVisible === true)
await clickIt(btn('水系'))
await page.waitForTimeout(300)
s = await state()
ok('再点恢复水系', s.hydroVisible === true)

console.log('\n[4] 关掉山系后下钻：不能自己亮出来')
await clickIt(btn('山系'))
await page.waitForTimeout(200)
await page.evaluate(async () => {
  const m = window.__map
  await m.drill({ properties: { adcode: 620000, name: '甘肃省', center: [103.8, 36.06], level: 'province' } })
  await m.drill({ properties: { adcode: 620400, name: '白银市', center: [104.2, 36.5], level: 'city' } })
  await m.drill({ properties: { adcode: 620422, name: '会宁县', center: [105.08, 35.68], level: 'district' } })
})
await page.waitForFunction(() => window.__map.mode === 'town', null, { timeout: 90000 }).catch(() => {})
await page.waitForFunction(() => {
  const g = window.__map.geoSource
  return g && g.terrainLabel === '会宁县'
}, null, { timeout: 90000 }).catch(() => {})
await page.waitForTimeout(600)
s = await state()
ok('下钻后山系仍保持隐藏', s.terrainVisible === false && s.want.terrain === false)
ok('水系仍显示', s.hydroVisible === true)
await clickIt(btn('山系'))
await page.waitForTimeout(300)
ok('县级重新打开山系生效', (await state()).terrainVisible === true)

console.log('\n[5] 刷新后显隐状态本机记忆')
await clickIt(btn('山系')) // 关掉
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => !!window.__map && !!window.__map.geoSource, null, { timeout: 90000 })
await page.waitForTimeout(600)
s = await state()
ok('刷新后山系仍为关闭', s.want.terrain === false)
ok('按钮呈现未激活态', !(await btn('山系').getAttribute('class')).includes('active'))
await clickIt(btn('山系'))
await page.waitForTimeout(300)

console.log('\n[6] 军事要素模板下载')
await clickIt(btn('军事要素'))
await page.waitForTimeout(400)
ok('打开了导入面板', (await page.locator('.modal').count()) === 1)
ok('面板列出 3 个模板', (await page.locator('.tpl-row .btn').count()) === 3)

const dl = page.waitForEvent('download')
await clickIt(page.locator('.tpl-row .btn', { hasText: '点状要素模板' }))
const d1 = await dl
const p1 = await d1.path()
const csv = fs.readFileSync(p1, 'utf8')
const lines = csv.replace(/^\uFEFF/, '').split('\r\n')
ok('下载文件名正确', d1.suggestedFilename() === '军事要素模板_点状.csv', d1.suggestedFilename())
ok('CSV 带 UTF-8 BOM', csv.charCodeAt(0) === 0xfeff)
ok('表头含关键列', lines[0].includes('要素名称') && lines[0].includes('经度') && lines[0].includes('时期'), lines[0].slice(0, 60))
ok('数据行 = 会宁 28 镇', lines.length - 1 === 28, `行数 ${lines.length - 1}`)
ok('首行为示例说明', lines[1].includes('示例'), lines[1].slice(0, 40))
ok('坐标取自真实点位（会师镇 105.07408）', lines[1].includes('105.07408'))

const dl2 = page.waitForEvent('download')
await clickIt(page.locator('.tpl-row .btn', { hasText: '行军路线模板' }))
const d2 = await dl2
const march = fs.readFileSync(await d2.path(), 'utf8').replace(/^\uFEFF/, '')
ok('路线模板含序号列', march.split('\r\n')[0].includes('序号'))
ok('路线模板 4 个示例点', march.split('\r\n').length - 1 === 4)

const dl3 = page.waitForEvent('download')
await clickIt(page.locator('.tpl-row .btn', { hasText: 'GeoJSON 模板' }))
const d3 = await dl3
const gj = JSON.parse(fs.readFileSync(await d3.path(), 'utf8').replace(/^\uFEFF/, ''))
ok('GeoJSON 是 FeatureCollection', gj.type === 'FeatureCollection')
ok('含 1 点 + 1 线', gj.features.length === 2 && gj.features[0].geometry.type === 'Point' && gj.features[1].geometry.type === 'LineString')

console.log('\n[7] 上传 CSV 走完 映射 → 校验 → 入库')
const testCsv = [
  '要素名称,要素类型,阵营/部队,时期,时间,经度,纬度,行政区划代码,所属区域,兵力,指挥官,备注',
  'E2E驻防点,驻军,测试甲部,甲时期,,105.07408,35.69249,620422100,会师镇,,,端到端自造数据',
  'E2E关隘,关隘,,甲时期,,105.02912,35.71125,620422101,郭城驿镇,,,端到端自造数据',
  'E2E行军路线,行军路线,测试乙部,乙时期,,105.07408,35.69249,620422100,会师镇,,,1',
  'E2E行军路线,行军路线,测试乙部,乙时期,,105.02912,35.71125,620422101,郭城驿镇,,,2',
  'E2E行军路线,行军路线,测试乙部,乙时期,,105.0582,35.65677,620422102,河畔镇,,,3',
  'E2E无坐标点,驻军,测试丙部,甲时期,,,,,,,,应被跳过'
].join('\n')
// 注意：本文件顶部有 const URL = 'http://...' 会遮蔽全局 URL，这里必须走 globalThis
const FIXTURE = new globalThis.URL('./fixture-military.csv', import.meta.url).pathname
fs.writeFileSync(FIXTURE, '\uFEFF' + testCsv, 'utf8')
await page.locator('input[type=file]').setInputFiles(FIXTURE)
await page.waitForSelector('.map-grid', { timeout: 20000 }).catch(() => {})
ok('进入字段映射步骤', (await page.locator('.map-grid').count()) >= 1, `map-grid=${await page.locator('.map-grid').count()} 面板文本=${(await page.locator('.modal').evaluate((e) => e.textContent || '')).slice(0, 80)}`)
// 每个下拉的 option 里都含全部列名，按文本过滤会命中所有项，改用固定顺序取（MIL_FIELDS 顺序：name/kind/side/era/date/lng…）
const mappedName = await page.locator('.map-grid .fld').nth(0).locator('select').inputValue()
ok('自动识别名称列', mappedName === '要素名称', mappedName)
const mappedLng = await page.locator('.map-grid .fld').nth(5).locator('select').inputValue()
ok('自动识别经度列', mappedLng === '经度', mappedLng)

await clickIt(page.locator('.foot .btn.primary'))
await page.waitForSelector('.fld.block input', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(400)
const bodyTxt = await page.locator('.modal').evaluate((e) => e.textContent || '')
ok('校验出 3 个要素（1 驻军 + 1 关隘 + 1 路线）', bodyTxt.includes('可导入 3 个要素'), (bodyTxt.match(/可导入 \d+ 个要素/)?.[0] || '未进入步骤3') + ' | ' + bodyTxt.slice(0, 160))
ok('无坐标行被跳过并说明', bodyTxt.includes('既无经纬度也无行政区划代码'))
ok('按类型分别统计', bodyTxt.includes('驻军 1') && bodyTxt.includes('关隘 1') && bodyTxt.includes('行军路线 1'))
ok('预览里路线显示折线点数', bodyTxt.includes('3 点折线'))

await page.locator('.fld.block input').fill('E2E 测试态势')
await clickIt(page.locator('.foot .btn.primary'))
// 软渲染下从落库 → store → 重建图层要跨好几帧，等状态而不是等固定毫秒
await page.waitForSelector('.milbar', { timeout: 60000 }).catch(() => {})
await page.waitForFunction(() => window.__map.militaryLayer && window.__map.militaryLayer.count === 3, null, { timeout: 60000 }).catch(() => {})
ok('导入后面板关闭', (await page.locator('.modal').count()) === 0)
s = await state()
ok('地图画出 3 个军事要素', s.milCount === 3, `count=${s.milCount}`)
ok('军事管理面板自动展开', (await page.locator('.milbar').count()) === 1)

console.log('\n[8] 时期过滤')
const optCount = await page.locator('.milbar select option').count()
const optTxt = await page.locator('.milbar select').evaluate((e) => [...e.options].map((o) => o.value).join('/'), null, { timeout: 120000 })
ok('面板列出两个时期', optCount === 3, `options=${optCount} [${optTxt}]`)
await selectIt(page.locator('.milbar select'),'甲时期')
await page.waitForTimeout(500)
s = await state()
ok('切到甲时期只剩 2 个（驻军 + 关隘）', s.milCount === 2, `count=${s.milCount}`)
await selectIt(page.locator('.milbar select'),'乙时期')
await page.waitForTimeout(500)
ok('切到乙时期只剩路线 1 个', (await state()).milCount === 1)
await selectIt(page.locator('.milbar select'),'')
await page.waitForTimeout(500)
ok('回到全部时期恢复 3 个', (await state()).milCount === 3)

console.log('\n[9] 类型过滤与整体显隐')
const chips = page.locator('.milbar .chip')
ok('类型过滤项 = 出现过的 3 类', (await chips.count()) === 3, `${await chips.count()}`)
await clickIt(chips.first())
await page.waitForTimeout(400)
ok('点掉一类后要素减少', (await state()).milCount < 3, `count=${(await state()).milCount}`)
await clickIt(chips.first())
await page.waitForTimeout(400)
ok('再点回来恢复', (await state()).milCount === 3)
const swFirst = page.locator('.milbar .set .sw input').first()
console.log('    [debug] 开关数=' + (await page.locator('.milbar .set .sw input').count()) + ' 首个checked=' + (await swFirst.evaluate((e) => e.checked, null, { timeout: 120000 })))
await checkIt(swFirst, false)
await page.waitForFunction(() => !window.__map.militaryLayer, null, { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(600)
const afterUn = await state()
ok('取消勾选数据集后要素清空', afterUn.milCount === 0, `count=${afterUn.milCount} checked=${await swFirst.evaluate((e) => e.checked, null, { timeout: 120000 })}`)
await checkIt(swFirst, true)
await page.waitForFunction(() => window.__map.militaryLayer && window.__map.militaryLayer.count === 3, null, { timeout: 60000 }).catch(() => {})
await page.waitForTimeout(800)
s = await state()
ok('重新勾选后恢复', s.milCount === 3, `count=${s.milCount} checked=${await swFirst.evaluate((e) => e.checked, null, { timeout: 120000 })}`)

console.log('\n[10] 点击地图上的军标看详情')
const pts = await page.evaluate(() => {
  const m = window.__map
  if (!m.militaryLayer) return null
  const obj = m.militaryLayer.pickables.find((o) => o.userData.milFeature && o.userData.milFeature.name === 'E2E驻防点')
  if (!obj) return null
  const toScreen = (dy) => {
    const p = obj.position.clone()
    p.y += dy
    p.project(m.camera)
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight }
  }
  const out = [0, 8, 26].map((dy) => toScreen(dy))
  const top = document.elementFromPoint(Math.round(out[0].x), Math.round(out[0].y))
  return { pts: out, topEl: top ? `${top.tagName}.${top.className}`.slice(0, 60) : null }
})
const pt = pts ? pts.pts[0] : null
console.log('    [debug] 候选点=' + JSON.stringify(pts && pts.pts.map((q) => [Math.round(q.x), Math.round(q.y)])) + ' 最上层元素=' + (pts && pts.topEl))
ok('能算出军标屏幕坐标', !!pt, JSON.stringify(pt))
if (pt) {
  for (const q of pts.pts) {
    await page.mouse.click(q.x, q.y)
    await page.waitForTimeout(900)
    if (await page.locator('.milbar .pick').count()) { console.log('    [debug] 命中点=' + JSON.stringify([Math.round(q.x), Math.round(q.y)])); break }
  }
  const pickTxt = await page.locator('.milbar .pick').evaluate((e) => e.textContent || '', null, { timeout: 120000 }).catch(() => '')
  ok('详情区显示要素名', pickTxt.includes('E2E驻防点'), pickTxt.replace(/\s+/g, ' ').slice(0, 70))
  ok('详情区显示阵营', pickTxt.includes('测试甲部'))
  ok('详情区显示坐标', pickTxt.includes('105.07'))
}

console.log('\n[11] 下钻后军事要素按经纬度重投影保留')
await page.evaluate(async () => {
  const m = window.__map
  await m.back()
})
await page.waitForTimeout(1200)
s = await state()
ok('回到市级仍保留 3 个要素', s.milCount === 3, `mode=${s.mode} count=${s.milCount}`)
await page.evaluate(async () => {
  const m = window.__map
  await m.drill({ properties: { adcode: 620422, name: '会宁县', center: [105.08, 35.68], level: 'district' } })
})
await page.waitForFunction(() => window.__map.mode === 'town', null, { timeout: 90000 }).catch(() => {})
await page.waitForTimeout(1000)
ok('县级视图要素仍在', (await state()).milCount === 3)

console.log('\n[12] 图廓图注列出军事要素')
const lg3 = await legendText()
ok('图注出现「驻军（导入）」', lg3.includes('驻军'), lg3.replace(/\s+/g, ' ').slice(0, 120))
ok('图名条注明军事要素来源', (await page.locator('.title-plate').evaluate((e) => e.textContent || '')).includes('军事要素'))

console.log('\n[13] 删除数据集')
page.on('dialog', (d) => d.accept())
await clickIt(page.locator('.milbar .mini.del').first())
await page.waitForFunction(() => !window.__map.militaryLayer, null, { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(800)
s = await state()
ok('删除后要素清空', s.milCount === 0)
await page.reload({ waitUntil: 'load' })
await page.waitForFunction(() => !!window.__map && !!window.__map.geoSource, null, { timeout: 90000 })
await page.waitForTimeout(1200)
ok('刷新后库里也不残留', (await state()).milCount === 0)

console.log('\n[14] 无 JS 报错')
// 资源 404 是「数据缺失 → 静默降级」的已知路径（如白银市无市级地形文件、DataV 无县级下级面），
// 不是 JS 运行时错误；两者分开看，别拿降级噪声掩盖真报错，也别把降级当 bug。
const jsErrs = errs.filter((e) => !/Failed to load resource/.test(e))
console.log('    [debug] 资源 404（应均为可选数据的降级探测）：' + (http404.length ? http404.join(' | ') : '无'))
ok('无 JS 运行时错误', jsErrs.length === 0, jsErrs.slice(0, 3).join(' | '))

await page.screenshot({ path: '/tmp/mil-final.png' })
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exit(fail ? 1 : 0)
