import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// 配置 UnrealBloom 辉光后处理（threemap / ThreeMaps 验证过的“最完美”辉光方案）
// strength: 辉光强度, radius: 扩散半径, threshold: 亮度阈值（越低越多元素发光）
export function createComposer(renderer, scene, camera, width, height, paper = null) {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  // 纸质主题（兵要地志）几乎要关掉泛光：纸不发光，留一点只为朱砂兵锋线不至于发死。
  // 沿用「strength / radius / threshold」三参数，阈值抬高到只让高亮处轻微晕开。
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    paper ? paper.bloom : 0.35, // strength
    paper ? 0.2 : 0.3, // radius
    paper ? 0.85 : 0.5 // threshold
  )
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  return { composer, bloom }
}
