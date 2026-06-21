# 性能优化切片 3：空间索引接入 hitTest / 框选查询设计

## 背景

[性能优化切片 1](2026-06-21-large-graph-performance.md)（[plan](../plans/2026-06-21-large-graph-performance.md)）已经完成大图交互合帧与缩放降级渲染，并在设计里明确把空间索引和静态层缓存留给后续独立切片：

> 框选和命中检测为后续大图空间索引预留清晰边界。

当前 `hitTest(layout, point)`（[interaction.js:35](../../../src/minimap/interaction/interaction.js#L35)）对 `layout.visibleItems` 做线性扫描，命中后再进入分组内部细分。它不只在 `pointerdown` 调用一次：`drag-controller.js` 里 `resolveDropTarget` 在节点拖拽的每个 `pointermove` 都会调用一次 `hitTest`（用于判断插入目标），所以大图缩小、节点数接近设计上限（10000）时，这是一条逐帧执行的 O(n) 路径。

`idsInSelectionRect(layout, screenRect, viewport)`（[selection.js:102](../../../src/minimap/interaction/selection.js#L102)）在框选 `pointerup` 时调用一次，但内部 `visibleSelectableItems` 会无条件展开 `layout.groups` 里**每一个分组**当前可见的子节点，再逐个转换到屏幕坐标做相交测试——即使框选矩形只覆盖屏幕一小块区域，也要扫一遍全图的分组子项。

## 目标

- `hitTest` 命中检测和框选范围查询不再随总节点数线性扫描；只检查跟查询点/矩形相邻的候选项。
- 不改变 `hitTest`/`idsInSelectionRect` 的对外签名和返回值语义，调用方（`drag-controller.js`、`context-menu-controller.js`、现有测试）不用改代码。
- 索引的失效边界清晰：真正的布局结构变化（resize、分组展开/折叠、graph mutation）会让索引自然失效；分组内部的滚动、拖拽让位动画等高频但局部的变化不应该触发重建。

## 范围内

- 新建 `src/minimap/render/spatial-index.js` + `test/minimap-spatial-index.test.js`。
- 修改 `src/minimap/interaction/interaction.js`：`hitTest` 内部改用空间索引查询。
- 修改 `src/minimap/interaction/selection.js`：`idsInSelectionRect`/`visibleSelectableItems` 改成先查询世界坐标空间索引、再展开命中分组的子项。
- 修改 `src/minimap/coords/coords.js`：新增 `screenRectToWorld(rect, viewport)`，是已有 `screenToWorld(point, viewport)` 的矩形版本，供 `idsInSelectionRect` 把屏幕坐标的框选矩形一次性转换成世界坐标。
- 修改 `test/minimap-interaction.test.js`、`test/minimap-selection.test.js`：补充多分组/跨网格单元的命中和框选回归用例。
- 更新 `ROADMAP.md` 性能优化切片记录。

## 范围外

- 不接入 `renderer.js` 做视口裁剪（设计文档里提到的 `queryViewport`）。命中检测和框选是这一切片的全部目标；视口裁剪跟切片 4 静态层缓存的失效规则耦合更紧，留给那个切片一并设计。
- 不改变分组内部命中（`hitTestGroupZone`/`groupGridIndexAt`）的实现——分组内部子项数量受可见窗口限制，本身就是有界的，不是本切片要解决的瓶颈。
- 不改变节点拖拽过程中 `renderCurrent()` 仍然逐帧立即调用这件事（那是切片 1 设计里明确留给"动态层/缓存切片"的部分，不属于空间索引的范畴）。
- 不引入第三方空间索引依赖（R-tree 等库）；用固定大小网格 bucket，跟设计文档"第一版可以用固定大小 bucket"的建议一致。

## 模块设计

### `spatial-index.js`

```js
export function buildSpatialIndex(layout, { cellWidth = 256, cellHeight = 128 } = {})
export function queryPoint(index, point)
export function queryRect(index, rect)
export function getSpatialIndex(layout)
```

- `buildSpatialIndex(layout, options)`：纯函数。遍历 `layout.visibleItems`（节点矩形 + 分组外框矩形，两者都是世界坐标，互不重叠），按矩形覆盖到的网格单元把每个 item 的引用放进对应 bucket（一个 item 可能跨多个 bucket，按 `Map<cellKey, item[]>` 存储）。`cellWidth`/`cellHeight` 默认值参考 `NODE`（120×40）和 `LEVEL_GAP`/`SIBLING_GAP` 量级取整数，留可选参数方便测试用更小的网格验证分桶逻辑。
- `queryPoint(index, point)`：算出 point 所在的单元格，只检查该格 bucket 里的 item，逐个 `containsPoint` 精确判断，命中即返回（树布局保证同一坐标点最多命中一个顶层 item）。格内为空或都不命中返回 `null`。
- `queryRect(index, rect)`：算出 rect 覆盖的所有单元格，收集这些 bucket 里所有 item 的去重并集（一个 item 可能在多个 bucket 出现），逐个做矩形相交精确判断，返回命中数组。
- `getSpatialIndex(layout)`：用 `WeakMap<layout, index>` 记忆化 `buildSpatialIndex(layout)`，是 `hitTest`/`idsInSelectionRect` 实际调用的入口。`buildSpatialIndex`/`queryPoint`/`queryRect` 保持纯函数、不做记忆化，方便单独单测。

失效边界：`layout` 对象本身的身份就是缓存 key。`computeLayout()`（[layout.js:152](../../../src/minimap/graph/layout.js#L152)）每次都会生成新的 `visibleItems` 数组，覆盖 resize、分组展开/折叠（`setGroupExpanded` 走 `updateLayout()`）、graph mutation 等所有结构性变化。分组 `scrollTop` 拖拽和拖拽让位动画只在已有的 `group` 对象上原地改属性（`group.scrollTop = ...`），不替换 `layout`/`visibleItems`，也不改变分组外框本身的 `x/y/width/height`——这正是索引只收录顶层 item（不收录分组内部子项坐标）而不是收录全部子节点坐标的原因：顶层 item 的世界坐标只在 `computeLayout()` 里写一次，分组内部的滚动/让位动画完全不会让索引过期。

### `interaction.js` 改动

```diff
 export function hitTest(layout, point) {
-  for (const item of layout.visibleItems) {
-    if (!containsPoint(item, point)) continue
-    if (item.type === 'node') return { type: 'node', id: item.id }
-    const group = layout.groups.find((g) => g.id === item.id)
-    return hitTestGroupZone(group, point)
-  }
-  return null
+  const item = queryPoint(getSpatialIndex(layout), point)
+  if (!item) return null
+  if (item.type === 'node') return { type: 'node', id: item.id }
+  const group = layout.groups.find((g) => g.id === item.id)
+  return hitTestGroupZone(group, point)
 }
```

签名、返回值、调用方完全不变。

### `selection.js` 改动

`visibleSelectableItems` 实现本身不变（保留给 `itemIds()`/`buildSelectionRelations` 等其它需要"全部可选项"列表的调用方）。只改 `idsInSelectionRect`：

```diff
 export function idsInSelectionRect(layout, screenRect, viewport) {
-  const ids = []
-  for (const item of visibleSelectableItems(layout)) {
-    if (intersectsRect(screenRect, worldRectToScreen(item, viewport))) ids.push(item.id)
-  }
-  return ids
+  const worldRect = screenRectToWorld(screenRect, viewport)
+  const ids = []
+  for (const item of queryRect(getSpatialIndex(layout), worldRect)) {
+    if (item.type === 'node') {
+      ids.push(item.id)
+      continue
+    }
+    const group = layout.groups.find((g) => g.id === item.id)
+    for (const child of visibleGroupChildren(group)) {
+      if (intersectsRect(worldRect, child.rect)) ids.push(child.id)
+    }
+  }
+  return ids
 }
```

注意坐标空间从"逐项转屏幕坐标再跟屏幕矩形比较"变成"框选矩形转一次世界坐标，后续都在世界坐标比较"。两者数学上等价（viewport 变换只有平移和缩放，没有旋转），但只做一次逆变换而不是对每个 item 做一次正变换，是这次优化的另一部分收益。

### `coords.js` 改动

新增：

```js
export function screenRectToWorld(rect, viewport) {
  const a = screenToWorld({ x: rect.x, y: rect.y }, viewport)
  const b = screenToWorld({ x: rect.x + rect.width, y: rect.y + rect.height }, viewport)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}
```

跟现有 `worldRectToScreen`（[renderer.js:14](../../../src/minimap/render/renderer.js#L14)）风格一致，只是反方向、且放在 `coords.js`（点级 `screenToWorld` 已经在这里）。

## 边界情况

- **顶层 item 不重叠**：树布局保证同一深度的节点/分组矩形互不重叠（`hitTest` 现有实现的注释已经说明这一点），所以 `queryPoint` 在同一个格子里检查到的多个候选项最多有一个真正包含该点，顺序无关。
- **分组 overscan 行**：`visibleGroupChildren`（[layout.js:71](../../../src/minimap/graph/layout.js#L71)）为了平滑滚动会多算一行 overscan，理论上这一行的子项矩形可能略微超出分组外框。新的 `idsInSelectionRect` 先按分组外框是否命中框选矩形过滤，再展开子项——如果某个分组外框完全没进入框选矩形，它的 overscan 行子项也不会被检查。这跟渲染时的实际效果一致：`renderer.js` 画分组内部子项时用 `ctx.clip()` 裁剪到分组外框范围（[renderer.js:393](../../../src/minimap/render/renderer.js#L393)、[481](../../../src/minimap/render/renderer.js#L481)），overscan 行本来就不会画出分组外框之外的部分。也就是说这处改动让框选命中范围跟可见渲染范围更一致，不是引入新的不一致。

## 测试策略

- `test/minimap-spatial-index.test.js`（新建）：构造跨多个网格单元的 `visibleItems`（节点 + 分组混合，坐标故意分散到网格边界两侧），验证：
  - `queryPoint` 命中 / 不命中各种位置（格内、格外、网格边界）。
  - `queryRect` 对完全不相交、部分相交、完全包含三种矩形返回正确子集，且不漏检跨格的大矩形 item。
  - `getSpatialIndex` 对同一个 `layout` 对象重复调用返回同一个索引引用（验证记忆化生效），对不同 `layout` 对象返回不同索引。
- `test/minimap-interaction.test.js`：补充一个节点/分组分散在相距较远坐标（确保落在不同网格单元）的 demo layout，验证 `hitTest` 结果跟改造前一致；保留现有用例作为回归证据。
- `test/minimap-selection.test.js`：补充框选矩形只覆盖部分分组、不覆盖任何分组外框、覆盖单个节点但不覆盖任何分组三种场景，验证 `idsInSelectionRect` 返回结果跟按"全量展开再裁剪"算出来的预期值一致；保留现有用例。
- 不写基于计时的性能基准测试（跟项目测试约定一致：避免脆弱断言，优先状态/数量断言）；性能收益通过"查询只检查命中网格"这一实现事实和单测里的覆盖范围来保证正确性，不在测试里断言耗时。

## 验收标准

- `hitTest`、`idsInSelectionRect` 对外行为不变（现有调用方和测试不用改),新增空间索引单测全部通过。
- `npm test` 和 `npm run build` 全部通过。
- 手动验收：大图（建议用现有 demo/stress 数据或临时生成的高节点数 graph）缩小后拖拽节点、框选操作仍然正常，没有可感知的额外卡顿或行为差异。

## 分阶段落地（延续自切片 1 设计文档）

1. ~~切片 1：合帧渲染调度~~（已完成，[spec](2026-06-21-large-graph-performance.md)）
2. ~~切片 2：缩放降级渲染~~（已完成，并入切片 1 同一份计划一起落地）
3. 切片 3（本文档）：空间索引接入 hitTest / 框选矩形查询。
4. 切片 4：静态层缓存（留给后续文档；视口裁剪 `queryViewport` 一并在那个切片评估是否需要）。
