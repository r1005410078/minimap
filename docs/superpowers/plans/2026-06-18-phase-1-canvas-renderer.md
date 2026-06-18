# Phase 1 Canvas 渲染器 Plan

> 实现依据：[spec](../specs/2026-06-18-phase-1-canvas-renderer.md)。
> 范围：`src/minimap/renderer.js` + 测试，不碰真实 `<canvas>` / DOM / Vue。

## 进度

- [x] 纯函数：`worldRectToScreen` / `collectVisible` / `resolveEdges`
- [x] 默认绘制 + `renderScene` 入口 + 统计
- [x] mock ctx 测试 + 全套测试收口

切片完成：commit `1caccd8`，`npm test` 22 passed、`npm run build` 通过。

## 文件落点

- `src/minimap/renderer.js`：纯函数 + 默认绘制 + `renderScene`。
- `src/minimap/theme.js`：内置深色默认主题（颜色/字号/网格/内边距）。新建，供渲染器与后续切片复用。
- `test/minimap-renderer.test.js`：新增——纯函数 + mock ctx 集成测试。
- `test/helpers/mock-ctx.js`：新增——记录调用的假 Canvas 2D ctx。

## mock ctx 设计

- 代理常用 2D 方法（`fillRect`、`strokeRect`、`beginPath`、`moveTo`、`lineTo`、`stroke`、`fill`、`fillText`、`save`、`restore`、`clearRect` 等），把 `{ method, args }` 推进 `calls` 数组。
- 属性（`fillStyle`、`strokeStyle`、`font`、`lineWidth` 等）用普通字段承接，不报错。
- 暴露 `calls` 供断言顺序/数量；提供 `methodsOf(name)` 之类小助手便于筛选。

## 实现顺序（TDD）

### 步骤 1：纯函数

- `worldRectToScreen(rect, viewport)`：`{ x*scale+vp.x, y*scale+vp.y, width*scale, height*scale }`，与 `coords.worldToScreen` 一致。
- `collectVisible(layout, viewport, width, height)`：遍历 `layout.visibleItems`，算屏幕矩形，与 `[0,0,width,height]` 做矩形相交；返回 `{ items, culled }`。
- `resolveEdges(graph, layout)`：
  - 父子树连线：遍历 `layout.visibleItems` 里的 node，对其每个布局子项（普通子节点 box 或代表子节点的分组框）连中心点。
  - 业务边：遍历 `graph.edges`，端点 id 在 `layout.nodes` 用其 box 中心；被折叠（不在 `layout.nodes`）则查 `graph.nodes.get(id).parentId` 对应的 group box 中心；两端都解析不到则跳过。
  - 返回 `[{ id, kind, from:{x,y}, to:{x,y} }]`（世界坐标点，绘制时再过视口）。
- 验证点：纯函数三组测试通过。

### 步骤 2：默认绘制 + 入口

- `theme.js` 默认值：背景色、网格色/格距、节点填充/描边/文字、分组框填充/描边/标题、连线色/线宽。
- 默认绘制函数：`drawGrid`、`drawEdge`、`drawGroup`（边框 + 标题 + `children.length` 数量，不画内部子节点）、`drawNode`（矩形 + label）。各自只发 ctx 调用。
- `renderScene(ctx, scene)`：
  1. `const t0 = now()`；清屏 + 画网格。
  2. `resolveEdges` → 过视口 → 画连线（用 `renderers.edge` 或默认）。
  3. `collectVisible` → 分组框项画 `renderers.group` 或默认；节点项画 `renderers.node` 或默认。
  4. 组装每项 `state`（由 `scene.state?.selectedIds` 推导，缺省全 false）与屏幕 `rect` 传给绘制函数。
  5. 返回 `stats = { total, drawn, culled, durationMs: now()-t0 }`。
- `now()`：`(globalThis.performance ?? Date).now()`。
- 验证点：mock ctx 能录到网格/连线/分组框/节点调用。

### 步骤 3：测试收口

- 绘制顺序：网格 → 连线 → 分组框 → 节点（按 `calls` 中首次出现次序断言）。
- 自定义 `nodeRenderer`：被每个实绘节点调用一次，且默认节点绘制不再发出。
- 裁剪：构造只露一小块的视口，断言 `stats.drawn < stats.total` 且屏幕外项无绘制调用。
- 压力图：`createStressGraph(10000)` → `renderScene` 后 `stats.drawn` 远小于 `graph.nodes.size`。
- 折叠端点路由：`resolveEdges` 中 `cluster-8 → cluster-25` 的边，from 等于 heap-1 分组框中心。
- `npm test` 全绿，`npm run build` 通过。

## 完成定义

- 渲染器纯函数 + `renderScene` 实现，全部新测试通过，既有测试不回归。
- 自定义绘制可替换默认；视口裁剪生效；压力图实绘数远小于总数。
- `npm test` 与 `npm run build` 均通过；未引入新依赖；未碰真实 canvas / Vue。

## 风险与取舍

- 默认网格按视口范围铺满即可，不追求与世界坐标精确对齐的视觉；精细网格留到壳切片真实画布上调。
- `resolveEdges` 返回世界坐标点，由 `renderScene` 统一过视口，避免纯函数耦合屏幕尺寸。
- mock ctx 只覆盖默认绘制实际用到的方法；后续默认绘制新增方法时同步补 mock。
