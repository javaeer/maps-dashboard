// 区域名称立体标签层
//
// 需求：开关打开后，在当前层级的每个板块上「立体」显示名称——
// 全国地图显示省级名称，进入某省显示市级名称，再下钻显示区县名，进乡镇视图显示乡镇名。
// 因为每次渲染的都是「当前层级的下一级要素」，所以直接取 feature.properties.name 即可，
// 无需按 adcode 反推层级。
//
// 立体构成（每个名称一组）：
//   1. 底座光点：贴在该要素顶面中心，标记名称锚点
//   2. 光柱：从顶面中心升起一段细亮线，形成"从板块里长出来"的立体感
//   3. 悬浮标牌：柱顶之上的圆角底板 + 文字，底板下沿带小箭头指向柱顶
import * as THREE from 'three'

const FONT_PX = 54     // 标牌文字字号（canvas 像素）
const PPU = 1.7        // 像素 → 世界单位换算（决定标牌在世界里的物理大小）
const POLE_H = 34      // 光柱高度（世界单位）
const PLATE_GAP = 16   // 标牌底沿到柱顶的间隙
const DOT_R = 7        // 底座光点半径

// 标牌字号随相机距离自适应：太远看不清、太近糊成一片，夹在 [0.62, 1.5] 倍之间
const MIN_K = 0.62
const MAX_K = 1.5
const REF_DIST = 1500  // 基准距离：相机与地图中心约此距离时按 1 倍显示

let _dotTex = null
function dotTexture() {
  if (_dotTex) return _dotTex
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.35, 'rgba(186,230,253,0.75)')
  grad.addColorStop(1, 'rgba(125,211,252,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  _dotTex = new THREE.CanvasTexture(c)
  return _dotTex
}

/** 圆角矩形路径（不用 ctx.roundRect：其浏览器支持面窄，这里是核心渲染路径不宜依赖） */
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

/**
 * 名称标牌纹理：深色半透明底板 + 亮色描边 + 白色文字，保证压在任何底色上都可读。
 * 底板下沿画一个小三角，视觉上"钉"在光柱顶端。
 */
function plateTexture(text) {
  const padX = 36
  const w = Math.max(210, Math.ceil(text.length) * FONT_PX + padX * 2)
  const h = 108
  const tail = 18 // 底部小箭头高度

  const c = document.createElement('canvas')
  c.width = w
  c.height = h + tail
  const g = c.getContext('2d')

  // 外发光：先画一层模糊描边，让标牌在亮色板块上也能"浮"起来
  g.shadowColor = 'rgba(8, 20, 38, 0.9)'
  g.shadowBlur = 14
  g.shadowOffsetY = 3
  roundRectPath(g, 8, 8, w - 16, h - 16, 24)
  g.fillStyle = 'rgba(9, 22, 42, 0.82)'
  g.fill()
  g.shadowColor = 'transparent'
  g.shadowBlur = 0
  g.shadowOffsetY = 0

  // 小箭头（指向光柱顶）
  g.beginPath()
  g.moveTo(w / 2 - 13, h - 10)
  g.lineTo(w / 2 + 13, h - 10)
  g.lineTo(w / 2, h + tail - 6)
  g.closePath()
  g.fillStyle = 'rgba(9, 22, 42, 0.82)'
  g.fill()

  // 描边
  roundRectPath(g, 8, 8, w - 16, h - 16, 24)
  g.lineWidth = 3
  g.strokeStyle = 'rgba(125, 211, 252, 0.75)'
  g.stroke()

  // 文字
  g.font = `600 ${FONT_PX}px "PingFang SC", "Microsoft YaHei", sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = 'rgba(0, 0, 0, 0.85)'
  g.shadowBlur = 6
  g.fillStyle = '#f2f9ff'
  g.fillText(text, w / 2, h / 2 + 2)

  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  return { tex, w: c.width, h: c.height, tail }
}

export class NameLayer {
  constructor({ scene } = {}) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.renderOrder = 12
    // 标签是装饰物，默认隐藏；由 setVisible 显式打开
    this.group.visible = false
    if (scene) scene.add(this.group)

    this.items = []      // 每组 { world, sprite, spriteW, spriteH, dot, pole }
    this.scale = 1       // 全局字号倍率（UI 可调大小档位）
    this._camera = null
  }

  get visible() {
    return this.group.visible
  }

  get count() {
    return this.items.length
  }

  /**
   * 依据当前层级的要素组重建全部名称标签。
   * @param {THREE.Group[]} featureGroups 需含 userData.centerWorld 与 userData.feature
   */
  build(featureGroups = []) {
    this.clear()
    for (const fg of featureGroups) {
      const world = fg && fg.userData && fg.userData.centerWorld
      if (!world) continue
      const props = (fg.userData.feature && fg.userData.feature.properties) || {}
      const name = props.name || props.NAME || ''
      if (!name) continue
      this._add(name, world.clone())
    }
    this.group.visible = this.group.visible && this.items.length > 0
    return this.items.length
  }

  _add(text, world) {
    const { tex, w, h, tail } = plateTexture(text)

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false // 标牌浮在板块之上，不被地形遮挡（否则斜坡视角下会被前面的板块切掉一半）
      })
    )
    // 锚点对齐：Sprite 以中心定位，标牌的"箭头尖"应落在柱顶 → 中心需再上移 (h/2 - tail)
    const sw = w / PPU
    const sh = h / PPU
    sprite.scale.set(sw, sh, 1)
    sprite.position.set(world.x, world.y + POLE_H + PLATE_GAP + (sh / 2 - tail / PPU), world.z)
    sprite.renderOrder = 14
    // 标牌浮在要素上方，若参与射线检测会先于板块被命中，导致点击落到标签上而选不中区域
    sprite.raycast = () => {}

    const dot = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: dotTexture(),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    dot.scale.set(DOT_R, DOT_R, 1)
    dot.position.copy(world)
    dot.raycast = () => {}

    const poleGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, POLE_H, 0)
    ])
    const pole = new THREE.Line(
      poleGeo,
      new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    pole.position.copy(world)
    pole.raycast = () => {}

    this.group.add(dot)
    this.group.add(pole)
    this.group.add(sprite)
    this.items.push({ world, sprite, pole, dot, baseW: sw, baseH: sh })
  }

  /** 开关：显示 / 隐藏全部名称 */
  setVisible(v) {
    this.group.visible = !!v && this.items.length > 0
    return this.group.visible
  }

  /** 字号档位：0.8 / 1 / 1.25 之类 */
  setScale(k) {
    this.scale = Math.max(0.5, Math.min(2, Number(k) || 1))
    this._applyScale(1)
  }

  /**
   * 每帧按相机距离调整标牌大小，保证远近都可读。
   * @param {THREE.Camera} camera
   */
  update(camera) {
    if (!this.group.visible || !camera) return
    this._camera = camera
    // 用「相机到地图中心」的整体距离做统一倍率：
    // 逐个标签算距离会让同一屏的标签大小不一致，看着像抖动
    const d = camera.position.length()
    const k = THREE.MathUtils.clamp(d / REF_DIST, MIN_K, MAX_K)
    this._applyScale(k)
  }

  _applyScale(k) {
    const s = this.scale * k
    for (const it of this.items) {
      it.sprite.scale.set(it.baseW * s, it.baseH * s, 1)
    }
  }

  clear() {
    for (const it of this.items) {
      this.group.remove(it.sprite)
      this.group.remove(it.pole)
      this.group.remove(it.dot)
      if (it.sprite.material.map) it.sprite.material.map.dispose()
      it.sprite.material.dispose()
      it.pole.geometry.dispose()
      it.pole.material.dispose()
      it.dot.material.dispose()
    }
    this.items = []
  }

  dispose() {
    this.clear()
    if (this.scene) this.scene.remove(this.group)
  }
}
