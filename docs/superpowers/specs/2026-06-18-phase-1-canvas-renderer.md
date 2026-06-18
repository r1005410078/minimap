# Phase 1 Canvas 渲染器 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第一阶段；是逻辑层切片之后的第二个切片。
> 依赖 [逻辑层 spec](2026-06-18-phase-1-core-logic.md) 的 `computeLayout` 产物与 `coords`。

## 头脑风暴决策记录

- **只做渲染逻辑**：渲染器接收一个已备好的 Canvas 2D `ctx` + 场景参数，不碰 DOM。真实 `<canvas>` 元素、DPR、`ResizeObserver`、生命周期留给下一个 Vue 组件壳切片。
- **mock ctx 录制调用测试**：用记录调用的假 `ctx` 做单测，断言裁剪结果、绘制项数量、绘制顺序、自定义渲染函数被调用；不做像素断言。裁剪/边路由/坐标映射抽成纯函数单测。
- **只画分组框**：Phase 1 画分组框本身（边框 + 标题 + 子节点数量），不画分组内部子节点。分组内部虚拟绘制与滚动是 Phase 2。

## 范围

### 目标（本切片交付）

- `src/minimap/renderer.js`：场景渲染入口 + 可测纯函数（视口裁剪、连线端点解析、世界→屏幕矩形映射）。
- 默认深色绘制：网格背景、普通节点、连线、分组框。
- 自定义绘制钩子：`nodeRenderer` / `groupRenderer` / `edgeRenderer`。
- 渲染统计：候选数 / 实绘数 / 裁剪数 / 耗时。
- 测试：用 mock ctx + 纯函数单测覆盖。

### 非目标（后续切片 / 阶段）

- 真实 `<canvas>` 挂载、DPR、`ResizeObserver`、容器 resize（下一个 Vue 组件壳切片）。
- 资源树拖入、平移缩放等交互（壳切片 / Phase 3）。
- 分组内部子节点绘制、滚动、虚拟绘制（Phase 2）。
- 选中/悬停/拖拽态的真实联动（Phase 3）；本切片只保留 `state` 参数通道，默认全未选中。

## 模块 API 契约

### 入口

`renderScene(ctx, scene) -> stats`

- `ctx`：Canvas 2D 上下文（真实或 mock）。
- `scene`：
  - `layout`：`computeLayout` 的产物（`nodes` Map、`groups`、`visibleItems`、`bounds`）。
  - `graph`：取 `edges` 与节点 `label`。
  - `viewport`：`{ x, y, scale }`。
  - `width` / `height`：画布逻辑尺寸（CSS 像素）。
  - `theme?`：颜色/字号/网格/内边距等；缺省用内置深色默认。
  - `state?`：交互状态来源，缺省全未选中。`{ selectedIds?: Set<string> }`。
  - `renderers?`：`{ node?, group?, edge? }` 自定义绘制函数。
- 返回 `stats`：`{ total, drawn, culled, durationMs }`。

### 绘制顺序

网格背景 → 连线 → 分组框 → 普通节点（→ 选中态叠加，Phase 1 默认无）。

### 自定义绘制函数契约

`nodeRenderer(ctx, params)`，`params = { node, rect, state, theme, viewport }`：

- `rect`：屏幕坐标包围盒 `{ x, y, width, height }`。
- `state`：`{ selected, hovered, dragging, highlighted, readonly }`，Phase 1 默认全 `false`。
- 传入则替换默认绘制；只负责视觉输出，不改数据/视口/选中。
- `groupRenderer` 同构，`params.group` 为分组框；`edgeRenderer` 的 `params.edge` 含已解析端点 `{ from, to }`（屏幕坐标点）。

### 可测纯函数（导出）

- `worldRectToScreen(rect, viewport)` → 屏幕矩形。
- `collectVisible(layout, viewport, width, height)` → `{ items, culled }`：以 `layout.visibleItems` 为候选，剔除屏幕矩形与 `[0,0,width,height]` 不相交的项。
- `resolveEdges(graph, layout)` → 连线列表：父子树默认连线 + `graph.edges` 业务线；端点为节点包围盒中心，**端点落在被折叠子节点上时路由到其所在分组框**。

## 视口裁剪与性能

- 候选集是 `layout.visibleItems`（已做结构性虚拟化，折叠子节点不在内）。
- 渲染器按视口矩形再剔除屏幕外的项，只对相交项发绘制调用。
- 10000 节点压力图：候选集很小（折叠成分组），`stats.drawn` 远小于 `graph.nodes.size`，单帧不发万级绘制调用。

## 连线端点解析

- 默认父子连线：每个父节点连到它在布局中的子项（普通子节点或代表其子节点的分组框）。
- 业务连线来自 `graph.edges`：`source` / `target` 是节点 id。
  - id 在 `layout.nodes` 中 → 用其包围盒中心。
  - id 被折叠（不在 `layout.nodes`）→ 用其父节点对应分组框的中心。
  - 两端都解析不到 → 跳过该边。

## 验收标准

- 默认主题下能对示例图发出网格、连线、分组框、节点的绘制调用（mock ctx 录制可见）。
- 绘制顺序为 网格 → 连线 → 分组框 → 节点。
- 传入 `nodeRenderer` 后，节点不再走默认绘制，自定义函数对每个实绘节点被调用一次。
- 视口外的节点被裁剪：`stats.drawn < stats.total`，且仅相交项产生绘制调用。
- 10000 压力图 `stats.drawn` 远小于 `graph.nodes.size`。
- 端点落在折叠子节点（如 `cluster-8`）上的边，路由到其分组框中心。
- `worldRectToScreen` 与 `coords` 的变换一致。

## 测试清单

- `worldRectToScreen` 映射正确。
- `collectVisible`：视口内保留、视口外剔除、`culled` 计数正确。
- `resolveEdges`：父子连线生成、业务边折叠端点路由、缺失端点跳过。
- `renderScene`（mock ctx）：绘制顺序、默认绘制发出调用、自定义渲染函数被调用、`stats` 字段正确、压力图实绘数远小于总数。
