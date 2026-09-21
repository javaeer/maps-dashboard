# maps-dashboard

交互式**中国 3D 地图可视化大屏**。基于 Vue 3 + Three.js + UnrealBloom 构建：点击省 / 市 / 区县即可弹出信息面板，展示**地名、人口、土地面积、图片集合**以及 GDP、简介、标签等**自定义信息**；支持行政层级下钻，并可**深入到乡镇/街道点位**；地图数据默认**缓存进本项目**，离线/弱网也能流畅运行。

> 本项目是对一批优秀开源库（Three.js、Vue、d3-geo、three-globe，以及 `zhanghang2017/threemap`、`wangscript007/ThreeMaps` 等）的整合落地。

## ✨ 功能特性

- 🗺️ **中国 3D 地图**：全国 → 省 → 市 → **区县** 四级面下钻（双击区域）
- 📍 **深入各镇**：双击某个**区县**，在其上叠加该区县的**乡镇 / 街道点位**（光柱 + 发光点 + 名称标签），点击点位查看镇级信息
- 🖱️ **点击查看信息**：单击区域 / 点位弹出信息面板，展示地名 / 人口 / 土地面积 / 图片集合 / GDP / 简介 / 标签
- 🔍 **下钻与回退**：双击下钻、右键返回上级、顶部面包屑快速回跳（含镇级）
- 💾 **数据本地缓存**：全国 + 省 + 市几何已随仓库提交；更深层级走「本地静态 → 浏览器 IndexedDB → DataV」三级加载，首次看完即缓存
- 🌟 **最完美动画方案**（综合 threemap / ThreeMaps 最佳实践）：
  - `UnrealBloom` 选择性辉光后处理
  - 拉伸块**侧面扫光 Shader**（流光扫描）
  - 顶面**发光描边**（锐利数据可视化边线）
  - 点击**脉冲扩散环** + 飞向中心的**飞线**
  - 选中区域**高亮聚焦**，相机平滑缓动；空闲时地图缓慢自转（turntable）

## 🧱 技术栈与出处

| 模块 | 技术 | 协议 | 说明 |
| --- | --- | --- | --- |
| 前端框架 | [Vue 3](https://github.com/vuejs/core) | MIT | 组件与状态 |
| 3D 渲染 | [Three.js](https://github.com/mrdoob/three.js) | MIT | 场景 / 拉伸 / 拾取 |
| 地理投影 | [d3-geo](https://github.com/d3/d3-geo) | ISC | GeoJSON → 平面坐标（含手动墨卡托适配） |
| 辉光后处理 | `three/examples/jsm` UnrealBloomPass | MIT | 边界辉光 |
| 地图几何 | [阿里 DataV.GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector) | 免费 | 抓取脚本预缓存，运行时三级加载 |
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

> 仓库已内置 `public/geo/` 下的**全国 + 省 + 市**几何（约 27MB）。如需把**区县**也缓存进仓库，执行 `MAX_LEVEL=3 npm run fetch-geo`（约 +290MB，建议配合 git-lfs 或 `.gitignore`）。
>
> **县级下钻说明**：DataV **不提供**县级 `_full.json`（404），只提供县级自身边界 `{adcode}.json`。双击区县时会自动回退加载该文件渲染**县级底图**再叠加乡镇点位（在线拉取并写入浏览器 IndexedDB 缓存）；白银市 5 个县（含会宁县 620422）已预置在 `public/geo/` 中，首次加载零请求。

## 🎮 交互说明

| 操作 | 效果 |
| --- | --- |
| 左键拖拽 | 旋转视角 |
| 滚轮 | 缩放 |
| **单击区域** | 选中并弹出信息面板（聚焦 + 脉冲 + 飞线） |
| **双击区域** | 下钻到该区域的下级行政区；双击「区县」则叠加镇级点位 |
| **单击点位** | 选中乡镇 / 街道并弹出信息面板 |
| **右键** | 返回上一级（镇级视图 → 上级地图） |
| 面包屑点击 | 跳转到对应层级（含镇级） |

## 📦 数据缓存策略

地图几何默认**三级加载**（`src/map/geoLoader.js`）：

1. **本地静态文件** `public/geo/<adcode>_full.json` —— 构建时由抓取脚本预下载并提交到仓库，离线可用
2. **浏览器 IndexedDB** —— 运行时缓存，首次看完即写入，刷新/断网后直接命中
3. **阿里 DataV 在线接口** —— 兜底；失败或叶子节点返回 `null`

抓取脚本（`scripts/fetch-geo.mjs`）可断点续传、并发可控：

```bash
npm run fetch-geo            # 全国 + 省 + 市（默认 MAX_LEVEL=2）
MAX_LEVEL=3 npm run fetch-geo   # 额外抓取 区县（约 +290MB）
node scripts/fetch-geo.mjs --force   # 强制覆盖已存在文件
```

> ⚠️ **DataV 的几何下限是「区 / 县」（6 位 adcode）**：它不提供镇 / 街道的多边形。但本项目已从独立数据源拿到**真实乡镇边界**，双击区县时渲染为「贴在县顶面上的乡镇浮雕子图层」（见下），不再是近似点位。

## 📍 镇级边界数据（真实乡镇多边形）

双击任意**区县**，会在其 3D 地图顶面上叠加该区县下所有**乡镇 / 街道的真实边界多边形**（薄浮雕 + 发光描边），点击乡镇显示其行政区划信息。

**边界数据源**：[rooma1989/china_geo_data](https://github.com/rooma1989/china_geo_data) —— 全国各乡镇的 GeoJSON 多边形，按 `省 / 市 / geo_县.json` 组织。**已校验其坐标系与 DataV 县底图完全一致**（bbox 中心差仅 ~0.002°，无需坐标转换），乡镇边界精确贴合在县境内。

**数据落到本地，不依赖浏览器缓存**：乡镇边界直接下载进 `public/geo/towns/<区县 6 位 adcode>_geo.json`，随仓库 / 构建产物分发，**完全离线可用**；仅当本地缺失时才回退到「IndexedDB → 在线 jsDelivr 拉取」两级兜底（路径由内置索引 `public/geo/town_geo_index.json`，覆盖全国 2,840 个区县，按 `省/市/geo_县.json` 拼出）。

批量下载脚本（`scripts/fetch-town-geo.mjs`，断点续传 + 并发 8 + DP 简化 + 失败重试）：

```bash
node scripts/fetch-town-geo.mjs          # 全国（约 2,840 个县）
node scripts/fetch-town-geo.mjs 62       # 仅甘肃省
node scripts/fetch-town-geo.mjs 6204     # 仅白银市
node scripts/fetch-town-geo.mjs 620422   # 仅会宁县
CONCURRENCY=16 TOL=0.002 node scripts/fetch-town-geo.mjs   # 并发/简化容差可调
```

> 单县边界原始精度很高（约 1~2MB），下载时用 Douglas-Peucker（默认容差 0.0009 ≈ 90m）简化到几十 KB。
> ⚠️ 简化必须**先拆掉 GeoJSON 闭合环的重复末点再简化、最后补回**——否则首尾点重合会让首尾连线长度为 0，DP 把所有点距离算成 0，环被退化成 2 个点，产生「要素存在但零面积、完全不可见」的网格（本项目早期踩过这个坑，已在 `simplifyRing` 修复并在 `buildShapes` 加了外环点数防御）。

**点位数据（兜底）**：若某区县暂无边界数据，则回退到 [modood/Administrative-divisions-of-China](https://github.com/modood/Administrative-divisions-of-China) 的 `streets.json` 生成的近似点位（`public/geo/towns/<区县 adcode>.json`，共 2,822 个区县、约 40,467 个点位，坐标为「区县质心 + 微抖动」的近似位置）。

单文件格式为数组（字段含义见注释）：

```json
[
  {
    "name": "仓前街道",
    "lng": 119.97, "lat": 30.30,   // WGS84 经纬度（近似：区县质心 + 抖散）
    "adcode": "330110001",          // 9 位乡镇 adcode
    "type": "街道",                 // 自动归类：街道 / 镇 / 乡 / 民族乡
    "population": 12.3, "area": 48.2,   // 仅手工精修样例含人口/面积；自动生成的留空，面板显示「—」
    "intro": "未来科技城核心区……",
    "tags": ["街道", "城西科创大走廊"],
    "gdp": ""
  }
]
```

**重新生成 / 刷新**（一行命令，自动联网拉取 `streets.json` 并写入 `public/geo/towns/`）：

```bash
npm run build-towns             # 生成全部（已存在的文件跳过，保留手工精修样例）
node scripts/build-towns.mjs --force   # 覆盖全部重新生成
node scripts/build-towns.mjs /path/streets.json  # 用本地文件，避免联网
```

- 仓库自带**余杭区（330110）**与**萧山区（330109）**的**手工精修**样例（真实镇名 + 较准确坐标 + 简介），生成脚本默认**跳过**这两个文件不覆盖。
- 极少数近期区划调整导致的边缘乡镇（约 846 条）因父区县质心缺失未生成，可用 `MAX_LEVEL=3 npm run fetch-geo` 补齐区县几何后重跑 `build-towns` 覆盖。

## 📝 区域元数据扩展

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
├── scripts/
│   ├── fetch-geo.mjs        # 抓取 DataV 行政区划 GeoJSON 到 public/geo/
│   └── build-towns.mjs      # 由 streets.json 生成全国全部乡镇点位到 public/geo/towns/
├── public/
│   └── geo/                 # 缓存的行政区划几何（已提交 全国+省+市，约 27MB）
│       ├── 100000_full.json
│       ├── 330000_full.json
│       └── towns/           # 镇级点位数据（2,822 个区县文件 / ~40,467 点位）
│           ├── 330110.json  #   余杭区（手工精修样例，含人口/面积/简介）
│           ├── 330109.json  #   萧山区（手工精修样例）
│           └── ……（其余各区县自动生成，按 adcode 命名）
└── src/
    ├── main.js
    ├── App.vue
    ├── style.css
    ├── map/
    │   ├── ThreeMap.js      # 核心类：场景/相机/控制/辉光/加载/下钻/拾取/聚焦/镇点位
    │   ├── geoLoader.js     # 三级缓存加载（本地→IndexedDB→DataV）+ 镇数据
    │   └── extrude.js       # GeoJSON → 3D 拉伸 + 侧面扫光 Shader + 顶面描边
    ├── effects/
    │   ├── bloom.js         # UnrealBloom 辉光
    │   ├── ripple.js        # 点击脉冲扩散环
    │   ├── flyLine.js       # 飞线
    │   └── town.js          # 镇级点位（光柱 + 发光点 + 名称标签）
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
