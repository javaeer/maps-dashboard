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
| **F 键 / 右上角「全屏」按钮** | 进入 / 退出**全屏**（Esc 亦可退出） |

### 🖥️ 全屏

- 对**舞台容器**（`.stage`）而非整个文档发起全屏，因此顶栏、面包屑、信息面板、路径控制条在全屏下依然可见可用。
- 尺寸自适应：进入 / 退出全屏时 `window` 的 `resize` **不保证触发**，故 ThreeMap 另挂了 `ResizeObserver` 盯容器尺寸 + `fullscreenchange` 兜底，随即重算 `camera.aspect` 并 `renderer.setSize` / `composer.setSize`，画面不会被拉伸。
- 全屏下 `body` 的径向渐变不再生效，`.stage:fullscreen` 单独补了背景，不会出现纯黑底。
- 快捷键做了输入保护：焦点在 `input` / `textarea` / `select` / 可编辑元素时按 `F` 不会误触发（路径控制条的速度滑块即属此列）。
- 全屏监听与快捷键在 `onMounted` 中**先于**地图初始化注册 —— 否则地图初始化失败（如环境不支持 WebGL）时，UI 控制会跟着一起失效。

## 🛤️ 路径巡航（追加路径点 → 发光管道 → 相机跟拍）

进入乡镇视图后，依次单击乡镇即形成一条**发光管道航线**，并可用相机沿管道巡航跟拍。

| 操作 | 效果 |
| --- | --- |
| 依次单击乡镇 | 追加路径点，管道分段即时生长，相机平滑飞向新点 |
| 重复单击同一乡镇 | 不重复加点，提示「已在路径中」 |
| 「巡航」按钮 | 相机沿整条管道匀速跟拍（循环），期间接管镜头 |
| 「暂停」 | 停下并把当前视点交回手动控制，镜头不跳变 |
| 速度滑块 | 60–900 世界单位/秒，同时换算显示 ≈km/h |
| 路径列表点击 | 相机飞回对应路径点 |
| 「撤销」/「清空」 | 回退一个点 / 清空整条路径 |
| 标题栏箭头 | 折叠成左下角小胶囊（状态记入 localStorage） |
| 切换区县 | 自动清空路径（坐标系已变化） |

控制条摆放在**左下角竖排**（宽 252px，路径点列表限高 5 行内滚动）：

- 右上已被信息面板占据，左下是大屏视觉盲区，两者形成左右对称的双栏格局；
- 折叠后为一条 `≈186×36` 小胶囊，**完全落在地图主体区域之外**（展开态也只压地图左下角约 4% 面积）；
- 进入路径后底部中央的操作提示自动隐藏，避免与控制条抢占同一区域。

实现位于 `src/effects/routePath.js` + `src/components/RouteBar.vue`，三个环节各自独立可复用：

1. **追加路径点** — `RoutePath.addPoint(center, meta)` 把乡镇中心抬升 46 单位后入列。
2. **分段发光管道** — 每段独立 `TubeGeometry`：
   - 段曲线用 `[p(i-1), p(i), p(i+1), p(i+2)]` 四点 CatmullRom 的 `[1/3, 2/3]` 子区间，
     保证接缝处切线连续（实测夹角 **0.01°**，肉眼无折角）。
   - 追加新点只重建末尾两段，**更早的段完全不动**（实测段 0/1 长度与形状零变化），
     避免整体重建导致的整条路径抖动。
   - 段间关节：发光球 + 序号 Sprite。
   - 材质为流动光带 Shader：`fract(uv.x * uRepeat - uTime * uSpeed)` 沿轴向循环，
     `uRepeat = 段长 / 90` 保证各段条纹物理长度一致；叠菲涅尔边缘光，配合 UnrealBloom 发光。
3. **相机平滑跟拍** — 另用一条覆盖全部路径点的全局 CatmullRom 做**弧长参数化**采样
   （只服务相机，不参与渲染），相机挂在采样点后上方 210、高 135 处，视线落在前方 160：
   ```
   camera.position → lerp(P - T*210 + up*135, 0.09)
   lookAt          → lerp(P + T*160,         0.12)
   ```
   巡航期间跳过 `OrbitControls.update()`，避免两套插值互相拉扯；退出时把末帧视点写入
   `controls.target`，交回手动控制时镜头不跳变。

```js
// 直接在代码中驱动
map.addRoutePoint(centerWorld, { name: '会师镇' })  // 由 _selectTown 内部调用
map.startCruise()      // 开始沿管道跟拍（不足 2 点返回 false）
map.setCruiseSpeed(400)
map.stopCruise()       // 交回手动控制
map.clearRoute()
```

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

## 🎨 配色主题

内置三套主题，统一饱和度 / 明度、只拉开色相跨度，做到「丰富而不杂乱」。色相用**黄金比低差异序列**（0.618…）分配，相邻要素色差最大，连片同色的问题不会出现。

| 主题 | 色域 | 气质 |
|------|------|------|
| `tech` 科技蓝青 | 青 150°→ 蓝 235° | 经典大屏，克制 |
| `aurora` 极光多彩（默认）| 绿 120°→ 紫 330° | 色彩最丰富，展示用 |
| `sunset` 暖橙霞光 | 品红 330°→ 橙黄 60° | 偏正式汇报 |

两种切换方式：

1. 页面右上角**主题按钮**（带配色预览条），点击即切换；
2. 直接加 URL 参数，便于现场演示：`http://localhost:4173/?palette=tech`

> 实现见 `src/map/palette.js`。注意别用「黄金角取模」分配色相——色域窄时 `(idx*137.508)%span` 会塌缩成两三个值来回震荡（实测 tech 主题只剩 2 种色相），改用低差异序列后任意色域宽度都是 10/10 独立色相。

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

**覆盖率与缺失原因**：当前覆盖 **2,568 / 2,840 区县（约 90%）**。剩余约 272 个抓不到，两类原因：

1. `rooma1989/china_geo_data` 是旧版区划快照，**2018 年后新设 / 撤县设区的区县在源仓库里不存在**——如大同市平城区（140213）、云冈区（140214）、怀仁市（140681）、太谷区（140703）、潞州区（140403）等；
2. **西藏（43 个）、香港（18 个）等地区源数据覆盖不足**。

### 🔁 补齐缺失区县（高德 Web 服务 API）

免费无 key 的乡镇边界源基本没有了：`geojson.hxkj.vip` 的 `/api` 已下线（首页 200、接口 404），`xiangyuecn/AreaCity-JsSpider-StatsGov` 的乡镇级边界 `ok_geo4_*.csv` 是**付费数据**（免费的 `ok_geo.csv` 只到区县三级）。最靠谱的免费途径是**高德地图 Web 服务 API**（个人开发者 3 万次/日，补 272 个县绰绰有余）：

```bash
# 1) 到 https://console.amap.com/ 注册 → 创建应用 → 添加 Key（服务平台选「Web服务」）
# 2) 补齐所有缺失区县
AMAP_KEY=你的key node scripts/fetch-town-amap.mjs
# 只补山西省缺失的
AMAP_KEY=你的key node scripts/fetch-town-amap.mjs 14
```

脚本会自动跳过已有数据、只补缺失项，产出的 `_geo.json` 与既有格式完全一致（已内置 polyline 解析：多地块 `|` 分隔、点 `;` 分隔，并自动补闭合环）。坐标系同为 GCJ-02，无需转换。

**先自检 Key，别急着抓**：

```bash
AMAP_KEY=你的key node scripts/fetch-town-amap.mjs --check
```

#### ❗ `INVALID_USER_KEY` 排查清单

这是最常见的报错，按概率排序：

1. **服务平台类型选错（约占九成）** —— REST 接口只认 **【Web服务】**。在控制台把这个 Key 的平台类型改成 Web服务，或者新建一个「服务平台 = Web服务」的 Key。选成 `Web端(JS API)` / `Android` / `iOS` 调用 REST 都会被拒。
2. **Key 没复制全** —— 应为 32 位，`--check` 会打印实际长度。
3. **开了数字签名** —— 若控制台启用了数字签名，把私钥填到 `AMAP_PRIVATE_KEY`（脚本会自动按字典序拼参加 md5 签名）；不需要就关掉签名。

脚本内置错误码人话解释：`INVALID_USER_KEY` / `USERKEY_PLAT_NOMATCH` / `INVALID_USER_SCODE` / `DAILY_QUERY_OVER_LIMIT` 等都会直接给出处置建议。

> 若暂时拿不到可用 Key，这 272 个区县会自动回退到**点位标记**模式（光柱 + 点位），不影响其余 90% 区县的乡镇边界渲染。

> 顺带说明：免费无 Key 的乡镇边界源目前基本不可用——`geojson.hxkj.vip` 的 `/api` 已下线（首页 200、接口 404）；`xiangyuecn/AreaCity-JsSpider-StatsGov` 的乡镇级边界是付费数据；OSM Overpass 虽免 Key 但区域查询频繁 504 超时、且无 adcode 可用于精确匹配，不适合做批量补抓。

**点位数据（兜底）**：若某区县暂无边界数据（既无 rooma1989 也未用高德补齐），则回退到 [modood/Administrative-divisions-of-China](https://github.com/modood/Administrative-divisions-of-China) 的 `streets.json` 生成的近似点位（`public/geo/towns/<区县 adcode>.json`，共 2,822 个区县、约 40,467 个点位，坐标为「区县质心 + 微抖动」的近似位置）。

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

## 🏘️ 乡镇展示数据（政府门户采集）

除几何边界外，乡镇还需要**人口、辖区面积、下辖村 / 社区**等人文属性。以会宁县为样板，这些数据全部从
[会宁县人民政府](https://www.huining.gov.cn/) 公开栏目采集，脚本化生成，产出 `public/geo/towns/620422_info.json`。

```bash
npm run fetch-town-info                            # 采集并生成（默认 620422 会宁县）
node scripts/fetch-town-info.mjs --refresh         # 忽略本地缓存重新抓取
node scripts/fetch-town-info.mjs --county 620422   # 指定区县
```

### 数据来源

| 栏目 | URL | 提供字段 |
| --- | --- | --- |
| 会宁概况 | `/mlhn/hngk/` | 辖区面积、人口、户数、村 / 社区数、耕地、海拔、降雨、气温、无霜期、距县城里程、简介 |
| 乡镇信息公开 → 村务公开 | `/xxgk/xzxxgk/<slug>/fdzdgknr/cwgk/` | **下辖行政村 / 社区完整名单**（现行建制） |
| 乡镇信息公开 → 机关简介 | `/xxgk/xzxxgk/<slug>/fdzdgknr/jgjj/` | 办公地址、联系电话、邮政编码、电子邮箱、办公时间 |

> 概况栏目列表为 AJAX 构建，脚本直接调用其分页接口
> `/api-gateway/jpaas-publish-server/front/page/build/unit?…&paramJson={"pageNo":n,"pageSize":15}`。

### 采集结果（会宁县，28 个乡镇）

| 指标 | 采集值 | 县公布值 | 说明 |
| --- | --- | --- | --- |
| 乡镇 | 28 | 28 | 全覆盖 |
| 辖区面积 | 6,496.2 km² | 6,439 km² | 各乡镇公布年份不同（2018—2026），口径略有出入 |
| 行政村 | 279 | 284 | 部分乡镇「村务公开」未公开全部建制村 |
| 社区 | 37 | 38 | 同上 |
| 户籍人口 | 591,161 | 560,700 | 部分乡镇公布的是常住 / 总人口，柴家门镇仅计农业人口 |

### 输出格式

```jsonc
{
  "schema": "maps-dashboard/town-info@1",
  "county": "620422",
  "sources": [ { "label": "会宁县人民政府 · 会宁概况", "url": "…" } ],
  "countySummary": { "areaKm2": 6439, "population": 560700, "villageCount": 284, "communityCount": 38 },
  "aggregated": { "townCount": 28, "areaKm2": 6496.2, "registeredPopulation": 591161 },
  "towns": [
    {
      "name": "会师镇",          // 官网现行名
      "adcode": "620422100",
      "geoName": "会师镇",        // 边界数据中的名称（可能为旧名，如「新庄乡」→「新庄塬镇」）
      "renamed": false,
      "areaKm2": 203.6,
      "population": 136000,      // 单位：人
      "households": 21095,
      "urbanPopulation": 42500, "ruralPopulation": 18600, "floatingPopulation": 74900,
      "villages": ["南什村", "南咀村"],
      "communities": ["东山根社区", "广场社区"],
      "villageCount": 8, "communityCount": 12,
      "profileVillageCount": 8,  // 概况页公布值，与名单条数不一致时供对照
      "farmlandMu": 115000, "farmlandWanMu": 11.5,
      "altitude": "1800-2100米", "rainfall": "不足400毫米", "temperature": "12.15℃",
      "distanceToCountyKm": 0,   // 官网公路里程
      "straightLineKm": 0,       // 按经纬度计算的直线距离（勿与前者混用）
      "govAddress": "会宁县会师镇桃林路3号", "phone": "0943-3221106",
      "zipCode": "730799", "email": "", "officeHours": "",
      "intro": "…", "profileUrl": "…"
    }
  ]
}
```

### 名称对齐

三方来源命名口径不一致，由 `src/utils/townName.js` 统一处理：

- 边界数据多为撤乡设镇前的**旧名**：`新庄乡` `汉家岔乡` `侯家川乡` `草滩乡` …
- 点位数据用**现行名**：`新庄镇` `汉家岔镇` …
- 政府门户用**最新名**：`新庄塬镇` `汉家岔镇` …

统一去掉通名后比对，并对改名 / 异名做映射（`新庄 → 新庄塬`、`白塬 → 白草塬`、`汉岔 → 汉家岔`、`头寨 → 头寨子`）。
当前 28/28 边界名与 28/28 点位名均可正确匹配到官方信息。

### 面板扩展

信息面板（`src/components/InfoPanel.vue`）在基础字段之外新增分区，可继续按需扩充：

- **人口与土地**：户籍 / 总人口、户数、常住 / 城镇 / 农业 / 流动人口、辖区面积、耕地、村民 / 居民小组
- **下辖村 / 社区**：行政村与社区分色标签
- **地理与气候**：海拔、年降雨量、年平均气温、无霜期、距县城里程
- **政府信息公开**：办公地址、电话、邮编、邮箱、办公时间
- **来源**：官方概况页链接 + 数据来源标注

### 面板遮挡优化

右侧信息面板内容较长（乡镇概况原文上千字、下辖村名可达 20+ 个），最初会把面板撑到 `max-height`
实测遮挡右侧约 **360×660**。做了两层收敛：

| 手段 | 说明 |
| --- | --- |
| 简介截断 | 默认 `-webkit-line-clamp: 3`，超过 140 字才给「展开全文 / 收起」 |
| 分区手风琴 | 人口与土地 / 下辖村社区 / 地理气候 / 政府信息 / 行政区划 / 图片集合默认收起，标题行带条数徽标（如「23 村 · 3 社区」），点开才展开 |
| 村名限高 | 展开后 chips 区限高 148px 内滚动，不会把面板顶到屏幕外 |
| 整体折叠 | 标题栏箭头可收成右侧 `144×44` 小胶囊，状态记入 localStorage |
| 排版收紧 | 分区间距、stats 外边距、来源行收窄 |

实测（1280×800，样本为下辖村最多的镇）：默认态高度 **660 → 535**，折叠态遮挡面积约 **230 px²**（几乎为零）。

> ⚠️ 部分字段源自官网原文，存在笔误可能。脚本按「人均耕地」合理性检测并标记
> `farmlandSuspicious`，面板显示「（原文存疑）」（如新塬镇原文 `1.064万亩`，同段人均 7.7 亩，实际应约 10.64 万亩）。

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
│   ├── build-towns.mjs      # 由 streets.json 生成全国全部乡镇点位到 public/geo/towns/
│   ├── fetch-town-geo.mjs   # 抓取 rooma1989 真实乡镇边界到 public/geo/towns/<adcode>_geo.json
│   └── fetch-town-info.mjs  # 采集政府门户乡镇展示数据 → public/geo/towns/<adcode>_info.json
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
    │   ├── routePath.js     # 路径管道：分段 Tube + 流动光带 Shader + 弧长巡航采样
    │   └── town.js          # 镇级点位（光柱 + 发光点 + 名称标签）
    ├── components/
    │   ├── InfoPanel.vue     # 信息面板（地名/人口/面积/图片/村社区/联系方式/自定义）
    │   ├── Breadcrumb.vue    # 下钻面包屑
    │   ├── RouteBar.vue      # 路径巡航控制条（播放/速度/路径列表）
    │   └── ImageGallery.vue  # 图片集合（网格 + 放大）
    ├── data/
    │   └── regionMeta.js     # 区域元数据（人口/面积/图片/自定义）
    └── utils/
        ├── format.js         # 数值格式化
        └── townName.js       # 乡镇名归一化与跨源匹配（旧名/异名 → 官网现行名）
```

## 📄 License

[MIT](./LICENSE)
