import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// 配置 UnrealBloom 辉光后处理（threemap / ThreeMaps 验证过的“最完美”辉光方案）
// strength: 辉光强度, radius: 扩散半径, threshold: 亮度阈值（越低越多元素发光）
export function createComposer(renderer, scene, camera, width, height) {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.85, // strength
    0.5, // radius
    0.12 // threshold
  )
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  return { composer, bloom }
}
