# Phase 1 核心逻辑层 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第一阶段：核心可用能力。
> 本 spec 只覆盖 Phase 1 的**第一个切片：纯逻辑层**（数据模型 + 布局引擎 + 坐标转换），不含 Canvas 渲染与 Vue 组件。

## 头脑风暴决策记录

- **纯逻辑先行**：先实现可被 `node --test` 验证的纯 JS 逻辑，完全不碰 Canvas / Vue。
- **布局级分组纳入 Phase 1**：布局引擎需要把超过阈值的相邻兄弟折叠成分组框并当作聚合节点参与定位，否则坐标不稳定。Phase 1 实现「折叠 + 分组框包围盒」这一层；分组的滚动、虚拟绘制、框内换位交互、展开/折叠等留到 Phase 2。
- **现有测试作为契约**：[test/minimap-layout.test.js](../../../test/minimap-layout.test.js) 已写好、实现待补，按其隐含的 API 与数据结构直接实现（命名/字段按需微调）。

## 范围

### 目标（本切片交付）

- `src/minimap/graph.js`：图数据模型、示例数据、压力数据、框内换位的数据操作。
- `src/minimap/layout.js`：稳定分层树布局、布局级分组折叠、结构性虚拟化、视口锚点补偿。
- `src/minimap/coords.js`：世界 / 屏幕坐标互转（供后续拖入、缩放、框选、overview 复用）。
- 测试：现有 5 条 + 补充若干条，`npm test` 全绿。

### 非目标（后续切片 / 阶段）

- Canvas 渲染器、网格背景、自定义绘制函数（Phase 1 后续切片）。
- Vue 组件壳、资源树 UI、拖入交互（Phase 1 后续切片）。
- 分组框滚动、虚拟绘制、框内换位交互、展开/折叠（Phase 2）。
- 平移/缩放/选择/搜索/overview/撤销重做等（Phase 3+）。

## 数据模型契约

- `graph`：`{ version, nodes, rootIds, edges }`。
- `graph.nodes`：**`Map<id, node>`**（测试依赖 `.get()` / `.size`）。
- `node`：`{ id, label, parentId, children: string[], kind?, width?, height?, data? }`。
- `edge`：`{ id, source, target, label?, kind?, data? }`。
- 父子层级由 `parentId` + `children` 表达；`edges` 表达非父子/跨层/业务关系线，**不参与主布局**。

## 模块 API 契约

### `graph.js`

- `createDemoGraph()` → 能源系统示例图，满足：
  - 存在 `energy-root`（根，直接子节点 ≤ 5，根层不折叠）。
  - 存在 `heap-1`（根的后代），其下 24 个相邻子节点 `cluster-*` 折叠成一个分组；`cluster-8` 是其子节点之一。
  - 存在 `cluster-25`（独立父节点），其下 10 个子节点折叠成一个分组。
- `createStressGraph(n)` → 根 + 1 个父 + `n` 个子；`nodes.size === n + 2`；`n` 个子全部折进单个分组（`n=10000` 时 `size===10002`）。
- `reorderGroupChild(graph, parentId, childId, newIndex)` → 修改 `nodes.get(parentId).children` 顺序，结果保持元素唯一。

### `layout.js`

- `GROUP_THRESHOLD === 5`；同父**相邻**兄弟数量 **> 5（≥6）** 才折叠。
- `computeLayout(graph, { direction: 'horizontal'|'vertical', viewportWidth, viewportHeight })`
  → `{ nodes: Map<id,{x,y,width,height}>, groups: Group[], visibleItems: Item[], bounds }`
  - `Group`：`{ parentId, children: string[], x, y, width, height, overflowY }`，`width ≤ VW*0.48`、`height ≤ VH*0.42`。
  - `horizontal`：深度增大 → `x` 增大；`vertical`：深度增大 → `y` 增大。
  - 父节点定位于其子树 / 子分组的中线。
  - **结构性虚拟化**：被折叠进分组的子节点不单独出现在 `visibleItems`，因此大图 `visibleItems.length ≪ nodes.size`。
- `keepAnchorStable(viewport, beforeWorld, afterWorld)`
  → `{ x: viewport.x + (beforeWorld.x - afterWorld.x) * scale, y: viewport.y + (beforeWorld.y - afterWorld.y) * scale, scale: viewport.scale }`。

### `coords.js`

- `worldToScreen({x,y}, viewport)` → `{ x: x*scale + viewport.x, y: y*scale + viewport.y }`。
- `screenToWorld({x,y}, viewport)` → 上式逆变换。

## 验收标准

沿用 [ROADMAP.md](../../../ROADMAP.md) 第一阶段验收中属于逻辑层的条目，并以测试固化：

- 能生成能源系统示例图与 10000 节点压力图（`nodes.size` 正确）。
- 同一份 graph 能产出 `horizontal` / `vertical` 两种布局，父子方向符合模式。
- 父节点居于子树 / 子分组中线；兄弟顺序稳定。
- `edges` 不改变父子树主布局。
- 5 个及以下相邻兄弟不折叠，6 个及以上折叠为分组框；分组框尺寸受 48% / 42% 约束。
- 框内换位后真实 `graph` 顺序变化。
- `keepAnchorStable` 按公式补偿视口。
- 坐标转换 `worldToScreen` / `screenToWorld` 互逆，可被后续复用。
- `npm test` 全绿。

## 测试清单

- 现有 5 条：分组阈值、左右/上下方向、框内换位、锚点补偿、压力图。
- 补充：坐标转换互逆、`edges` 不参与主布局、父节点居中线、阈值边界（5 不折叠 / 6 折叠）。
