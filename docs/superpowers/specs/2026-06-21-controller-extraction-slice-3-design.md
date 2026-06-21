# Controller 抽取切片 3：drag-controller 设计

## 背景

切片 1（[设计](2026-06-21-controller-extraction-design.md)/[计划](../plans/2026-06-21-controller-extraction-slice-1.md)）把 canvas 挂载/resize、layout 状态、viewport+tween、渲染调度迁进了 `core-controller.js` + 根 `minimap-controller.js`；切片 2（[设计](2026-06-21-controller-extraction-slice-2-design.md)/[计划](../plans/2026-06-21-controller-extraction-slice-2.md)）把选中态、编辑操作、搜索、右键菜单迁进了 `selection-controller.js`/`edit-controller.js`/`search-controller.js`/`context-menu-controller.js`。`Minimap.vue` 现在剩下的本地状态机就只有拖拽：节点拖拽（同父换位/跨父移动）、滚动条拖拽、框选、空白平移、三个 rAF 循环（自动滚动/边缘平移/拖拽让位动画）、滚轮事件、资源拖放提交。这是总体设计文档里留到最后做的最复杂一块。

本文档详细设计 `drag-controller.js` 的边界、依赖契约，以及它跟已有 controller 之间最后几个"跨切片临时依赖"如何收尾。依赖注入约定沿用总体设计文档，不重复说明。

## 目标

新建 `src/minimap/drag-controller.js`，把拖拽状态机本体、三个 rAF 循环、滚轮事件、资源拖放提交从 `Minimap.vue` 迁出。完成后 `Minimap.vue` 的 `<script setup>` 不再包含任何指针事件处理代码，根 controller 的 canvas DOM 监听全部直接指向真实 controller 方法。`Minimap.vue` 对外行为、props、emits、`defineExpose` 方法名和参数形状不变。

## 范围内

- 新建 `src/minimap/drag-controller.js` + `test/minimap-drag-controller.test.js`。
- `interaction.js` 新增两个导出纯函数：`scrollbarMetrics(group)`、`hitScrollbarThumb(layout, point)`（从 `Minimap.vue` 原样迁出，纯几何计算，跟现有 `hitTest`/`groupGridIndexAt` 同属性质）。
- `edit-controller.js` 把内部私有的 `emitChangeIfApplied` 改成公开返回的方法，供 `drag-controller` 复用。
- `context-menu-controller.js` 新增 `isOpen()` 方法（返回 `state !== null`），供根 controller 的 keydown 分发判断。
- 根 `minimap-controller.js`：
  - 新增组装 `drag-controller`，调整组装顺序为 `selection → core → edit → contextMenu → drag → search`（`contextMenu` 挪到 `drag` 前面）。
  - 新增 4 个本地函数 `fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`（先 `drag.cancelPointerInteractions()` 再调 `core.xxx()`），永久取代 Vue 本地的同名包装函数,同时作为根 controller 自己对外返回的方法。
  - 新增本地函数 `handleKeyDown`，挂到 `keydown` 监听上，直接调用 `contextMenu`/`selection`/`edit` 的方法。
  - `mount()` 里 `pointerdown`/`pointermove`/`pointerup`/`pointerleave`/`pointercancel`/`lostpointercapture`/`wheel`/`dragover`/`drop`/`keydown` 全部从"转发 deps 里的 Vue 闭包"改成直接调用 `drag`（或 `handleKeyDown`）的方法，从 `POINTER_EVENT_BINDINGS` 表里去掉，改成跟 `contextmenu` 一样的硬编码单行 dispatch。
- `Minimap.vue` 删除全部拖拽相关本地状态、函数、`emitChange` 本地函数；`createInteractionController()` 的 deps 表大幅缩短（不再需要 `onPointerDown` 等回调注入，也不再需要 `cancelPointerInteractions`/`centerOnNode`/`fitToScreen`/`centerOnSelection` 这几个临时桥接）。

## 范围外

- `interaction.js`/`drag-transition.js` 里已有的纯函数本体（`hitTest`/`resolveDropTarget`/`groupAutoScrollSpeed`/`edgePanVelocity`/`buildVirtualOrder`/`currentShiftRects` 等）——本切片只是换调用方，不改这些纯函数的实现。
- 工具栏里还没接逻辑的按钮（返回/选择/框选/定位/缩小/放大/展开/列表/信息）——跟本切片无关，维持现状。

## 模块设计

### `drag-controller.js`

```js
createDragController({
  // 只读 getter，转发 props/computed
  getGraph,              // () => props.graph
  getLayoutDirection,    // () => props.layoutDirection
  getOptions,            // () => effectiveOptions.value
  getGroupStatesProp,    // () => props.groupStates（null 表示非受控，cancelScrollbarDrag 回滚要用）
  getBeforeNodeDrop, getBeforeGroupReorder, getBeforeNodeMove,  // () => props.beforeXxx

  // core
  getLayout, getViewport, applyViewport, getCssSize,
  screenPointFromClient, pointFromClient,
  renderCurrent, scheduleRender, flushScheduledRender, cancelScheduledRender,
  settleAnimation, scrollGroup, setGroupExpanded, zoomAt,
  getCanvasEl,           // () => canvasEl（根 controller mount() 时记录的 canvas 元素，对应原 canvasRef.value）

  // selection
  getSelectedIds, setSelected,

  // edit
  applyOperation, emitChangeIfApplied,

  // context-menu
  closeContextMenu,      // () => contextMenu.close()

  // 输出回调
  emitNodeDrop, emitGroupReorder, emitNodeMove,   // (payload) => emit('xxx', payload)
}) -> {
  onPointerDown(event), onPointerMove(event), onPointerUp(event),
  onPointerLeave(), onPointerCancel(), onLostPointerCapture(),
  onWheel(event),
  onDragOver(event), onDrop(event),
  cancelPointerInteractions(),
  getInteractionRenderState(),   // core 的跨 controller 契约，见下
}
```

内部状态（`dragState`/`scrollbarDragState`/`panState`/`marqueeState`/`hoveredScrollbarGroupId`）原样保留为闭包变量，函数体（`updateDragTarget`/`scheduleDragShift`/`ghostRectForPoint`/`shouldAutoScroll`/`withinGroupBody`/`edgePanActive`/`dragShiftActive`/`now` 等）原样搬入，只是访问 `props.graph`/`controller.xxx()` 的地方换成 `deps.getGraph()`/`deps.xxx()`。`now`（`() => (globalThis.performance ?? Date).now()`）是个纯内部时间戳辅助函数，搬进 `drag-controller.js` 后 `Minimap.vue` 里没有别的地方还在用它，整段一起删掉。

`getInteractionRenderState()` 就是原来 Vue 的 `interactionRenderState()` 函数本体，原样搬入。

`onWheel` 内部缩放分支改用 `deps.zoomAt(screenPoint, event.deltaY)`（验证过等价于原来手动 `zoomViewportAt(...) + applyViewport(...)`，因为 `viewportOptions()` 只读 `minScale`/`maxScale`/`zoomSensitivity` 三个字段，这几个字段不受 `effectiveOptions` 默认值合并影响，`deps.getOptions()` 和原来用的 `props.options` 在这三个字段上结果一致）。平移分支**不能**改用 `core.panBy`——`panBy` 是相对当前视口累加，原代码是相对 `panState.startViewport`（拖拽起点视口）算总位移，语义不同，必须保留手动 `deps.applyViewport(panViewportBy(panState.startViewport, delta, viewportOptions(deps.getOptions())), { render: false })`。

`handlePointerUp` 里 `reorder-group-child`/`move-node` 两个分支改用 `deps.applyOperation(operation, { before: deps.getBeforeGroupReorder() })` / `{ before: deps.getBeforeNodeMove() }`，成功后用 `deps.emitChangeIfApplied(result)` 代替原来的本地 `emitChange(changeResult)`。`handleDrop` 的 `drop-node` 操作同理，`before: deps.getBeforeNodeDrop()`。

### `edit-controller.js` 的改动

```diff
- function emitChangeIfApplied(result) { ... }
+ function emitChangeIfApplied(result) { ... }   // 实现不变

  return {
    undo, redo, canUndo, canRedo,
    deleteSelection, copySelection, paste, pasteInto,
    exportGraph, importGraph, applyOperation, onGraphReplaced,
+   emitChangeIfApplied,
  }
```

纯新增返回值，内部调用点（`deleteSelection`/`pasteInto`/`importGraph` 内部已经在用这个函数）不变。

### `context-menu-controller.js` 的改动

```diff
  return { open, close, runItem }
+ return { open, close, runItem, isOpen: () => state !== null }
```

纯新增，`state`/`close`/`open` 现有逻辑不变。

## 根 controller 的组装顺序与循环依赖

延续切片 1/2 已验证的手法：闭包只在真正被调用时才访问引用的变量,构造阶段（函数体没执行）不会触发 `const` 的 TDZ。

新顺序：`selection → core → edit → contextMenu → drag → search`。具体收尾点：

- `core` 的 `getInteractionRenderState` 改接 `() => drag.getInteractionRenderState()`（目前接的是 Vue 本地闭包）。
- `contextMenu` 的 `cancelPointerInteractions` 改接 `() => drag.cancelPointerInteractions()`（目前接的是 Vue 本地闭包）。
- 根 controller 顶部用 `function` 声明（整体提升，构造阶段文本顺序不受限）新增：
  ```js
  function fitToScreen() { drag.cancelPointerInteractions(); core.fitToScreen() }
  function centerOnNode(id) { drag.cancelPointerInteractions(); core.centerOnNode(id) }
  function centerOnSelection() { drag.cancelPointerInteractions(); core.centerOnSelection() }
  function zoomTo(scale, center) { drag.cancelPointerInteractions(); core.zoomTo(scale, center) }
  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      if (contextMenu.isOpen()) { event.preventDefault(); contextMenu.close(); return }
      if (selection.getSelectedIds().length === 0) return
      event.preventDefault(); selection.setSelected([]); return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); edit.deleteSelection(); return }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); edit.copySelection(); return }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); edit.paste() }
  }
  ```
  这 4 个相机函数喂给 `contextMenu`/`search` 当 `fitToScreen`/`centerOnSelection`/`centerOnNode` 的 deps（直接引用即可，`contextMenu` 在 `drag` 之前构造，但函数体只在调用时才访问 `drag`，安全），也是根 controller 自己对外返回的同名方法——切片 2 文档里说的"两个不同命名空间"的临时状态到这里彻底收尾，`Minimap.vue` 里那几个"先 cancel 再转发"的本地包装函数全部删除。
- `drag` 的 deps 直接拿 `core.*`/`selection.*`/`edit.applyOperation`/`edit.emitChangeIfApplied`/`contextMenu.close`（这几个都已构造好，直接引用，不需要包闭包）。

## Vue 集成（`Minimap.vue` 之后的样子）

删除：`dragState`/`scrollbarDragState`/`panState`/`marqueeState`/`hoveredScrollbarGroupId`/`contextMenuState` 之外的拖拽相关 ref 和变量；`DRAG_SHIFT_DURATION_MS`/`SCROLLBAR_WIDTH` 常量；`now`/`clearDragShiftAnimation`/`shouldAutoScroll`/`interactionRenderState`/`dragShiftActive`/`cancelDragShiftLoop`/`ensureDragShiftLoop`/`withinGroupBody`/`updateDragTarget`/`scheduleDragShift`/`isAdditiveSelection`/`ghostRectForPoint`/`scrollbarMetrics`/`hitScrollbarThumb`/`cancelAutoScrollLoop`/`startAutoScrollLoop`/`ensureAutoScrollLoop`/`edgePanActive`/`cancelEdgePanLoop`/`ensureEdgePanLoop`/`cancelDrag`/`cancelScrollbarDrag`/`cancelPan`/`cancelMarquee`/`cancelPointerInteractions`/`updateScrollbarHover`/`clearScrollbarHover`/`handlePointerDown`/`handlePointerMove`/`handlePointerUp`/`handleWheel`/`handleKeyDown`/`handleDragOver`/`emitChange`/`resolveResourceDropTarget`/`handleDrop`/`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`（全部迁入 `drag-controller.js` 或根 `minimap-controller.js`，见上）。

保留：`syncConfigFromProps`/`emitConfigChange`/`handleOverviewNavigate`（跟拖拽无关）；`searchKeyword`/`searchMatches`/`searchCurrentIndex`/`contextMenuState`/`renderStats` 等模板绑定 ref；`createInteractionController()` 组装 deps（表变短，不再需要 `onPointerDown` 等回调和三个临时桥接）；`onMounted`/`onUnmounted`/prop watchers/`defineExpose` 结构不变，只是 `defineExpose` 里 `fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo` 改成直接转发 `controller.xxx()`（不再需要本地包装函数）。

`onUnmounted` 里原来的 `cancelPointerInteractions()` 调用改成 `controller?.cancelPointerInteractions()`。

## 测试策略

新建 `test/minimap-drag-controller.test.js`，沿用 `test/minimap-edit-controller.test.js`/`test/minimap-selection-controller.test.js` 的 mock-deps 风格（纯对象/函数 mock，不需要 jsdom）。覆盖：

- 节点拖拽：同父分组内换位（`reorder-group-child`）、跨父移动（`move-node`）、`readonly`/`beforeGroupReorder`/`beforeNodeMove` 拦截、拖拽距离不超过阈值时退化为点击选中。
- 滚动条拖拽：受控/非受控 `groupStates` 下松手的提交/回滚行为。
- 框选：`marqueeState` 生命周期、`idsInSelectionRect` 调用、Cmd/Ctrl 触发条件。
- 空白平移：相对拖拽起点视口算总位移、`viewport-change` 不在每帧都 emit。
- 滚轮：分组框悬停时的滚动条联动 vs 缩放分支、`dragState`/`scrollbarDragState`/`panState` 忙碌时直接 return。
- 三个 rAF 循环的启停条件（自动滚动/边缘平移/拖拽让位动画），mock `requestAnimationFrame`/`cancelAnimationFrame`。
- 资源拖放提交（`drop-node` operation、`beforeNodeDrop` 拦截、插入下标计算）。
- `cancelPointerInteractions()` 清空全部四个状态、取消三个 rAF。

`test/minimap-edit-controller.test.js` 新增对 `emitChangeIfApplied` 的覆盖（如果之前没有间接覆盖到）。`test/minimap-context-menu-controller.test.js` 新增对 `isOpen()` 的覆盖。`test/minimap-root-controller.test.js` 里"mount attaches every canvas DOM listener and forwards events to the injected handlers"这条要改——`pointerdown`/`pointermove`/`pointerup`/`pointerleave`/`pointercancel`/`lostpointercapture`/`wheel`/`dragover`/`drop`/`keydown` 不再转发到注入的 deps 回调，而是跟现有"contextmenu 事件直接派发给 context-menu-controller"那条用例（line 226）一样改成验证直接派发给 `drag`/`handleKeyDown`。`test/minimap-shell.test.js` 等现有 Vue 集成测试预期不变，作为行为不变的回归证据。

## 验收标准

- `Minimap.vue` 的 `<script setup>` 不再包含任何指针事件处理代码，没有 `dragState` 之类的本地状态机变量。
- 现有全部测试 + 新增 `drag-controller` 测试通过，`npm run build` 通过。
- 组件对外 props/emits/`defineExpose` 方法名和参数形状不变。
- 手动验收：节点拖拽（同父换位/跨父移动）、滚动条拖拽、框选、空白平移、滚轮缩放/分组滚动、资源拖入、`fitToScreen`/`centerOnNode` 等相机方法在拖拽中途调用会先取消拖拽，行为跟切片前一致。
