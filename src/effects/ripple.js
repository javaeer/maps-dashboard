import * as THREE from 'three'

// 点击区域的脉冲扩散环（水平面 Shader）
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const fragmentShader = /* glsl */ `
  uniform float uProgress;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float d = distance(vUv, vec2(0.5)) * 2.0; // 0(中心)..1(边缘)
    if (d > 1.0) discard;
    float radius = uProgress;            // 环半径随时间外扩
    float ring = smoothstep(radius, radius - 0.06, d) *
                 smoothstep(radius - 0.28, radius, d);
    float alpha = ring * (1.0 - uProgress); // 后期淡出
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`

// center: THREE.Vector3（世界坐标，水平面）
export function createRipple(center, color = 0x38bdf8, size = 160) {
  const geo = new THREE.PlaneGeometry(size, size)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color(color) }
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.copy(center)
  mesh.position.y += 40

  let progress = 0
  const speed = 0.85
  return {
    mesh,
    update(dt) {
      progress = Math.min(progress + dt * speed, 1)
      mat.uniforms.uProgress.value = progress
      return progress < 1 // 返回 false 表示动画结束
    },
    dispose() {
      geo.dispose()
      mat.dispose()
    }
  }
}
