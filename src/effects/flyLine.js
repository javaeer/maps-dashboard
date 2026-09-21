import * as THREE from 'three'

// 选中区域 → 地图中心 的飞线（二次贝塞尔弧线 + 沿线流动光点）
export function createFlyLine(start, end, color = 0x22d3ee) {
  const mid = start.clone().add(end).multiplyScalar(0.5)
  mid.y += start.distanceTo(end) * 0.4 + 260 // 控制点上抬，形成弧
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end)

  const tubeGeo = new THREE.TubeGeometry(curve, 50, 5, 8, false)
  const tubeMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.32,
    depthWrite: false
  })
  const tube = new THREE.Mesh(tubeGeo, tubeMat)

  const dotGeo = new THREE.SphereGeometry(13, 16, 16)
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const dot = new THREE.Mesh(dotGeo, dotMat)

  const group = new THREE.Group()
  group.add(tube)
  group.add(dot)

  let t = 0
  const speed = 0.55
  return {
    mesh: group,
    update(dt) {
      t = (t + dt * speed) % 1
      dot.position.copy(curve.getPointAt(t))
      return true // 循环播放
    },
    dispose() {
      tubeGeo.dispose()
      tubeMat.dispose()
      dotGeo.dispose()
      dotMat.dispose()
    }
  }
}
