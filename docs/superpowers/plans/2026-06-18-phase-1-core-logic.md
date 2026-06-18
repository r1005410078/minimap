# Phase 1 核心逻辑层 Plan

> 实现依据：[spec](../specs/2026-06-18-phase-1-core-logic.md)。
> 范围：纯逻辑层 `graph.js` / `layout.js` / `coords.js` + 测试，不碰 Canvas / Vue。

## 文件落点

- `src/minimap/graph.js`：数据模型、示例/压力数据、`reorderGroupChild`。
- `src/minimap/layout.js`：`GROUP_THRESHOLD`、`computeLayout`、`keepAnchorStable`。
- `src/minimap/coords.js`：`worldToScreen` / `screenToWorld`。
- `test/minimap-layout.test.js`：现有 5 条（作为契约，不改）。
- `test/minimap-graph.test.js`：新增——示例/压力图结构、`reorderGroupChild` 边界、`edges` 字段。
- `test/minimap-coords.test.js`：新增——坐标转换互逆。
- 在布局测试中补：`edges` 不参与主布局、父节点居中线、阈值边界（5 不折叠 / 6 折叠）。

## 实现顺序（TDD：先让现有测试可运行，再逐步变绿）

### 步骤 1：`graph.js` 数据模型与示例数据

- 定义 `node` / `edge` / `graph` 结构，`nodes` 用 `Map`。
- `createDemoGraph()`：`energy-root` 挂 3 个直接子节点（≤5 不折叠），其中 `heap-1` 挂 `cluster-1..cluster-24`（含 `cluster-8`）、`cluster-25` 挂 10 个叶子；带少量 `edges` 表达业务关系线。
- `createStressGraph(n)`：根 + 1 父 + `n` 子，`nodes.size === n + 2`。
- `reorderGroupChild(graph, parentId, childId, newIndex)`：从 `children` 移除再按 `newIndex` 插入，保持唯一。
- 验证点：`createStressGraph` 与 `reorderGroupChild` 相关断言通过。

### 步骤 2：`layout.js` 分组折叠

- `GROUP_THRESHOLD = 5`。
- 遍历每个父节点的 `children`，找出**连续相邻**且 `> 5` 的 run，折叠成 `group`。
- `group` 尺寸：内部网格排布推导内容高度，`width` 截到 `VW*0.48`、`height` 截到 `VH*0.42`，内容超高则 `overflowY = true`。
- 验证点：分组阈值测试（24 / 10、48% / 42% / overflowY）通过。

### 步骤 3：`layout.js` 分层树定位 + 方向映射

- 自底向上算每个节点/分组/子树的占用尺寸（主轴 = 深度方向，交叉轴 = 兄弟方向）。
- 自顶向下分配世界坐标，父节点取子树/子分组中线。
- `direction` 映射主轴/交叉轴到 `x/y`：`horizontal` 深度→x，`vertical` 深度→y。
- `edges` 只读取、不参与定位。
- 产出 `nodes: Map`、`groups`、`bounds`。
- 验证点：左右/上下方向测试通过；补充的「父节点居中线」「edges 不改变布局」测试通过。

### 步骤 4：`layout.js` 结构性虚拟化 + 锚点补偿

- `visibleItems`：顶层渲染项（未被折叠的节点 + 分组框），被折叠的分组子节点不进入。
- `keepAnchorStable(viewport, before, after)` 按 spec 公式实现。
- 验证点：压力图 `visibleItems.length ≪ nodes.size`、锚点补偿测试通过。

### 步骤 5：`coords.js` 坐标转换

- `worldToScreen` / `screenToWorld`，互为逆变换。
- 验证点：新增坐标测试通过。

### 步骤 6：补充测试 + 收口

- 写齐补充测试（坐标互逆、edges、中线、阈值边界）。
- `npm test` 全绿。
- `npm run build` 通过（确认逻辑层不破坏构建）。

## 完成定义

- `test/minimap-layout.test.js` 现有 5 条全部通过，未被改写。
- 新增测试覆盖坐标转换、edges、中线、阈值边界。
- `npm test` 与 `npm run build` 均通过。
- 未引入任何新依赖；未触碰 Canvas / Vue 代码。

## 风险与取舍

- 分组内部网格的列数/项尺寸取 `theme` 默认值；只要满足 48%/42%/overflowY 约束即可，精确视觉留到渲染切片。
- `visibleItems` 此处是结构性虚拟化，**不做视口裁剪**（视口裁剪在后续 Canvas 渲染器切片）。
