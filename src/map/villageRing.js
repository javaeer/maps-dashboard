// 乡镇下辖「村 / 社区」名录环
//
// 数据现实：平台内置的乡镇信息里只有村/社区的**名称名录**（来自政府门户，
// 见 /geo/towns/<adcode>_info.json），**没有任何村级坐标或边界**。
// 因此这里不做点位、不做光柱插入地面——那等于替数据编造地理位置。
// 呈现方式：镇板块上方悬浮一圈名录标牌，中心一块说明牌写明数量与来源口径，
// 标牌与板块之间没有任何"指向地面"的连线，避免被误读为真实坐标。
import * as THREE from 'three'

const FONT_PX = 38        // 标牌文字字号（canvas 像素）
const PPU = 3.2           // 像素 → 世界单位
const PLATE_H = 64        // 标牌 canvas 高度
const RING_GAP = 74       // 相邻圈之间的半径差
const MAX_RINGS = 3       // 最多三圈，再多会糊成一团
const PER_RING = 12       // 每圈容纳上限（超出则加圈）

// 村 = 绿系、社区 = 紫系，与信息面板里 chips 的配色保持一致，保证同一语义同色
const VILLAGE_COLOR = '#a7f3d0'
const VILLAGE_BG = 'rgba(6, 44, 30, 0.86)'
const VILLAGE_EDGE = 'rgba(52, 211, 153, 0.55)'
const COMMUNITY_COLOR = '#ddd6fe'
const COMMUNITY_BG = 'rgba(38, 30, 64, 0.86)'
const COMMUNITY_EDGE = 'rgba(167, 139, 250, 0.55)'

function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  g.beginPath()
  g.moveTo(x + rr, y)
  g.lineTo(x + w - rr, y)
  g.quadraticCurveTo(x + w, y, x + w, y + rr)
  g.lineTo(x + w, y + h - rr)
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  g.lineTo(x + rr, y + h)
  g.quadraticCurveTo(x, y + h, x, y + h - rr)
  g.lineTo(x, y + rr)
  g.quadraticCurveTo(x, y, x + rr, y)
  g.closePath()
}

/** 单块名录标牌纹理 */
function chipTexture(text, kind) {
  const padX = 22
  const w = Math.max(120, Math.ceil(text.length) * FONT_PX + padX * 2)
  const h = PLATE_H

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')

  g.shadowColor = 'rgba(4, 12, 24, 0.85)'
  g.shadowBlur = 10
  g.shadowOffsetY = 2
  roundRectPath(g, 6, 6, w - 12, h - 12, 14)
  g.fillStyle = kind === 'community' ? COMMUNITY_BG : VILLAGE_BG
  g.fill()
  g.shadowColor = 'transparent'
  g.shadowBlur = 0
  g.shadowOffsetY = 0

  roundRectPath(g, 6, 6, w - 12, h - 12, 14)
  g.strokeStyle = kind === 'community' ? COMMUNITY_EDGE : VILLAGE_EDGE
  g.lineWidth = 2
  g.stroke()

  g.font = `600 ${FONT_PX}px "PingFang SC", "Microsoft YaHei", sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = kind === 'community' ? COMMUNITY_COLOR : VILLAGE_COLOR
  g.fillText(text, w / 2, h / 2 + 1)

  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return { tex, w, h }
}

/**
 * 中心说明牌：镇名 + 数量 + 口径声明。
 * 口径声明必须写进去——村级没有坐标，画面上看到的只是名录，不能让人以为那是地理位置。
 */
function noteTexture(title, villageCount, communityCount) {
  const lines = [title, `${villageCount} 个行政村 · ${communityCount} 个社区`, '村级暂无坐标数据，按名录展示']
  const padX = 44
  const fs = [46, 30, 24]
  const w = Math.max(520, Math.ceil(Math.max(...lines.map((l) => l.length)) * 26) + padX * 2)
  const h = 210

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')

  g.shadowColor = 'rgba(4, 12, 24, 0.9)'
  g.shadowBlur = 18
  g.shadowOffsetY = 4
  roundRectPath(g, 10, 10, w - 20, h - 20, 26)
  g.fillStyle = 'rgba(9, 22, 42, 0.9)'
  g.fill()
  g.shadowColor = 'transparent'
  g.shadowBlur = 0
  g.shadowOffsetY = 0

  roundRectPath(g, 10, 10, w - 20, h - 20, 26)
  g.strokeStyle = 'rgba(56, 189, 248, 0.5)'
  g.lineWidth = 2.5
  g.stroke()

  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const colors = ['#e0f2fe', '#7dd3fc', '#94a3b8']
  lines.forEach((line, i) => {
    g.font = `${i === 0 ? 700 : 500} ${fs[i]}px "PingFang SC", "Microsoft YaHei", sans-serif`
    g.fillStyle = colors[i]
    g.fillText(line, w / 2, 48 + i * 58)
  })

  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return { tex, w, h }
}

function makeSprite(tex, w, h) {
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false
  })
  const s = new THREE.Sprite(mat)
  s.scale.set(w / PPU, h / PPU, 1)
  s.renderOrder = 7
  // 名录标牌不参与拾取：它们浮在板块上方，会挡住下方要素的点击
  s.raycast = () => {}
  return s
}

/**
 * 生成某镇的村 / 社区名录环。
 * @param {object} opts
 * @param {string[]} opts.villages    行政村名录
 * @param {string[]} opts.communities 社区名录
 * @param {string}   opts.title       中心说明牌标题（镇名）
 * @param {number}   opts.radius      最内圈半径（世界单位）
 * @param {number}   opts.y           环所在的高度
 * @returns {{group: THREE.Group, count: number, dispose: () => void}}
 */
export function createVillageRing({
  villages = [],
  communities = [],
  title = '',
  radius = 300,
  y = 200
} = {}) {
  const group = new THREE.Group()
  const disposables = []

  const items = [
    ...villages.map((name) => ({ name, kind: 'village' })),
    ...communities.map((name) => ({ name, kind: 'community' }))
  ]

  // 中心说明牌：即使名录为空也要显示，好让"这个镇没有村级名录"这件事被看见
  const note = noteTexture(title || '下辖名录', villages.length, communities.length)
  const noteSprite = makeSprite(note.tex, note.w, note.h)
  noteSprite.position.set(0, y + 150, 0)
  noteSprite.scale.multiplyScalar(1.15)
  group.add(noteSprite)
  disposables.push(() => {
    note.tex.dispose()
    noteSprite.material.dispose()
  })

  if (!items.length) return { group, count: 0, dispose: () => disposeAll(disposables) }

  // 分圈：每圈 PER_RING 个，最多 MAX_RINGS 圈；超出部分不再显示（避免糊成一团）
  const rings = Math.min(MAX_RINGS, Math.ceil(items.length / PER_RING))
  const shown = items.slice(0, rings * PER_RING)

  for (let r = 0; r < rings; r++) {
    const slice = shown.slice(r * PER_RING, (r + 1) * PER_RING)
    const R = radius + r * RING_GAP
    slice.forEach((it, i) => {
      const a = (i / slice.length) * Math.PI * 2 - Math.PI / 2
      const { tex, w, h } = chipTexture(it.name, it.kind)
      const s = makeSprite(tex, w, h)
      s.position.set(Math.cos(a) * R, y + r * 26, Math.sin(a) * R)
      group.add(s)
      disposables.push(() => {
        tex.dispose()
        s.material.dispose()
      })
    })
  }

  return { group, count: shown.length, dispose: () => disposeAll(disposables) }
}

function disposeAll(list) {
  list.forEach((fn) => {
    try {
      fn()
    } catch (e) {
      /* 纹理可能已被释放，忽略 */
    }
  })
}
