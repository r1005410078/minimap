# 第一阶段实现计划：核心可用能力

> 本文是设计文档「第一阶段：核心可用能力」的**详细实现计划**，按 TDD（红 → 绿 → 重构）拆成可独立验收的小步。
>
> - 上游设计：[../specs/2026-06-18-minimap-design.md](../specs/2026-06-18-minimap-design.md)
> - 功能任务拆分：[./2026-06-18-minimap.md](./2026-06-18-minimap.md)
> - 通用约定：[../../project-conventions.md](../../project-conventions.md)
>
> 实现前必须经用户批准。实现过程中如发现设计缺口，先更新设计或询问用户，再继续编码。

## 范围

第一阶段交付一个**可以打开、能看到示例图、能切换左右/上下布局、能从资源树拖入节点**的最小可用 minimap。

纳入第一阶段：

- 图数据模型 + 示例数据 + 10000 节点压力数据（任务 1）。
- 布局引擎纯逻辑：分层树布局、左右/上下方向、坐标转换、内容边界、视口锚点补偿（任务 2）。
- 分组**探测**与**分组框尺寸计算**：连续兄弟超过阈值折叠为分组项（任务 2 的子项，现有测试已钉死）。
- Canvas 渲染器：网格、节点、连线、分组框、分组框内可见子节点、自定义绘制、视口裁剪、DPR、性能计数（任务 4）。
- 最小 Vue 壳：挂载组件、左侧资源树、拖入新增节点、布局方向切换、切换动画、重新布局时的视口锚点稳定（取自任务 4.5 / 7 / 10 的第一阶段必需子集）。

**不**纳入第一阶段（留给后续阶段）：

- 分组框的**交互**：内部滚动、虚拟绘制随滚动变化、框内拖拽换位、展开/折叠（第二阶段）。
- 平移/缩放/框选/多选/overview（第三阶段）。
- 搜索定位（第四阶段）。
- 撤销/重做、删除、复制、只读完整链路、导入导出 UI、错误/空/加载状态完整链路（第五阶段）。

> 说明：第一阶段会**绘制**分组框及其当前可见子节点（静态窗口），但不实现分组框的交互；节点拖入用原生 HTML 拖拽实现，画布平移/缩放等指针交互留到第三阶段。

## 约定

- 测试运行器：Node 内置 `node --test`，只覆盖纯逻辑（graph、layout、坐标、锚点、分组、导入导出）。
- 不新增任何第三方运行时或开发依赖。Canvas / Vue 行为用**手动浏览器验收清单**覆盖（Playwright 需用户批准，第一阶段不引入）。
- 每个 Phase 结束前运行 `npm test`；涉及构建产物的 Phase 结束前运行 `npm run build`。
- 纯逻辑（graph / layout）不依赖 Vue 或 DOM，可脱离浏览器测试。

---

## Phase 1：图数据模型（任务 1）

**目标：** 建立 `src/minimap/graph.js`，支撑节点/边/版本字段、示例图、压力图、增删改、换位、导入导出。

**先写测试（红）**——`test/minimap-graph.test.js`：

- `createDemoGraph()` 生成示例图：`nodes` 为 `Map`，含 `energy-root`、`heap-1`（24 个 `cluster-*` 子节点）、`cluster-25`（10 个 `cell-*` 子节点），且有至少一条业务 `edge`。
- `createStressGraph(10000)`：`nodes.size === 10002`，`stress-heap` 有 10000 个子节点。
- `reorderGroupChild(graph, 'heap-1', 'cluster-8', 1)` 后 `heap.children[1] === 'cluster-8'`，且子节点无重复。
- `addNode` / `removeNode`（删子树并清理触边）/ `duplicateNode`（子树复制、id 不冲突）。
- `exportGraph` → `importGraph` 往返一致；`version` 字段保留；非法 graph（缺 nodes/rootIds、父引用缺失）抛错。

**实现（绿）：** `createGraph / createNode / addNode / removeNode / duplicateNode / reorderGroupChild / exportGraph / importGraph / createDemoGraph / createStressGraph`。

**验收：** 上述测试通过；能生成示例图与 10000 节点图；换位改变真实数据顺序；能表达父子之外的业务连线。

---

## Phase 2：布局引擎纯逻辑（任务 2 + 分组探测/尺寸）

**目标：** 建立 `src/minimap/layout.js`，实现稳定分层树布局、双方向、坐标转换、内容边界、锚点补偿，以及布局前的分组探测与分组框尺寸。

**先写测试（红）**——扩展现有 [test/minimap-layout.test.js](../../../test/minimap-layout.test.js)（其断言即本 Phase 的绿色目标），并补充：

- `GROUP_THRESHOLD === 5`；连续兄弟 `> 5` 才折叠；`heap-1` 组 24 个、`cluster-25` 组 10 个。
- 分组框尺寸 `width ≤ viewportWidth*0.48`、`height ≤ viewportHeight*0.42`，内容超高时 `overflowY === true`。
- 左右布局：子节点主轴坐标大于父节点（`heap-1.x > energy-root.x`）；上下布局：`heap-1.y > energy-root.y`。
- 兄弟顺序在布局结果中稳定；父节点位于子树/子分组的中线。
- `edges` 不改变父子主布局（加 / 去掉 edges 后节点坐标不变）。
- `keepAnchorStable(viewport, before, after)`：`newViewport = viewport - (after - before) * scale`。
- `worldToScreen` / `screenToWorld` 往返一致（按 `screenX = worldX*scale + viewport.x`）。
- `contentBounds`：覆盖全部已定位元素。
- 压力图：`groups[0].children.length === 10000`，`visibleItems.length < nodes.size`（分组子节点虚拟化）。

**实现（绿）：**

- `detectGroups(graph, opts)`：全树遍历，对子节点数 `> groupThreshold` 的父节点生成分组项（含 `parentId`、`children`、`width/height/overflowY`），覆盖嵌套分组（如 `cluster-25`）。
- `computeLayout(graph, { direction, viewportWidth, viewportHeight, theme?, options? })`：
  1. 探测分组；被折叠的子节点在主树中由单个分组框占位。
  2. 自底向上算交叉轴占用尺寸；自顶向下分配 (main, cross)。
  3. 按 `horizontal/vertical` 映射为 `x/y`；父节点居中于子树中线。
  4. 产出 `nodes`(Map)、`groups`(数组)、`edges`(连线几何)、`visibleItems`(已定位节点 + 分组框 + 分组当前可见窗口子节点)、`contentBounds`、查找映射。
- 坐标工具：`worldToScreen / screenToWorld / keepAnchorStable`。

**验收：** `npm test` 全绿；同一 graph 可生成左右/上下两种布局；坐标转换可复用于拖入；锚点补偿可算。

---

## Phase 3：Canvas 渲染器（任务 4）

**目标：** `src/minimap/renderer.js`（纯绘制，不持有 Vue 状态），把布局结果画到 2D 上下文。

**纯逻辑测试（红）**——`test/minimap-renderer.test.js`（只测可抽离的纯函数，不测真实绘制）：

- 视口裁剪：给定视口矩形，`cullVisible(layout, viewport, size)` 只返回相交的项；10000 节点下返回数量远小于总数。
- DPR：`resolveCanvasSize(cssW, cssH, dpr)` 返回正确的像素尺寸与 transform 参数。
- 默认绘制参数装配：`buildRenderParams(item, layout, theme, viewport, state)` 产出 `{ node, rect, state, theme, viewport }` 且不含组件私有字段。

**实现（绿）：**

- `createRenderer(ctx, { theme })`，`render(layout, viewport, { nodeRenderer, groupRenderer, edgeRenderer, state })`。
- 默认深色 `drawNode / drawGroup / drawEdge / drawGrid`；自定义绘制函数优先。
- 视口裁剪后只画可见节点、连线、分组框及分组框内可见子节点。
- 收集 `{ totalNodes, visibleCount, frameMs }` 性能数据。

**验收（手动浏览器清单，记录到本文件末尾）：** 示例图正确显示；传入自定义 `nodeRenderer` 后节点视觉被替换；10000 节点压力图不创建 10000 个 DOM 节点；容器 resize 后 Canvas 尺寸与内容同步；高清屏不模糊。

---

## Phase 4：最小 Vue 壳 + 资源树拖入 + 布局切换（任务 4.5 / 7 / 10 子集）

**目标：** `src/minimap/Minimap.vue` + 应用壳 `src/App.vue`，把上面逻辑串成可试用页面。

**纯逻辑测试（红）**（能抽离的部分）：

- `screenDropToWorld(screenPoint, viewport)` + `addNode` 组合：拖入后 graph 节点数 +1，新节点 `parentId` 正确。
- 布局切换：从旧布局到新布局，结合 `keepAnchorStable`，选中/拖拽节点的屏幕位置保持稳定（用坐标断言，非像素）。

**实现（绿）：**

- `Minimap.vue` props 第一阶段子集：`graph`、`resources`、`layoutDirection`、`nodeRenderer/groupRenderer/edgeRenderer`、`theme`、`options`；event：`change`、`node-drop`、`layout-change`、`performance`。
- 左侧资源树用原生 HTML 拖拽；drop 到 Canvas 时用逆变换转世界坐标并新增节点（触发 `beforeNodeDrop` 预留钩子）。
- 布局方向切换按钮；切换时用 `requestAnimationFrame` 从旧坐标插值到新坐标，并用选中/拖拽节点作视口锚点补偿。
- `ResizeObserver` + DPR 同步；`destroy()` 取消 rAF、移除监听、断开 observer。
- 压力测试开关（一键切到 10000 节点）+ 简单性能状态展示。

**验收（手动浏览器清单）：** 首屏即可操作的 minimap（非营销落地页）；左右/上下切换后画布仍有内容且关注点不跳走；资源树拖入后节点数变化；10000 节点模式页面仍响应；离开页面后无残留监听/动画。

---

## 阶段完成判定

1. `npm test` 全绿（Phase 1–4 的纯逻辑测试）。
2. `npm run build` 成功。
3. 手动浏览器验收清单逐项通过（见下）。

## 手动浏览器验收清单（实现时勾选）

- [ ] 打开页面即看到示例能源图，Canvas 非空。
- [ ] 切换左右 / 上下布局后，画布仍有内容，关注节点不跳走。
- [ ] 从左侧资源树拖入一个节点，图中节点数 +1。
- [ ] 传入自定义 `nodeRenderer`，节点视觉被替换。
- [ ] 切到 10000 节点压力模式，页面仍可响应、不创建上万 DOM 节点。
- [ ] 调整窗口大小，Canvas 尺寸与内容同步，高清屏不模糊。
- [ ] 切换路由 / 卸载组件后，无残留全局监听与动画循环。
