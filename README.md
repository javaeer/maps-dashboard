# maps-dashboard

交互式**中国 3D 地图可视化大屏**。基于 Vue 3 + Three.js + UnrealBloom 构建：点击省 / 市 / 区即可弹出信息面板，展示**地名、人口、土地面积、图片集合**以及 GDP、简介、标签等**自定义信息**；支持行政层级下钻，并采用该领域公认视觉最完整的动画方案。

> 本项目是对上一轮梳理的一批优秀开源库（Three.js、Vue、d3-geo、three-globe，以及 `zhanghang2017/threemap`、`wangscript007/ThreeMaps` 等）的整合落地。

## ✨ 功能特性

- 🗺️ **中国 3D 地图**：省 → 市 → 区 三级下钻（地图几何运行时从阿里 DataV 加载）
- 🖱️ **点击查看信息**：单击区域弹出信息面板，展示地名 / 人口 / 土地面积 / 图片集合 / GDP / 简介 / 标签
- 🔍 **下钻与回退**：双击下钻、右键返回上级、顶部面包屑快速回跳
- 🌟 **最完美动画方案**（综合 threemap / ThreeMaps 最佳实践）：
  - `UnrealBloom` 选择性辉光后处理
  - 拉伸块**侧面扫光 Shader**（流光扫描）
  - 点击**脉冲扩散环** + 飞向中心的**飞线**
  - 选中区域**高亮聚焦**，相机平滑缓动

## 🧱 技术栈与出处

| 模块 | 技术 | 协议 | 说明 |
| --- | --- | --- | --- |
| 前端框架 | [Vue 3](https://github.com/vuejs/core) | MIT | 组件与状态 |
| 3D 渲染 | [Three.js](https://github.com/mrdoob/three.js) | MIT | 场景 / 拉伸 / 拾取 |
| 地理投影 | [d3-geo](https://github.com/d3/d3-geo) | ISC | GeoJSON → 平面坐标 |
| 辉光后处理 | `three/examples/jsm` UnrealBloomPass | MIT | 边界辉光 |
| 地图几何 | [阿里 DataV.GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector) | 免费 | 运行时 `fetch` 加载 |
| 参考实现 | `zhanghang2017/threemap`、`wangscript007/ThreeMaps` | — | 3D 下钻 / 扫光思路借鉴 |

## 🚀 快速开始

```bash
git clone https://github.com/javaeer/maps-dashboard.git
cd maps-dashboard
npm install
npm run dev       # 开发预览 http://localhost:5173
npm run build     # 生产构建，输出到 dist/
npm run preview   # 预览构建产物
```

## 🎮 交互说明

| 操作 | 效果 |
| --- | --- |
| 左键拖拽 | 旋转视角 |
| 滚轮 | 缩放 |
| **单击区域** | 选中并弹出信息面板（聚焦 + 脉冲 + 飞线） |
| **双击区域** | 下钻到该区域的下级行政区 |
| **右键** | 返回上一级 |
| 面包屑点击 | 跳转到对应层级 |

## 📝 数据扩展

区域属性（人口 / 面积 / 图片 / 自定义字段）集中在 `src/data/regionMeta.js`，**按 adcode 索引**：

```js
export const regionMeta = {
  "330000": {
    name: "浙江省",
    population: 6457,                 // 单位：万人
    area: 105500,                     // 单位：km²
    images: ["https://.../a.jpg", "https://.../b.jpg"],
    custom: {
      gdp: "77715 亿元（人民币）",
      intro: "民营经济活跃，山水秀美……",
      tags: ["省份", "华东", "民营经济"]
    }
  }
}
```

- 内置全国 + 34 个省级行政区的**示例数据**（人口 / 面积取自公开统计近似值，图片为占位图），生产环境请替换为权威来源与真实图片。
- 未登记的区域（如市、区）点击后仍会显示**地名**，人口 / 面积 / 图片回退为占位。

## 📂 目录结构

```
maps-dashboard/
├── index.html
├── vite.config.js
├── package.json
├── README.md
├── LICENSE
└── src/
    ├── main.js
    ├── App.vue
    ├── style.css
    ├── map/
    │   ├── ThreeMap.js      # 核心类：场景/相机/控制/辉光/加载/下钻/拾取/聚焦
    │   ├── geoLoader.js     # 按 adcode 从 DataV 加载 GeoJSON
    │   └── extrude.js       # GeoJSON → 3D 拉伸 + 侧面扫光 Shader
    ├── effects/
    │   ├── bloom.js         # UnrealBloom 辉光
    │   ├── ripple.js        # 点击脉冲扩散环
    │   └── flyLine.js       # 飞线
    ├── components/
    │   ├── InfoPanel.vue     # 信息面板（地名/人口/面积/图片/自定义）
    │   ├── Breadcrumb.vue    # 下钻面包屑
    │   └── ImageGallery.vue  # 图片集合（网格 + 放大）
    ├── data/
    │   └── regionMeta.js     # 区域元数据（人口/面积/图片/自定义）
    └── utils/
        └── format.js         # 数值格式化
```

## 📄 License

[MIT](./LICENSE)
