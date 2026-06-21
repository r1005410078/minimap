# Controller 抽取切片 3：drag-controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `Minimap.vue` 里最后一块本地状态机——节点拖拽/滚动条拖拽/框选/空白平移/三个 rAF 循环/滚轮/资源拖放——迁到新的框架无关 `drag-controller.js`，`Minimap.vue` 对外行为完全不变。完成后 `Minimap.vue` 的 `<script setup>` 不再包含任何指针事件处理代码。

**Architecture:** 一个工厂函数 `createDragController(deps)`，内部状态（`dragState`/`scrollbarDragState`/`panState`/`marqueeState`/`hoveredScrollbarGroupId`）是纯闭包变量。根 `minimap-controller.js` 的组装顺序改成 `selection → core → edit → contextMenu → drag → search`（`contextMenu` 挪到 `drag` 前面），用延迟闭包解开 `core`↔`drag`、`contextMenu`↔`drag` 两组循环依赖。根 controller 新增 4 个本地相机函数（先 `drag.cancelPointerInteractions()` 再转发 `core`）和一个 `handleKeyDown` 派发函数，`mount()` 里的 `pointerdown`/`pointermove`/`pointerup`/`pointerleave`/`pointercancel`/`lostpointercapture`/`wheel`/`dragover`/`drop`/`keydown` 全部从"转发 deps 里的 Vue 闭包"改成直接调用 `drag`/`handleKeyDown`。详见 [docs/superpowers/specs/2026-06-21-controller-extraction-slice-3-design.md](../specs/2026-06-21-controller-extraction-slice-3-design.md)。

**Tech Stack:** Vue 2.7 `<script setup>`，Node 内置 `node --test`，`test/helpers/canvas-env.js` 的 `stubAnimationFrame()`（drag-controller 不摸 DOM，不需要 jsdom）。

## Global Constraints

- 不引入新的运行时第三方依赖。
- `drag-controller` 不直接持有 Vue ref 或 Vue 组件实例，只通过 deps 里的回调跟外部交互。
- `Minimap.vue` 对外 props/emits/`defineExpose` 方法名和参数形状必须保持不变。
- 每个任务完成后跑一次相关测试；最后一个任务跑全量 `npm test` + `npm run build`。

---

## File Structure

- Modify `src/minimap/interaction.js` —— 新增 `scrollbarMetrics`/`hitScrollbarThumb` 两个纯函数。
- Modify `test/minimap-interaction.test.js` —— 覆盖这两个新函数。
- Modify `src/minimap/edit-controller.js` —— 把内部私有的 `emitChangeIfApplied` 加进返回对象。
- Modify `test/minimap-edit-controller.test.js` —— 覆盖 `emitChangeIfApplied` 被导出。
- Modify `src/minimap/context-menu-controller.js` —— 新增 `isOpen()`。
- Modify `test/minimap-context-menu-controller.test.js` —— 覆盖 `isOpen()`。
- Create `src/minimap/drag-controller.js`。
- Create `test/minimap-drag-controller.test.js`。
- Modify `src/minimap/minimap-controller.js` —— 组装 `drag`，调整构造顺序，新增 `handleKeyDown`/4 个相机函数，`mount()` 里 9 类事件改直接派发。
- Modify `test/minimap-root-controller.test.js` —— 更新 deps 形状和事件派发断言。
- Modify `src/minimap/Minimap.vue` —— 删除全部已迁出的本地状态/函数，接入新方法。
- Modify `ROADMAP.md` —— 勾选切片 3。

---

## Task 1: `interaction.js` 新增 `scrollbarMetrics`/`hitScrollbarThumb`

**Files:**
- Modify: `src/minimap/interaction.js`
- Modify: `test/minimap-interaction.test.js`

**Interfaces:**
- Produces：
  ```js
  scrollbarMetrics(group)
  // -> { trackX, trackY, trackHeight, thumbHeight, thumbY, maxScroll, maxThumbOffset }
  hitScrollbarThumb(layout, point)
  // -> { group, metrics } | null
  ```
  这两个函数原本是 `Minimap.vue` 的本地函数（`hitScrollbarThumb` 原来直接调 `controller.getLayout()`，现在改成显式接收 `layout` 参数，因为 `interaction.js` 不持有任何 controller 引用）。`SCROLLBAR_WIDTH = 8` 这个常量也跟着搬进 `interaction.js`（之前是 `Minimap.vue` 的本地常量）。

- [ ] **Step 1: 写失败测试**

在 `test/minimap-interaction.test.js` 顶部的 import 列表里加上这两个函数名：

```js
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
  resolveDropTarget,
  edgePanVelocity,
  scrollbarMetrics,
  hitScrollbarThumb,
} from '../src/minimap/interaction.js'
```

在文件末尾追加：

```js
function scrollableGroup(overrides = {}) {
  return {
    id: 'g1',
    x: 100,
    y: 50,
    width: 200,
    height: 150,
    contentHeight: 400,
    scrollTop: 0,
    overflowY: true,
    ...overrides,
  }
}

test('scrollbarMetrics computes the track and thumb rect from group geometry', () => {
  const group = scrollableGroup()

  const metrics = scrollbarMetrics(group)

  assert.equal(metrics.trackX, 292) // x + width - SCROLLBAR_WIDTH(8) = 100+200-8
  assert.equal(metrics.trackY, 78) // y + GROUP.header(28)
  assert.equal(metrics.trackHeight, 122) // height - GROUP.header
  assert.equal(metrics.maxScroll, 250) // contentHeight - height
  assert.ok(Math.abs(metrics.thumbHeight - 45.75) < 0.001) // (height/contentHeight)*trackHeight
  assert.ok(Math.abs(metrics.maxThumbOffset - 76.25) < 0.001) // trackHeight - thumbHeight
  assert.equal(metrics.thumbY, 78) // scrollTop 0 -> no offset
})

test('scrollbarMetrics offsets the thumb down as scrollTop increases', () => {
  const group = scrollableGroup({ scrollTop: 125 }) // half of maxScroll(250)

  const metrics = scrollbarMetrics(group)

  assert.ok(Math.abs(metrics.thumbY - (78 + metrics.maxThumbOffset / 2)) < 0.001)
})

test('hitScrollbarThumb finds the group whose thumb rect contains the point', () => {
  const group = scrollableGroup()
  const layout = { groups: [group] }
  const metrics = scrollbarMetrics(group)
  const point = { x: metrics.trackX + 1, y: metrics.thumbY + 1 }

  const hit = hitScrollbarThumb(layout, point)

  assert.equal(hit.group, group)
  assert.deepEqual(hit.metrics, metrics)
})

test('hitScrollbarThumb returns null for a point outside every track, and skips non-overflowing groups', () => {
  const overflowing = scrollableGroup({ id: 'g1' })
  const notOverflowing = scrollableGroup({ id: 'g2', overflowY: false })
  const layout = { groups: [notOverflowing, overflowing] }

  assert.equal(hitScrollbarThumb(layout, { x: 0, y: 0 }), null)

  const metrics = scrollbarMetrics(overflowing)
  const hit = hitScrollbarThumb(layout, { x: metrics.trackX + 1, y: metrics.thumbY + 1 })
  assert.equal(hit.group, overflowing)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-interaction.test.js`
Expected: 失败，因为 `scrollbarMetrics`/`hitScrollbarThumb` 还不存在。

- [ ] **Step 3: 实现**

在 `src/minimap/interaction.js` 顶部 `GROUP` 相关 import 之后加一个常量，并在 `edgePanVelocity` 之后追加两个函数（文件末尾）：

```js
const SCROLLBAR_WIDTH = 8
```

```js
export function scrollbarMetrics(group) {
  const trackHeight = group.height - GROUP.header
  const thumbHeight = (group.height / group.contentHeight) * trackHeight
  const maxScroll = Math.max(0, group.contentHeight - group.height)
  const maxThumbOffset = Math.max(1, trackHeight - thumbHeight)
  const thumbOffset = maxScroll > 0 ? (group.scrollTop / maxScroll) * maxThumbOffset : 0
  return {
    trackX: group.x + group.width - SCROLLBAR_WIDTH,
    trackY: group.y + GROUP.header,
    trackHeight,
    thumbHeight,
    thumbY: group.y + GROUP.header + thumbOffset,
    maxScroll,
    maxThumbOffset,
  }
}

export function hitScrollbarThumb(layout, point) {
  for (const group of layout.groups) {
    if (!group.overflowY) continue
    const metrics = scrollbarMetrics(group)
    const withinX = point.x >= metrics.trackX && point.x <= metrics.trackX + SCROLLBAR_WIDTH
    const withinY = point.y >= metrics.thumbY && point.y <= metrics.thumbY + metrics.thumbHeight
    if (withinX && withinY) return { group, metrics }
  }
  return null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-interaction.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/interaction.js test/minimap-interaction.test.js
git commit -m "feat: move scrollbarMetrics/hitScrollbarThumb into interaction.js"
```

---

## Task 2: `edit-controller.js` 暴露 `emitChangeIfApplied`

**Files:**
- Modify: `src/minimap/edit-controller.js`
- Modify: `test/minimap-edit-controller.test.js`

**Interfaces:**
- Produces：在现有返回对象上新增 `emitChangeIfApplied(result)`（实现不变，只是从内部私有函数变成公开方法）——`drag-controller` 提交 `move-node`/`reorder-group-child`/`drop-node` 后要复用它来 emit `'change'`，避免在两处维护同一份 `{ type, operation, previousGraph, nextGraph, reason }` 拼装逻辑。

- [ ] **Step 1: 写失败测试**

在 `test/minimap-edit-controller.test.js` 末尾追加：

```js
test('emitChangeIfApplied is exposed for cross-controller reuse (e.g. drag-controller) and only emits when applied', () => {
  const graph = createDemoGraph()
  const { deps, emitted } = createDeps(graph)
  const controller = createEditController(deps)

  controller.emitChangeIfApplied({ applied: false, type: 'move-node', operation: {}, previousGraph: graph, nextGraph: graph, reason: 'blocked' })
  assert.equal(emitted.change.length, 0)

  controller.emitChangeIfApplied({ applied: true, type: 'move-node', operation: { type: 'move-node', payload: {} }, previousGraph: graph, nextGraph: graph, reason: null })
  assert.equal(emitted.change.length, 1)
  assert.equal(emitted.change[0].type, 'move-node')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-edit-controller.test.js`
Expected: 失败，`controller.emitChangeIfApplied` 不是一个函数。

- [ ] **Step 3: 实现**

在 `src/minimap/edit-controller.js` 文件末尾的返回对象里加一行：

```diff
  return {
    undo,
    redo,
    canUndo,
    canRedo,
    deleteSelection,
    copySelection,
    paste,
    pasteInto,
    exportGraph,
    importGraph,
    applyOperation,
    onGraphReplaced,
+   emitChangeIfApplied,
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-edit-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/edit-controller.js test/minimap-edit-controller.test.js
git commit -m "feat: expose emitChangeIfApplied from edit-controller for drag-controller reuse"
```

---

## Task 3: `context-menu-controller.js` 新增 `isOpen()`

**Files:**
- Modify: `src/minimap/context-menu-controller.js`
- Modify: `test/minimap-context-menu-controller.test.js`

**Interfaces:**
- Produces：在现有返回对象上新增 `isOpen()`（`() => state !== null`）——根 controller 的 `handleKeyDown` 要用它判断 `Escape` 该关菜单还是清选中（根 controller 自己不持有菜单开关状态）。

- [ ] **Step 1: 写失败测试**

在 `test/minimap-context-menu-controller.test.js` 末尾追加：

```js
test('isOpen reflects whether the menu is currently open', () => {
  const layout = demoLayout()
  const { deps } = createDeps(layout)
  const controller = createContextMenuController(deps)

  assert.equal(controller.isOpen(), false)

  controller.open({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })
  assert.equal(controller.isOpen(), true)

  controller.close()
  assert.equal(controller.isOpen(), false)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-context-menu-controller.test.js`
Expected: 失败，`controller.isOpen` 不是一个函数。

- [ ] **Step 3: 实现**

```diff
- return { open, close, runItem }
+ return { open, close, runItem, isOpen: () => state !== null }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-context-menu-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/context-menu-controller.js test/minimap-context-menu-controller.test.js
git commit -m "feat: add isOpen() to context-menu-controller"
```

---

## Task 4: `drag-controller.js`

**Files:**
- Create: `src/minimap/drag-controller.js`
- Create: `test/minimap-drag-controller.test.js`

**Interfaces:**
- Consumes：Task 1 的 `scrollbarMetrics`/`hitScrollbarThumb`（从 `interaction.js` 导入）。
- Produces：
  ```js
  createDragController({
    // 只读 getter，转发 props/computed
    getGraph, getLayoutDirection, getOptions, getGroupStatesProp,
    getBeforeNodeDrop, getBeforeGroupReorder, getBeforeNodeMove,

    // core
    getLayout, getViewport, applyViewport, updateLayout, getCssSize,
    screenPointFromClient, pointFromClient,
    renderCurrent, scheduleRender, flushScheduledRender, cancelScheduledRender,
    settleAnimation, scrollGroup, setGroupExpanded, zoomAt,
    getCanvasEl,

    // selection
    getSelectedIds, setSelected,

    // edit
    applyOperation, emitChangeIfApplied,

    // context-menu
    closeContextMenu,

    // 输出回调
    emitNodeDrop, emitGroupReorder, emitNodeMove,
  }) -> {
    onPointerDown(event), onPointerMove(event), onPointerUp(event),
    onPointerLeave(), onPointerCancel(), onLostPointerCapture(),
    onWheel(event),
    onDragOver(event), onDrop(event),
    cancelPointerInteractions(),
    getInteractionRenderState(),
  }
  ```
- 注意：spec 文档的 deps 列表漏了 `updateLayout`（`cancelScrollbarDrag`/`handlePointerUp`/`handleDrop` 三处都要用它来重新算 layout），本任务补上。

- [ ] **Step 1: 写失败测试**

Create `test/minimap-drag-controller.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'
import { scrollbarMetrics } from '../src/minimap/interaction.js'
import { createGraphOperationManager } from '../src/minimap/graph-operations.js'
import { createDragController } from '../src/minimap/drag-controller.js'

function demoLayout() {
  return computeLayout(createDemoGraph(), { viewportWidth: 1200, viewportHeight: 760 })
}

function createDeps(graph, layout, overrides = {}) {
  const calls = {
    renderCurrent: 0,
    scheduleRender: [],
    flushScheduledRender: 0,
    cancelScheduledRender: 0,
    settleAnimation: 0,
    scrollGroup: [],
    setGroupExpanded: [],
    zoomAt: [],
    applyViewport: [],
    updateLayout: [],
    closeContextMenu: 0,
    emitNodeDrop: [],
    emitGroupReorder: [],
    emitNodeMove: [],
    change: [],
  }
  let selectedIds = []
  let viewport = { x: 0, y: 0, scale: 1 }
  const operationManager = createGraphOperationManager(graph)
  const canvasEl = {
    focusCalls: 0,
    captured: [],
    focus() { this.focusCalls += 1 },
    setPointerCapture(id) { this.captured.push(id) },
  }
  const deps = {
    getGraph: () => graph,
    getLayoutDirection: () => 'horizontal',
    getOptions: () => ({}),
    getGroupStatesProp: () => null,
    getBeforeNodeDrop: () => null,
    getBeforeGroupReorder: () => null,
    getBeforeNodeMove: () => null,
    getLayout: () => layout,
    getViewport: () => viewport,
    applyViewport: (next, opts) => { calls.applyViewport.push({ next, opts }); viewport = next; return true },
    updateLayout: (opts) => calls.updateLayout.push(opts),
    getCssSize: () => ({ width: 1200, height: 760 }),
    screenPointFromClient: (x, y) => ({ x, y }),
    pointFromClient: (x, y) => ({ x, y }),
    renderCurrent: () => { calls.renderCurrent += 1 },
    scheduleRender: (reason) => calls.scheduleRender.push(reason),
    flushScheduledRender: () => { calls.flushScheduledRender += 1 },
    cancelScheduledRender: () => { calls.cancelScheduledRender += 1 },
    settleAnimation: () => { calls.settleAnimation += 1 },
    scrollGroup: (group, scrollTop) => calls.scrollGroup.push({ groupId: group.id, scrollTop }),
    setGroupExpanded: (id, expanded) => calls.setGroupExpanded.push({ id, expanded }),
    zoomAt: (screenPoint, deltaY) => calls.zoomAt.push({ screenPoint, deltaY }),
    getCanvasEl: () => canvasEl,
    getSelectedIds: () => selectedIds,
    setSelected: (ids) => { selectedIds = ids },
    applyOperation: (operation, opts) => operationManager.apply(operation, { readonly: false, before: opts?.before }),
    emitChangeIfApplied: (result) => { if (result.applied) calls.change.push(result) },
    closeContextMenu: () => { calls.closeContextMenu += 1 },
    emitNodeDrop: (payload) => calls.emitNodeDrop.push(payload),
    emitGroupReorder: (payload) => calls.emitGroupReorder.push(payload),
    emitNodeMove: (payload) => calls.emitNodeMove.push(payload),
    ...overrides,
  }
  return { deps, calls, canvasEl }
}

function downEvent(point, extra = {}) {
  return { clientX: point.x, clientY: point.y, button: 0, pointerId: 1, ...extra }
}

function moveEvent(point, extra = {}) {
  return { clientX: point.x, clientY: point.y, ...extra }
}

test('clicking a node without moving selects it instead of starting a drag', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const point = { x: 460, y: 20 } // feeder-1 center

  drag.onPointerDown(downEvent(point))
  drag.onPointerUp(downEvent(point))

  assert.deepEqual(deps.getSelectedIds(), ['feeder-1'])
})

test('dragging a sibling into the gap between two other siblings reorders it within the same parent', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const from = { x: 460, y: 20 } // feeder-1 center
  const gap = { x: 460, y: 116 } // between feeder-2 (64-104) and feeder-3 (128-168)

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent(gap))
  drag.onPointerUp(moveEvent(gap))

  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-1', 'feeder-3'])
  assert.equal(calls.emitGroupReorder.length, 1)
  assert.deepEqual(calls.emitGroupReorder[0], { groupId: null, childId: 'feeder-1', index: 1 })
  assert.equal(calls.change.length, 1)
  assert.deepEqual(calls.updateLayout, [undefined])
})

test('dragging a node onto a node in a different subtree moves it as a new child appended at the end', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const from = { x: 460, y: 20 } // feeder-1
  const to = { x: 60, y: 351 } // energy-root, an ancestor's sibling subtree

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent(to))
  drag.onPointerUp(moveEvent(to))

  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.deepEqual(graph.nodes.get('energy-root').children, ['grid-tie', 'heap-1', 'cluster-25', 'feeder-1'])
  assert.equal(calls.emitNodeMove.length, 1)
  assert.deepEqual(calls.emitNodeMove[0], { nodeId: 'feeder-1', fromParentId: 'grid-tie', toParentId: 'energy-root', index: 3 })
  assert.equal(calls.change.length, 1)
})

test('readonly blocks a cross-parent move and leaves the graph untouched, but still re-renders', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const operationManager = createGraphOperationManager(graph)
  const { deps, calls } = createDeps(graph, layout, {
    applyOperation: (operation, opts) => operationManager.apply(operation, { readonly: true, before: opts?.before }),
  })
  const drag = createDragController(deps)
  const from = { x: 460, y: 20 }
  const to = { x: 60, y: 351 }

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent(to))
  drag.onPointerUp(moveEvent(to))

  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.equal(calls.emitNodeMove.length, 0)
  assert.equal(calls.renderCurrent, 2) // one from the move, one from the blocked drop re-render
})

test('dragging a node onto its own descendant does not move it', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const from = { x: 260, y: 84 } // grid-tie center
  const to = { x: 460, y: 20 } // feeder-1, grid-tie's own child

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent(to))
  drag.onPointerUp(moveEvent(to))

  assert.deepEqual(graph.nodes.get('energy-root').children, ['grid-tie', 'heap-1', 'cluster-25'])
  assert.equal(calls.emitNodeMove.length, 0)
  assert.equal(calls.emitGroupReorder.length, 0)
})

test('dragging a group scrollbar thumb updates scrollTop live and commits on release', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const group = layout.groups.find((g) => g.id === 'heap-1::g0')
  const metrics = scrollbarMetrics(group)
  const thumbPoint = { x: metrics.trackX + 1, y: metrics.thumbY + metrics.thumbHeight / 2 }

  drag.onPointerDown(downEvent(thumbPoint))
  drag.onPointerMove(moveEvent({ x: thumbPoint.x, y: thumbPoint.y + 50 }))
  drag.onPointerUp(moveEvent({ x: thumbPoint.x, y: thumbPoint.y + 50 }))

  assert.ok(group.scrollTop > 0)
  assert.deepEqual(calls.scrollGroup, [{ groupId: 'heap-1::g0', scrollTop: group.scrollTop }])
})

test('cancelPointerInteractions rolls back an in-progress uncontrolled scrollbar drag', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const group = layout.groups.find((g) => g.id === 'heap-1::g0')
  const metrics = scrollbarMetrics(group)
  const thumbPoint = { x: metrics.trackX + 1, y: metrics.thumbY + metrics.thumbHeight / 2 }
  const startScrollTop = group.scrollTop

  drag.onPointerDown(downEvent(thumbPoint))
  drag.onPointerMove(moveEvent({ x: thumbPoint.x, y: thumbPoint.y + 50 }))
  assert.notEqual(group.scrollTop, startScrollTop)

  drag.cancelPointerInteractions()

  assert.equal(group.scrollTop, startScrollTop)
})

test('Ctrl/Cmd-drag on blank canvas marquee-selects the nodes inside the rect on release', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const start = { x: 380, y: -10 }
  const end = { x: 540, y: 170 } // covers feeder-1/2/3, nothing else

  drag.onPointerDown(downEvent(start, { metaKey: true }))
  drag.onPointerMove(moveEvent(end, { metaKey: true }))
  drag.onPointerUp(moveEvent(end, { metaKey: true }))

  assert.deepEqual(deps.getSelectedIds().sort(), ['feeder-1', 'feeder-2', 'feeder-3'])
})

test('blank canvas pan applies the total displacement from the pointer-down viewport, not cumulative per-frame deltas', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const start = { x: 700, y: 700 } // blank area below the cluster-25 group

  drag.onPointerDown(downEvent(start))
  drag.onPointerMove(moveEvent({ x: start.x - 20, y: start.y - 10 }))
  drag.onPointerMove(moveEvent({ x: start.x - 50, y: start.y - 30 }))

  assert.deepEqual(calls.applyViewport.at(-1).next, { x: -50, y: -30, scale: 1 })
})

test('wheel over blank canvas zooms via the injected zoomAt, not group scrolling', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)

  drag.onWheel({ clientX: 700, clientY: 700, deltaY: -100, preventDefault: () => {} })

  assert.equal(calls.zoomAt.length, 1)
  assert.deepEqual(calls.zoomAt[0], { screenPoint: { x: 700, y: 700 }, deltaY: -100 })
  assert.equal(calls.scrollGroup.length, 0)
  assert.equal(calls.settleAnimation, 1)
  assert.equal(calls.closeContextMenu, 1)
})

test('wheel over a scrollable group scrolls it instead of zooming', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const group = layout.groups.find((g) => g.id === 'heap-1::g0') // x:400..934, y:192..511.2, header ends at 220

  drag.onWheel({ clientX: 410, clientY: 300, deltaY: 50, preventDefault: () => {} })

  assert.deepEqual(calls.scrollGroup, [{ groupId: group.id, scrollTop: 50 }])
  assert.equal(calls.zoomAt.length, 0)
})

test('wheel is ignored while a pan, node drag, or scrollbar drag is in progress', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  drag.onPointerDown(downEvent({ x: 700, y: 700 })) // starts a blank pan

  drag.onWheel({ clientX: 700, clientY: 700, deltaY: -100, preventDefault: () => {} })

  assert.equal(calls.zoomAt.length, 0)
  assert.equal(calls.scrollGroup.length, 0)
})

test('dropping a resource over a node appends it as that node\'s last child via drop-node', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const event = {
    preventDefault: () => {},
    clientX: 260,
    clientY: 84, // grid-tie center
    dataTransfer: { getData: () => JSON.stringify({ id: 'sensor', label: 'Sensor' }) },
  }

  drag.onDrop(event)

  const gridTie = graph.nodes.get('grid-tie')
  assert.equal(gridTie.children.length, 4)
  const newId = gridTie.children[3]
  assert.equal(graph.nodes.get(newId).label, 'Sensor')
  assert.equal(calls.emitNodeDrop.length, 1)
  assert.equal(calls.emitNodeDrop[0].parentId, 'grid-tie')
  assert.equal(calls.emitNodeDrop[0].index, 3)
  assert.equal(calls.change.length, 1)
})

test('beforeNodeDrop returning false blocks the drop and leaves the graph untouched', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout, { getBeforeNodeDrop: () => () => false })
  const drag = createDragController(deps)
  const event = {
    preventDefault: () => {},
    clientX: 260,
    clientY: 84,
    dataTransfer: { getData: () => JSON.stringify({ id: 'sensor', label: 'Sensor' }) },
  }

  drag.onDrop(event)

  assert.equal(graph.nodes.get('grid-tie').children.length, 3)
  assert.equal(calls.emitNodeDrop.length, 0)
})

test('cancelPointerInteractions clears an in-progress pan/marquee and cancels scheduled rendering', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  drag.onPointerDown(downEvent({ x: 700, y: 700 }))
  drag.onPointerMove(moveEvent({ x: 650, y: 650 }))

  drag.cancelPointerInteractions()

  assert.equal(calls.cancelScheduledRender, 1)
  const viewportCallsBefore = calls.applyViewport.length
  drag.onPointerUp(moveEvent({ x: 650, y: 650 }))
  assert.equal(calls.applyViewport.length, viewportCallsBefore) // pointerup after cancel is a no-op, not a completed pan
})

test('dragging near the canvas edge starts an edge-pan rAF loop that pans the viewport on each tick, and cancelPointerInteractions stops it', () => {
  const { scheduled } = stubAnimationFrame()
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const from = { x: 460, y: 20 } // feeder-1

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent({ x: 1195, y: 300 })) // inside the 24px edge zone on the right
  const pending = scheduled.find((frame) => !frame.cancelled && !frame.ran)
  assert.ok(pending, 'expected an edge-pan rAF frame to be scheduled')
  pending.callback()

  assert.equal(calls.applyViewport.length, 1)
  assert.ok(calls.applyViewport[0].next.x < 0)

  drag.cancelPointerInteractions()

  assert.equal(scheduled.some((frame) => !frame.cancelled && !frame.ran), false)
})

test('getInteractionRenderState reflects an in-progress marquee selection rect', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  drag.onPointerDown(downEvent({ x: 700, y: 700 }, { metaKey: true }))
  drag.onPointerMove(moveEvent({ x: 750, y: 740 }, { metaKey: true }))

  const state = drag.getInteractionRenderState()

  assert.equal(state.dragging, false)
  assert.equal(state.interacting, true)
  assert.deepEqual(state.selectionRect, { x: 700, y: 700, width: 50, height: 40 })
})

test('getInteractionRenderState reports dragging true with a groupDrag descriptor while a plain-sibling drag is in progress', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  drag.onPointerDown(downEvent({ x: 460, y: 20 })) // feeder-1
  drag.onPointerMove(moveEvent({ x: 460, y: 116 })) // gap between feeder-2/3, no real group involved

  const state = drag.getInteractionRenderState()

  assert.equal(state.dragging, true)
  assert.equal(state.groupDrag.groupId, null)
  assert.equal(state.groupDrag.draggingChildId, 'feeder-1')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-drag-controller.test.js`
Expected: 失败，因为 `src/minimap/drag-controller.js` 不存在。

- [ ] **Step 3: 实现**

Create `src/minimap/drag-controller.js`:

```js
import { GROUP, clampGroupScroll } from './layout.js'
import { worldRectToScreen } from './renderer.js'
import { screenToWorld } from './coords.js'
import { panViewportBy, viewportOptions } from './viewport.js'
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
  resolveDropTarget,
  edgePanVelocity,
  hitScrollbarThumb,
} from './interaction.js'
import {
  buildVirtualOrder,
  childWorldRectsById,
  currentShiftRects,
  dragShiftEasedProgress,
  dragShiftProgress,
} from './drag-transition.js'
import { applySelectionClick, idsInSelectionRect, normalizeRect } from './selection.js'

const DRAG_SHIFT_DURATION_MS = 150

export function createDragController(deps) {
  let dragState = null
  let scrollbarDragState = null
  let panState = null
  let marqueeState = null
  let hoveredScrollbarGroupId = null

  const now = () => (globalThis.performance ?? Date).now()

  function clearDragShiftAnimation() {
    if (!dragState) return
    dragState.shiftFromById = null
    dragState.shiftToById = null
    dragState.shiftStartedAt = null
  }

  function shouldAutoScroll(group) {
    return group && dragState?.ghostWorldPoint && groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y) !== 0
  }

  function getInteractionRenderState() {
    const timestamp = now()
    if (!dragState || !dragState.dragging) {
      return {
        dragging: false,
        interacting: Boolean(panState || marqueeState?.active),
        groupDrag: null,
        selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
        groupScrollbarHoverId: hoveredScrollbarGroupId,
        attachPreview: null,
      }
    }
    const layout = deps.getLayout()
    const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
    let groupDrag
    if (!group) {
      groupDrag = {
        groupId: null,
        order: null,
        draggingChildId: dragState.nodeId,
        ghostRect: dragState.ghostScreenRect,
        childRectsById: null,
        dropSlotOpacity: 1,
      }
    } else {
      const order = buildVirtualOrder(group.children, dragState.nodeId, dragState.insertIndex)
      const autoScrolling = shouldAutoScroll(group)
      const childRectsById =
        !autoScrolling &&
        dragState.shiftFromById &&
        dragState.shiftToById &&
        dragState.shiftStartedAt != null
          ? currentShiftRects(dragState.shiftFromById, dragState.shiftToById, dragState.shiftStartedAt, DRAG_SHIFT_DURATION_MS, timestamp)
          : null
      const dropSlotOpacity =
        autoScrolling || dragState.slotFadeStartedAt == null
          ? 1
          : dragShiftEasedProgress(dragState.slotFadeStartedAt, DRAG_SHIFT_DURATION_MS, timestamp)
      groupDrag = { groupId: group.id, order, draggingChildId: dragState.nodeId, ghostRect: dragState.ghostScreenRect, childRectsById, dropSlotOpacity }
    }
    return {
      dragging: true,
      interacting: false,
      groupDrag,
      selectionRect: null,
      groupScrollbarHoverId: hoveredScrollbarGroupId,
      attachPreview: dragState.attachPreviewRect
        ? { rect: dragState.attachPreviewRect, parentRect: dragState.attachPreviewParentRect }
        : null,
    }
  }

  function dragShiftActive(timestamp = now()) {
    if (!dragState?.dragging) return false
    const shiftActive =
      dragState.shiftStartedAt != null &&
      dragShiftProgress(dragState.shiftStartedAt, DRAG_SHIFT_DURATION_MS, timestamp) < 1
    const slotActive =
      dragState.slotFadeStartedAt != null &&
      dragShiftProgress(dragState.slotFadeStartedAt, DRAG_SHIFT_DURATION_MS, timestamp) < 1
    return shiftActive || slotActive
  }

  function cancelDragShiftLoop() {
    if (dragState?.shiftRafId != null) {
      cancelAnimationFrame(dragState.shiftRafId)
      dragState.shiftRafId = null
    }
  }

  function ensureDragShiftLoop() {
    if (!dragState?.dragging || dragState.shiftRafId != null || dragState.scrollRafId != null) return
    const tick = (time) => {
      if (!dragState?.dragging) {
        cancelDragShiftLoop()
        return
      }
      deps.renderCurrent()
      if (dragShiftActive(time ?? now())) dragState.shiftRafId = requestAnimationFrame(tick)
      else dragState.shiftRafId = null
    }
    dragState.shiftRafId = requestAnimationFrame(tick)
  }

  function withinGroupBody(group, point) {
    return (
      point.x >= group.x &&
      point.x <= group.x + group.width &&
      point.y >= group.y + GROUP.header &&
      point.y <= group.y + group.height
    )
  }

  function updateDragTarget(worldPoint) {
    const layout = deps.getLayout()
    const previousGroupId = dragState.targetGroupId
    const previousIndex = dragState.insertIndex

    const activeGroup = previousGroupId ? layout.groups.find((g) => g.id === previousGroupId) : null
    const target =
      activeGroup && withinGroupBody(activeGroup, worldPoint)
        ? {
            valid: true,
            parentId: activeGroup.parentId,
            group: activeGroup,
            insertIndex: groupGridIndexAt(
              { ...activeGroup, children: activeGroup.children.filter((id) => id !== dragState.nodeId) },
              worldPoint,
            ),
            previewRect: null,
          }
        : resolveDropTarget(
            deps.getGraph(),
            layout,
            worldPoint,
            dragState.nodeId,
            deps.getLayoutDirection(),
            deps.getViewport().scale,
          )

    if (!target.valid) {
      clearDragShiftAnimation()
      dragState.targetParentId = null
      dragState.targetGroupId = null
      dragState.insertIndex = 0
      dragState.attachPreviewRect = null
      dragState.attachPreviewParentRect = null
    } else if (target.group) {
      const autoScrolling = shouldAutoScroll(target.group)
      const groupChanged = previousGroupId !== target.group.id
      const indexChanged = previousIndex !== target.insertIndex
      if (!autoScrolling && (groupChanged || indexChanged)) {
        scheduleDragShift(target.group, target.insertIndex, { reset: groupChanged })
      } else if (autoScrolling) {
        clearDragShiftAnimation()
      }
      dragState.targetParentId = target.parentId
      dragState.targetGroupId = target.group.id
      dragState.insertIndex = target.insertIndex
      dragState.attachPreviewRect = null
      dragState.attachPreviewParentRect = null
    } else {
      clearDragShiftAnimation()
      dragState.targetParentId = target.parentId
      dragState.targetGroupId = null
      dragState.insertIndex = target.insertIndex
      dragState.attachPreviewRect = target.previewRect ?? null
      dragState.attachPreviewParentRect = target.previewRect ? layout.nodes.get(target.parentId) : null
    }

    dragState.ghostWorldPoint = worldPoint
    dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
  }

  function scheduleDragShift(group, insertIndex, { reset = false } = {}) {
    const timestamp = now()
    const fromById =
      !reset && dragState.shiftFromById && dragState.shiftToById && dragState.shiftStartedAt != null
        ? currentShiftRects(
            dragState.shiftFromById,
            dragState.shiftToById,
            dragState.shiftStartedAt,
            DRAG_SHIFT_DURATION_MS,
            timestamp,
          )
        : childWorldRectsById(group, group.children)
    const toOrder = buildVirtualOrder(group.children, dragState.nodeId, insertIndex)
    dragState.shiftFromById = fromById
    dragState.shiftToById = childWorldRectsById(group, toOrder)
    dragState.shiftStartedAt = timestamp
  }

  function isAdditiveSelection(event) {
    return event.shiftKey || event.metaKey || event.ctrlKey
  }

  function ghostRectForPoint(worldPoint) {
    const worldRect = {
      x: worldPoint.x - GROUP.itemW / 2,
      y: worldPoint.y - GROUP.itemH / 2,
      width: GROUP.itemW,
      height: GROUP.itemH,
    }
    return worldRectToScreen(worldRect, deps.getViewport())
  }

  function cancelAutoScrollLoop() {
    if (dragState && dragState.scrollRafId !== null) {
      cancelAnimationFrame(dragState.scrollRafId)
      dragState.scrollRafId = null
    }
  }

  function startAutoScrollLoop() {
    const tick = (time) => {
      if (!dragState || !dragState.dragging) return
      const layout = deps.getLayout()
      const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
      if (group && dragState.ghostWorldPoint) {
        const delta = groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y)
        if (delta !== 0) {
          group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)
          clearDragShiftAnimation()
          updateDragTarget(dragState.ghostWorldPoint)
        }
      }
      deps.renderCurrent()
      const timestamp = time ?? now()
      const scrolling = shouldAutoScroll(group)
      if (scrolling || dragShiftActive(timestamp)) dragState.scrollRafId = requestAnimationFrame(tick)
      else dragState.scrollRafId = null
    }
    dragState.scrollRafId = requestAnimationFrame(tick)
  }

  function ensureAutoScrollLoop() {
    if (!dragState?.dragging || dragState.scrollRafId != null) return
    const layout = deps.getLayout()
    const group = dragState.targetGroupId ? layout?.groups.find((g) => g.id === dragState.targetGroupId) : null
    if (!shouldAutoScroll(group) && !dragShiftActive()) return
    startAutoScrollLoop()
  }

  function edgePanActive() {
    if (!dragState?.dragging || !dragState.lastScreenPoint) return false
    const { width, height } = deps.getCssSize()
    const velocity = edgePanVelocity(dragState.lastScreenPoint, width, height)
    return velocity.x !== 0 || velocity.y !== 0
  }

  function cancelEdgePanLoop() {
    if (dragState && dragState.edgePanRafId !== null) {
      cancelAnimationFrame(dragState.edgePanRafId)
      dragState.edgePanRafId = null
    }
  }

  function ensureEdgePanLoop() {
    if (!dragState?.dragging || dragState.edgePanRafId != null || !edgePanActive()) return
    const tick = () => {
      if (!dragState?.dragging) return
      const { width, height } = deps.getCssSize()
      const velocity = edgePanVelocity(dragState.lastScreenPoint, width, height)
      if (velocity.x !== 0 || velocity.y !== 0) {
        deps.applyViewport(panViewportBy(deps.getViewport(), { x: -velocity.x, y: -velocity.y }, viewportOptions(deps.getOptions())))
        updateDragTarget(screenToWorld(dragState.lastScreenPoint, deps.getViewport()))
        deps.renderCurrent()
      }
      if (edgePanActive()) dragState.edgePanRafId = requestAnimationFrame(tick)
      else dragState.edgePanRafId = null
    }
    dragState.edgePanRafId = requestAnimationFrame(tick)
  }

  function cancelDrag() {
    if (!dragState) return
    cancelAutoScrollLoop()
    cancelDragShiftLoop()
    cancelEdgePanLoop()
    dragState = null
    deps.renderCurrent()
  }

  function cancelScrollbarDrag() {
    if (!scrollbarDragState) return
    const group = deps.getLayout()?.groups.find((g) => g.id === scrollbarDragState.groupId)
    if (group && deps.getGroupStatesProp() === null) group.scrollTop = scrollbarDragState.startScrollTop
    hoveredScrollbarGroupId = null
    scrollbarDragState = null
    if (deps.getGroupStatesProp() !== null) deps.updateLayout({ animate: false, preserveAnchor: false })
    else deps.renderCurrent()
  }

  function cancelPan() {
    panState = null
  }

  function cancelMarquee() {
    marqueeState = null
  }

  function cancelPointerInteractions() {
    deps.cancelScheduledRender()
    cancelDrag()
    cancelScrollbarDrag()
    cancelPan()
    cancelMarquee()
  }

  function updateScrollbarHover(groupId) {
    if (hoveredScrollbarGroupId === groupId) return
    hoveredScrollbarGroupId = groupId
    deps.renderCurrent()
  }

  function clearScrollbarHover() {
    updateScrollbarHover(null)
  }

  function handlePointerDown(event) {
    deps.closeContextMenu()
    const layout = deps.getLayout()
    if (!layout) return
    if (event.button !== 0) return
    deps.getCanvasEl()?.focus?.()
    const point = deps.pointFromClient(event.clientX, event.clientY)
    const scrollbarHit = hitScrollbarThumb(layout, point)
    if (scrollbarHit) {
      deps.getCanvasEl()?.setPointerCapture?.(event.pointerId)
      updateScrollbarHover(scrollbarHit.group.id)
      scrollbarDragState = {
        groupId: scrollbarHit.group.id,
        startScreenY: event.clientY,
        startScrollTop: scrollbarHit.group.scrollTop,
        metrics: scrollbarHit.metrics,
      }
      return
    }

    const hit = hitTest(layout, point)

    if (hit?.type === 'group' && hit.zone === 'header') {
      const group = deps.getLayout().groups.find((g) => g.id === hit.id)
      deps.setGroupExpanded(hit.id, !group.expanded)
      return
    }

    if ((hit?.type === 'group' && hit.zone === 'item') || hit?.type === 'node') {
      const nodeId = hit.type === 'group' ? hit.childId : hit.id
      const node = deps.getGraph().nodes.get(nodeId)
      if (!node) return
      deps.getCanvasEl()?.setPointerCapture?.(event.pointerId)
      dragState = {
        nodeId,
        fromParentId: node.parentId,
        additive: isAdditiveSelection(event),
        startScreen: deps.screenPointFromClient(event.clientX, event.clientY),
        dragging: false,
        targetParentId: null,
        targetGroupId: null,
        insertIndex: 0,
        attachPreviewRect: null,
        attachPreviewParentRect: null,
        ghostWorldPoint: null,
        ghostScreenRect: null,
        lastScreenPoint: null,
        scrollRafId: null,
        edgePanRafId: null,
        shiftFromById: null,
        shiftToById: null,
        shiftStartedAt: null,
        slotFadeStartedAt: null,
        shiftRafId: null,
      }
      return
    }

    if (!hit) {
      deps.settleAnimation()
      deps.getCanvasEl()?.setPointerCapture?.(event.pointerId)
      if (event.metaKey || event.ctrlKey) {
        const startScreen = deps.screenPointFromClient(event.clientX, event.clientY)
        marqueeState = {
          pointerId: event.pointerId,
          startScreen,
          rect: { x: startScreen.x, y: startScreen.y, width: 0, height: 0 },
          active: false,
        }
        deps.renderCurrent()
        return
      }
      deps.setSelected([])
      panState = {
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startViewport: deps.getViewport(),
        moved: false,
      }
      return
    }

    deps.setSelected(applySelectionClick(deps.getSelectedIds(), hit.id, { additive: isAdditiveSelection(event) }))
  }

  function handlePointerMove(event) {
    if (scrollbarDragState) {
      const group = deps.getLayout().groups.find((g) => g.id === scrollbarDragState.groupId)
      if (!group) return
      const deltaScreenY = event.clientY - scrollbarDragState.startScreenY
      const viewport = deps.getViewport()
      const scrollDelta = (deltaScreenY / (scrollbarDragState.metrics.maxThumbOffset * viewport.scale)) * scrollbarDragState.metrics.maxScroll
      const rawScrollTop = scrollbarDragState.startScrollTop + scrollDelta
      const nextScrollTop = clampGroupScroll(group, rawScrollTop)
      group.scrollTop = nextScrollTop
      deps.renderCurrent()
      return
    }

    if (marqueeState) {
      const screenPoint = deps.screenPointFromClient(event.clientX, event.clientY)
      marqueeState.rect = {
        x: marqueeState.startScreen.x,
        y: marqueeState.startScreen.y,
        width: screenPoint.x - marqueeState.startScreen.x,
        height: screenPoint.y - marqueeState.startScreen.y,
      }
      marqueeState.active = true
      deps.scheduleRender('marquee')
      return
    }

    if (panState) {
      const delta = {
        x: event.clientX - panState.startScreen.x,
        y: event.clientY - panState.startScreen.y,
      }
      panState.moved = panState.moved || delta.x !== 0 || delta.y !== 0
      deps.applyViewport(panViewportBy(panState.startViewport, delta, viewportOptions(deps.getOptions())), { render: false })
      deps.scheduleRender('pan')
      return
    }

    if (!dragState) {
      const scrollbarHit = hitScrollbarThumb(deps.getLayout(), deps.pointFromClient(event.clientX, event.clientY))
      updateScrollbarHover(scrollbarHit?.group.id ?? null)
      return
    }
    const screenPoint = deps.screenPointFromClient(event.clientX, event.clientY)
    const worldPoint = deps.pointFromClient(event.clientX, event.clientY)
    dragState.lastScreenPoint = screenPoint

    if (!dragState.dragging) {
      if (!exceedsDragThreshold(dragState.startScreen, screenPoint)) return
      dragState.dragging = true
      dragState.slotFadeStartedAt = now()
      ensureAutoScrollLoop()
    }

    updateDragTarget(worldPoint)
    deps.renderCurrent()
    ensureAutoScrollLoop()
    ensureEdgePanLoop()
    if (dragShiftActive()) ensureDragShiftLoop()
  }

  function handlePointerUp() {
    if (marqueeState) {
      deps.flushScheduledRender()
      const ids = marqueeState.active ? idsInSelectionRect(deps.getLayout(), marqueeState.rect, deps.getViewport()) : []
      marqueeState = null
      deps.setSelected(ids)
      return
    }

    if (panState) {
      deps.flushScheduledRender()
      panState = null
      deps.renderCurrent()
      return
    }

    if (scrollbarDragState) {
      deps.flushScheduledRender()
      const group = deps.getLayout().groups.find((g) => g.id === scrollbarDragState.groupId)
      if (group) deps.scrollGroup(group, group.scrollTop)
      scrollbarDragState = null
      return
    }

    if (!dragState) return

    if (dragState.dragging) {
      deps.flushScheduledRender()
      cancelAutoScrollLoop()
      cancelDragShiftLoop()
      cancelEdgePanLoop()
      const layout = deps.getLayout()
      let renderAfterDrag = false
      let updateLayoutAfterDrag = false
      let groupScrollPatch = null
      let groupReorderPayload = null
      let nodeMovePayload = null
      let changeResult = null

      if (dragState.targetParentId) {
        const parent = deps.getGraph().nodes.get(dragState.targetParentId)
        const targetGroup = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
        const index = targetGroup
          ? groupInsertIndexToParentIndex(parent, targetGroup, dragState.nodeId, dragState.insertIndex)
          : dragState.targetParentId === dragState.fromParentId
            ? dragState.insertIndex ?? parent.children.length
            : parent.children.length

        if (dragState.targetParentId === dragState.fromParentId) {
          const operation = {
            type: 'reorder-group-child',
            payload: {
              groupId: dragState.targetGroupId,
              parentId: dragState.targetParentId,
              childId: dragState.nodeId,
              index,
            },
          }
          const result = deps.applyOperation(operation, { before: deps.getBeforeGroupReorder() })
          if (result.applied) {
            if (targetGroup) groupScrollPatch = { groupId: targetGroup.id, scrollTop: targetGroup.scrollTop }
            updateLayoutAfterDrag = true
            groupReorderPayload = {
              groupId: dragState.targetGroupId,
              childId: dragState.nodeId,
              index: result.operation.payload.index,
            }
            changeResult = result
          } else {
            renderAfterDrag = true
          }
        } else {
          const operation = {
            type: 'move-node',
            payload: { nodeId: dragState.nodeId, toParentId: dragState.targetParentId, index },
          }
          const result = deps.applyOperation(operation, { before: deps.getBeforeNodeMove() })
          if (result.applied) {
            updateLayoutAfterDrag = true
            nodeMovePayload = {
              nodeId: dragState.nodeId,
              fromParentId: dragState.fromParentId,
              toParentId: dragState.targetParentId,
              index: result.operation.payload.index,
            }
            changeResult = result
          } else {
            renderAfterDrag = true
          }
        }
      } else {
        renderAfterDrag = true
      }

      dragState = null
      if (groupScrollPatch) {
        const group = layout.groups.find((g) => g.id === groupScrollPatch.groupId)
        if (group) deps.scrollGroup(group, groupScrollPatch.scrollTop)
      }
      if (updateLayoutAfterDrag) deps.updateLayout()
      if (groupReorderPayload) deps.emitGroupReorder(groupReorderPayload)
      if (nodeMovePayload) deps.emitNodeMove(nodeMovePayload)
      if (changeResult) deps.emitChangeIfApplied(changeResult)
      if (renderAfterDrag) deps.renderCurrent()
      return
    } else {
      deps.setSelected(applySelectionClick(deps.getSelectedIds(), dragState.nodeId, { additive: dragState.additive }))
    }

    dragState = null
  }

  function handleWheel(event) {
    deps.closeContextMenu()
    const layout = deps.getLayout()
    if (!layout) return
    if (dragState || scrollbarDragState || panState) return
    const point = deps.pointFromClient(event.clientX, event.clientY)
    const hit = hitTest(layout, point)
    if (hit?.type === 'group') {
      const group = deps.getLayout().groups.find((g) => g.id === hit.id)
      if (group?.overflowY) {
        event.preventDefault()
        deps.scrollGroup(group, group.scrollTop + event.deltaY)
        return
      }
    }

    event.preventDefault()
    deps.settleAnimation()
    const screenPoint = deps.screenPointFromClient(event.clientX, event.clientY)
    deps.zoomAt(screenPoint, event.deltaY)
  }

  function handleDragOver(event) {
    event.preventDefault()
  }

  function resolveResourceDropTarget(point) {
    const layout = deps.getLayout()
    const hit = hitTest(layout, point)
    if (hit?.type === 'node') {
      const parent = deps.getGraph().nodes.get(hit.id)
      if (parent) return { parentId: hit.id, index: parent.children.length }
    }

    if (hit?.type === 'group' && hit.zone === 'item') {
      const parent = deps.getGraph().nodes.get(hit.childId)
      if (parent) return { parentId: hit.childId, index: parent.children.length }
    }

    const selected = deps.getSelectedIds()
    const parentId = selected[0] ?? deps.getGraph().rootIds[0]
    const parent = deps.getGraph().nodes.get(parentId)
    if (!parent) return null
    return {
      parentId,
      index: findInsertionIndex(deps.getGraph(), layout, parentId, point, deps.getLayoutDirection()),
    }
  }

  function handleDrop(event) {
    event.preventDefault()
    deps.settleAnimation()
    if (!deps.getLayout()) return
    const raw = event.dataTransfer.getData('application/json')
    if (!raw) return
    const resource = JSON.parse(raw)

    const point = deps.pointFromClient(event.clientX, event.clientY)
    const target = resolveResourceDropTarget(point)
    if (!target) return
    const { parentId, index } = target
    const id = `res-${resource.id}-${Date.now()}`
    const operation = {
      type: 'drop-node',
      payload: { resource, parentId, index, id },
    }
    const result = deps.applyOperation(operation, { before: deps.getBeforeNodeDrop() })
    if (!result.applied) return

    deps.updateLayout()
    deps.emitNodeDrop({ resource, parentId, index: result.operation.payload.index })
    deps.emitChangeIfApplied(result)
  }

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerLeave: clearScrollbarHover,
    onPointerCancel: cancelPointerInteractions,
    onLostPointerCapture: cancelPointerInteractions,
    onWheel: handleWheel,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    cancelPointerInteractions,
    getInteractionRenderState,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-drag-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/drag-controller.js test/minimap-drag-controller.test.js
git commit -m "feat: add drag-controller"
```

---

## Task 5: 把 `drag-controller` 接进根 `minimap-controller.js`

**Files:**
- Modify: `src/minimap/minimap-controller.js`
- Modify: `test/minimap-root-controller.test.js`

**Interfaces:**
- Consumes：Task 4 的 `createDragController`。
- Produces（追加到根 controller 现有返回对象上）：`cancelPointerInteractions`。`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo` 这三个方法名已经存在（之前直接转发 `core.xxx`），本任务改成根 controller 自己的组合函数（先 `drag.cancelPointerInteractions()` 再调 `core.xxx()`），方法名和参数形状不变。
- `createMinimapController(deps)` 的 `deps` 形状变化（相对切片 2 结束时的样子）：
  - 删除：`getInteractionRenderState`（现在永久改接 `() => drag.getInteractionRenderState()`，Vue 不用再传）、`cancelPointerInteractions`（现在永久改接 `() => drag.cancelPointerInteractions()`）、`centerOnNode`/`fitToScreen`/`centerOnSelection`（现在是根 controller 自己的组合函数，不再需要 Vue 传一份同名包装）、`onPointerDown`/`onPointerMove`/`onPointerUp`/`onPointerLeave`/`onPointerCancel`/`onLostPointerCapture`/`onKeyDown`/`onWheel`/`onDragOver`/`onDrop`（这 10 个全部不再经过 `deps` 转发，`mount()` 直接绑到 `drag`/`handleKeyDown` 的方法上）。
  - 新增：`getBeforeNodeDrop`、`getBeforeGroupReorder`、`getBeforeNodeMove`（`() => props.beforeXxx`）、`emitNodeDrop`、`emitGroupReorder`、`emitNodeMove`（`(payload) => emit('xxx', payload)`）。

- [ ] **Step 1: 写失败测试**

Replace `test/minimap-root-controller.test.js` in full:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'
import { createMinimapController } from '../src/minimap/minimap-controller.js'
import { defaultTheme } from '../src/minimap/theme.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()
stubAnimationFrame()

const LAYOUT_OPTS = { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 }

function createElements() {
  const canvas = document.createElement('canvas')
  const container = document.createElement('div')
  container.appendChild(canvas)
  return { canvas, container }
}

function nodeCenter(layout, nodeId) {
  const rect = layout.nodes.get(nodeId)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function createDeps(overrides = {}) {
  // 缓存单个 graph 实例并始终返回同一个引用——跟真实 Vue 用法里 props.graph 是同一个稳定
  // 引用的语义一致。
  const graph = createDemoGraph()
  return {
    getGraph: () => graph,
    getLayoutDirection: () => 'horizontal',
    getOptions: () => ({}),
    getTheme: () => defaultTheme,
    getRenderers: () => ({}),
    getViewportProp: () => null,
    getGroupStatesProp: () => null,
    getSelectedIdsProp: () => null,
    emitSelect: () => {},
    getReadonly: () => false,
    getBeforeDelete: () => null,
    getBeforeCopy: () => null,
    getBeforeImport: () => null,
    getBeforePaste: () => null,
    getBeforeNodeDrop: () => null,
    getBeforeGroupReorder: () => null,
    getBeforeNodeMove: () => null,
    emitDelete: () => {},
    emitCopy: () => {},
    emitPaste: () => {},
    emitImport: () => {},
    emitExport: () => {},
    emitChange: () => {},
    emitNodeDrop: () => {},
    emitGroupReorder: () => {},
    emitNodeMove: () => {},
    emitSearch: () => {},
    onSearchStateChange: () => {},
    emitConfigChange: () => {},
    emitContextMenuAction: () => {},
    getContextMenuItemsProp: () => null,
    getMenuEl: () => null,
    onMenuStateChange: () => {},
    emitViewportChange: () => {},
    emitGroupStateChange: () => {},
    onRenderStats: () => {},
    onOverviewRender: () => {},
    ...overrides,
  }
}

test('camera and layout methods forward to the underlying core-controller', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  assert.deepEqual(controller.getViewport(), { x: 0, y: 0, scale: 1 })
  assert.ok(controller.getLayout())
  controller.applyViewport({ x: 1, y: 1, scale: 1 }, { render: false })
  assert.deepEqual(controller.getViewport(), { x: 1, y: 1, scale: 1 })

  controller.destroy()
})

test('selection methods forward to the real selection-controller and core renders use it', () => {
  const selected = []
  const controller = createMinimapController(createDeps({ emitSelect: (ids) => selected.push(ids) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  controller.setSelected(['feeder-1'])

  assert.deepEqual(controller.getSelectedIds(), ['feeder-1'])
  assert.deepEqual(selected, [['feeder-1']])

  controller.destroy()
})

test('edit methods forward to the real edit-controller sharing the same selection-controller', () => {
  const deleted = []
  const controller = createMinimapController(createDeps({ emitDelete: (p) => deleted.push(p) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.setSelected(['feeder-1'])

  const result = controller.deleteSelection()

  assert.equal(result.applied, true)
  assert.equal(deleted.length, 1)
  assert.equal(controller.canUndo(), true)

  controller.undo()
  assert.equal(controller.canUndo(), false)

  controller.destroy()
})

test('onGraphReplaced resets the edit-controller history', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.setSelected(['feeder-1'])
  controller.deleteSelection()
  assert.equal(controller.canUndo(), true)

  controller.onGraphReplaced()

  assert.equal(controller.canUndo(), false)

  controller.destroy()
})

test('applyOperation forwards to the real edit-controller, sharing its undo history with the named edit methods', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const result = controller.applyOperation({
    type: 'reorder-group-child',
    payload: { groupId: null, parentId: 'grid-tie', childId: 'feeder-1', index: 1 },
  })

  assert.equal(result.applied, true)
  assert.equal(controller.canUndo(), true)
  controller.undo()
  assert.equal(controller.canUndo(), false)

  controller.destroy()
})

test('search methods forward to the real search-controller and jump using the real camera composition', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const payload = controller.search('feeder')

  assert.deepEqual(payload.matches, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.deepEqual(controller.getSelectedIds(), ['feeder-1'])

  controller.destroy()
})

test('the canvas contextmenu DOM event dispatches directly to the context-menu-controller, not through deps', () => {
  const menuStates = []
  const controller = createMinimapController(createDeps({ onMenuStateChange: (state) => menuStates.push(state) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: -500, clientY: -500 })
  canvas.dispatchEvent(event)

  assert.ok(menuStates.at(-1))
  assert.equal(menuStates.at(-1).context.targetType, 'canvas')

  controller.runContextMenuItem({ id: 'fit-to-screen', action: 'fit-to-screen', disabled: false })
  assert.equal(menuStates.at(-1), null)

  controller.destroy()
})

test('pointerdown and pointerup without moving dispatch to the real drag-controller and select the clicked node', () => {
  const deps = createDeps()
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const point = nodeCenter(layout, 'feeder-1')

  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true, cancelable: true }))

  assert.deepEqual(controller.getSelectedIds(), ['feeder-1'])

  controller.destroy()
})

test('pointerdown, pointermove, and pointerup dispatch to the real drag-controller and commit a cross-parent move', () => {
  const calls = { nodeMove: [] }
  const deps = createDeps({ emitNodeMove: (payload) => calls.nodeMove.push(payload) })
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: from.x, clientY: from.y, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: to.x, clientY: to.y, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: to.x, clientY: to.y, pointerId: 1, bubbles: true, cancelable: true }))

  assert.equal(deps.getGraph().nodes.get('feeder-1').parentId, 'cluster-25')
  assert.equal(calls.nodeMove.length, 1)
  assert.equal(calls.nodeMove[0].toParentId, 'cluster-25')

  controller.destroy()
})

test('keydown Escape dispatches to the real keydown handler and clears the selection', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.setSelected(['feeder-1'])

  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

  assert.deepEqual(controller.getSelectedIds(), [])

  controller.destroy()
})

test('wheel over blank canvas dispatches to the real drag-controller and zooms the viewport', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const before = controller.getViewport().scale

  const event = new WheelEvent('wheel', { clientX: 780, clientY: 580, deltaY: -100, bubbles: true, cancelable: true })
  canvas.dispatchEvent(event)

  assert.notEqual(controller.getViewport().scale, before)

  controller.destroy()
})

test('dragover prevents the default and drop dispatches to the real drag-controller, committing a dropped resource', () => {
  const calls = { nodeDrop: [] }
  const deps = createDeps({ emitNodeDrop: (payload) => calls.nodeDrop.push(payload) })
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const point = nodeCenter(layout, 'grid-tie')

  const overEvent = new Event('dragover', { bubbles: true, cancelable: true })
  canvas.dispatchEvent(overEvent)
  assert.equal(overEvent.defaultPrevented, true)

  const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(dropEvent, 'dataTransfer', { value: { getData: () => JSON.stringify({ id: 'sensor', label: 'Sensor' }) } })
  Object.defineProperty(dropEvent, 'clientX', { value: point.x, configurable: true })
  Object.defineProperty(dropEvent, 'clientY', { value: point.y, configurable: true })
  canvas.dispatchEvent(dropEvent)

  assert.equal(calls.nodeDrop.length, 1)
  assert.equal(calls.nodeDrop[0].parentId, 'grid-tie')

  controller.destroy()
})

test('cancelPointerInteractions is forwarded to the real drag-controller and clears an in-progress pan', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 780, clientY: 580, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 760, clientY: 560, pointerId: 1, bubbles: true, cancelable: true }))

  controller.cancelPointerInteractions()
  const before = controller.getViewport()
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 760, clientY: 560, pointerId: 1, bubbles: true, cancelable: true }))

  assert.deepEqual(controller.getViewport(), before) // pointerup after cancel does not flush/commit the pan

  controller.destroy()
})

test('fitToScreen cancels an in-progress node drag before recentering the viewport', () => {
  const deps = createDeps()
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const point = nodeCenter(layout, 'feeder-1')
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: point.x + 200, clientY: point.y + 200, pointerId: 1, bubbles: true, cancelable: true }))

  controller.fitToScreen()
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: point.x + 200, clientY: point.y + 200, pointerId: 1, bubbles: true, cancelable: true }))

  // the drag was cancelled by fitToScreen, so the pointerup above is a no-op: feeder-1 stays put
  assert.equal(deps.getGraph().nodes.get('grid-tie').children.includes('feeder-1'), true)

  controller.destroy()
})

test('destroy removes every canvas DOM listener', () => {
  const deps = createDeps()
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.destroy()

  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const point = nodeCenter(layout, 'feeder-1')
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true, cancelable: true }))

  assert.deepEqual(controller.getSelectedIds(), [])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-root-controller.test.js`
Expected: 大量失败——`drag-controller` 还没接进 `minimap-controller.js`，`mount()` 仍然依赖已经删除的 `deps.onPointerDown` 等字段，新测试里真实的指针/键盘/滚轮/拖放事件不会有任何效果。

- [ ] **Step 3: 实现**

Replace `src/minimap/minimap-controller.js` in full:

```js
import { createCoreController } from './core-controller.js'
import { createSelectionController } from './selection-controller.js'
import { createEditController } from './edit-controller.js'
import { createSearchController } from './search-controller.js'
import { createContextMenuController } from './context-menu-controller.js'
import { createDragController } from './drag-controller.js'

export function createMinimapController(deps) {
  // selection 的 renderCurrent 依赖通过闭包延迟引用 core，core 的 getInteractionRenderState
  // 依赖通过闭包延迟引用 drag——两者都只在真正被调用时才访问，那一定发生在
  // createMinimapController() 整个跑完、core/drag 都已经赋值之后，所以这里直接引用
  // 下面才声明的变量是安全的，不会触发 TDZ 报错。
  const selection = createSelectionController({
    getSelectedIdsProp: deps.getSelectedIdsProp,
    emitSelect: deps.emitSelect,
    renderCurrent: () => core.renderCurrent(),
  })

  const core = createCoreController({
    ...deps,
    getSelectedIds: selection.getSelectedIds,
    getInteractionRenderState: () => drag.getInteractionRenderState(),
  })

  const edit = createEditController({
    getGraph: deps.getGraph,
    getLayout: core.getLayout,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    getReadonly: deps.getReadonly,
    updateLayout: core.updateLayout,
    getBeforeDelete: deps.getBeforeDelete,
    getBeforeCopy: deps.getBeforeCopy,
    getBeforeImport: deps.getBeforeImport,
    getBeforePaste: deps.getBeforePaste,
    emitDelete: deps.emitDelete,
    emitCopy: deps.emitCopy,
    emitPaste: deps.emitPaste,
    emitImport: deps.emitImport,
    emitExport: deps.emitExport,
    emitChange: deps.emitChange,
  })

  let canvasEl = null

  // 永久取代 Vue 本地"先 cancelPointerInteractions 再转发"的相机包装函数（切片 1/2 的
  // 临时跨切片依赖到这里收尾）。函数体只在被调用时才访问 drag/core，声明顺序不受限。
  function fitToScreen() {
    drag.cancelPointerInteractions()
    core.fitToScreen()
  }

  function centerOnNode(id) {
    drag.cancelPointerInteractions()
    core.centerOnNode(id)
  }

  function centerOnSelection() {
    drag.cancelPointerInteractions()
    core.centerOnSelection()
  }

  function zoomTo(scale, center) {
    drag.cancelPointerInteractions()
    core.zoomTo(scale, center)
  }

  // 根 controller 自己持有 selection/edit/contextMenu 的真实引用，不需要经过 deps 间接转发，
  // 也不需要 Vue 再传 handleKeyDown 本身——这段纯派发逻辑跟"拖拽"无关，留在根 controller。
  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      if (contextMenu.isOpen()) {
        event.preventDefault()
        contextMenu.close()
        return
      }
      if (selection.getSelectedIds().length === 0) return
      event.preventDefault()
      selection.setSelected([])
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      edit.deleteSelection()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      edit.copySelection()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      edit.paste()
    }
  }

  const contextMenu = createContextMenuController({
    getGraph: deps.getGraph,
    getLayout: core.getLayout,
    screenPointFromClient: core.screenPointFromClient,
    pointFromClient: core.pointFromClient,
    getCssSize: core.getCssSize,
    setGroupExpanded: core.setGroupExpanded,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    getReadonly: deps.getReadonly,
    getOptions: deps.getOptions,
    canUndo: edit.canUndo,
    canRedo: edit.canRedo,
    copySelection: edit.copySelection,
    deleteSelection: edit.deleteSelection,
    pasteInto: edit.pasteInto,
    paste: edit.paste,
    fitToScreen,
    centerOnSelection,
    centerOnNode,
    cancelPointerInteractions: () => drag.cancelPointerInteractions(),
    emitConfigChange: deps.emitConfigChange,
    emitContextMenuAction: deps.emitContextMenuAction,
    getContextMenuItemsProp: deps.getContextMenuItemsProp,
    getCanvasEl: () => canvasEl,
    getMenuEl: deps.getMenuEl,
    onMenuStateChange: deps.onMenuStateChange,
  })

  const drag = createDragController({
    getGraph: deps.getGraph,
    getLayoutDirection: deps.getLayoutDirection,
    getOptions: deps.getOptions,
    getGroupStatesProp: deps.getGroupStatesProp,
    getBeforeNodeDrop: deps.getBeforeNodeDrop,
    getBeforeGroupReorder: deps.getBeforeGroupReorder,
    getBeforeNodeMove: deps.getBeforeNodeMove,
    getLayout: core.getLayout,
    getViewport: core.getViewport,
    applyViewport: core.applyViewport,
    updateLayout: core.updateLayout,
    getCssSize: core.getCssSize,
    screenPointFromClient: core.screenPointFromClient,
    pointFromClient: core.pointFromClient,
    renderCurrent: core.renderCurrent,
    scheduleRender: core.scheduleRender,
    flushScheduledRender: core.flushScheduledRender,
    cancelScheduledRender: core.cancelScheduledRender,
    settleAnimation: core.settleAnimation,
    scrollGroup: core.scrollGroup,
    setGroupExpanded: core.setGroupExpanded,
    zoomAt: core.zoomAt,
    getCanvasEl: () => canvasEl,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    applyOperation: edit.applyOperation,
    emitChangeIfApplied: edit.emitChangeIfApplied,
    closeContextMenu: contextMenu.close,
    emitNodeDrop: deps.emitNodeDrop,
    emitGroupReorder: deps.emitGroupReorder,
    emitNodeMove: deps.emitNodeMove,
  })

  const search = createSearchController({
    getGraph: deps.getGraph,
    centerOnNode,
    select: selection.select,
    emitSearch: deps.emitSearch,
    onSearchStateChange: deps.onSearchStateChange,
  })

  const listeners = []

  function addListener(eventName, handler, options) {
    listeners.push({ eventName, handler, options })
  }

  const DIRECT_EVENT_BINDINGS = [
    ['pointerdown', () => drag.onPointerDown],
    ['pointermove', () => drag.onPointerMove],
    ['pointerup', () => drag.onPointerUp],
    ['pointerleave', () => drag.onPointerLeave],
    ['pointercancel', () => drag.onPointerCancel],
    ['lostpointercapture', () => drag.onLostPointerCapture],
    ['dragover', () => drag.onDragOver],
    ['drop', () => drag.onDrop],
    ['keydown', () => handleKeyDown],
    ['contextmenu', () => contextMenu.open],
  ]

  function mount(canvas, container) {
    canvasEl = canvas
    core.mount(canvas, container)
    if (!canvasEl) return

    for (const [eventName, getHandler] of DIRECT_EVENT_BINDINGS) {
      const handler = getHandler()
      addListener(eventName, handler)
      canvasEl.addEventListener(eventName, handler)
    }
    addListener('wheel', drag.onWheel, { passive: false })
    canvasEl.addEventListener('wheel', drag.onWheel, { passive: false })
  }

  function destroy() {
    if (canvasEl) {
      for (const { eventName, handler, options } of listeners) {
        canvasEl.removeEventListener(eventName, handler, options)
      }
    }
    listeners.length = 0
    canvasEl = null
    core.destroy()
  }

  return {
    mount,
    destroy,
    getCssSize: core.getCssSize,
    screenPointFromClient: core.screenPointFromClient,
    pointFromClient: core.pointFromClient,
    getLayout: core.getLayout,
    updateLayout: core.updateLayout,
    scrollGroup: core.scrollGroup,
    setGroupExpanded: core.setGroupExpanded,
    resolveTargetRect: core.resolveTargetRect,
    resolveCenterTarget: core.resolveCenterTarget,
    getViewport: core.getViewport,
    applyViewport: core.applyViewport,
    zoomAt: core.zoomAt,
    panBy: core.panBy,
    fitToScreen,
    centerOnNode,
    centerOnSelection,
    zoomTo,
    setViewport: core.setViewport,
    cancelViewportTween: core.cancelViewportTween,
    settleAnimation: core.settleAnimation,
    cancelAnimation: core.cancelAnimation,
    renderCurrent: core.renderCurrent,
    scheduleRender: core.scheduleRender,
    flushScheduledRender: core.flushScheduledRender,
    cancelScheduledRender: core.cancelScheduledRender,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    select: selection.select,
    clearSelection: selection.clearSelection,
    undo: edit.undo,
    redo: edit.redo,
    canUndo: edit.canUndo,
    canRedo: edit.canRedo,
    deleteSelection: edit.deleteSelection,
    copySelection: edit.copySelection,
    paste: edit.paste,
    exportGraph: edit.exportGraph,
    importGraph: edit.importGraph,
    onGraphReplaced: edit.onGraphReplaced,
    applyOperation: edit.applyOperation,
    search: search.search,
    searchNext: search.searchNext,
    searchPrevious: search.searchPrevious,
    closeContextMenu: contextMenu.close,
    runContextMenuItem: contextMenu.runItem,
    cancelPointerInteractions: () => drag.cancelPointerInteractions(),
  }
}
```

> `DIRECT_EVENT_BINDINGS` 里每一项用 `() => drag.onPointerDown` 这种 getter 形式而不是直接 `drag.onPointerDown`，是因为这个数组字面量在 `mount()` 函数体内逐次求值时 `drag`（`const`）已经赋值完毕——其实这里不需要延迟闭包也是安全的（`mount()` 只在 `createMinimapController()` 整个跑完之后才会被调用），用 getter 只是跟 `core.getLayout` 等直接引用的写法保持一致的可读性选择，不是必须。`contextmenu` 绑定 `() => contextMenu.open` 同理——直接传函数引用即可，事件触发时 `contextMenu.open(event)` 不依赖 `this`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-root-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/minimap-controller.js test/minimap-root-controller.test.js
git commit -m "feat: wire drag-controller into the root controller"
```

---

## Task 6: `Minimap.vue` 接入 `drag-controller`，删除全部已迁出的本地实现

**Files:**
- Modify: `src/minimap/Minimap.vue`

**Interfaces:**
- Consumes：Task 5 的根 `createMinimapController`。
- 不新增测试文件，靠现有全部测试回归（同切片 1/2 的验证方式）。`Minimap.vue` 模板里没有任何 `@pointerdown` 等指针事件的模板绑定（这些事件是 `mount()` 用 `addEventListener` 命令式挂载的），所以本任务不需要改模板里的事件绑定，只改 `<script setup>`。

- [ ] **Step 1: 确认基线——现有全部测试先跑一遍**

Run: `npm test`
Expected: 全部通过（记录当前测试数量，Task 结束后再跑一遍对比）。

- [ ] **Step 2: 精简 import**

删除：

```js
import { GROUP, clampGroupScroll } from './layout.js'
import { worldRectToScreen } from './renderer.js'
import { screenToWorld } from './coords.js'
```

`viewport.js` 的 import 从：

```js
import { centerViewportOn, panViewportBy, viewportOptions, zoomViewportAt } from './viewport.js'
```

改成（`panViewportBy`/`viewportOptions`/`zoomViewportAt` 全部迁进 `drag-controller.js`，`centerViewportOn` 还留着——`handleOverviewNavigate` 要用，不属于本切片范围）：

```js
import { centerViewportOn } from './viewport.js'
```

删除：

```js
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
  resolveDropTarget,
  edgePanVelocity,
} from './interaction.js'
```

删除：

```js
import {
  buildVirtualOrder,
  childWorldRectsById,
  currentShiftRects,
  dragShiftEasedProgress,
  dragShiftProgress,
} from './drag-transition.js'
```

删除：

```js
import { applySelectionClick, idsInSelectionRect, normalizeRect } from './selection.js'
```

（这三个函数迁移前还留在 `Minimap.vue` 是因为拖拽点击分支/框选释放/`interactionRenderState` 要用——切片 3 把这些调用点全部迁进 `drag-controller.js` 之后，`Minimap.vue` 没有别的地方再用它们。）

- [ ] **Step 3: 删除已迁出的本地常量、状态和函数**

删除常量：`DRAG_SHIFT_DURATION_MS`、`SCROLLBAR_WIDTH`。

删除状态声明：`dragState`、`scrollbarDragState`、`panState`、`marqueeState`、`hoveredScrollbarGroupId`。

保留状态声明：`contextMenuState`（模板还要绑定）以及其余跟拖拽无关的 ref/computed（`containerRef`/`canvasRef`/`overviewRef`/`searchKeyword`/`searchMatches`/`searchCurrentIndex`/`contextMenuRef`/`renderStats`/`internalReadonly`/`internalOptions`/`effectiveReadonly`/`effectiveOptions`/`effectiveTheme`）。

删除整段函数：`now`、`clearDragShiftAnimation`、`shouldAutoScroll`、`interactionRenderState`、`dragShiftActive`、`cancelDragShiftLoop`、`ensureDragShiftLoop`、`withinGroupBody`、`updateDragTarget`、`scheduleDragShift`、`isAdditiveSelection`、`ghostRectForPoint`、`scrollbarMetrics`、`hitScrollbarThumb`、`cancelAutoScrollLoop`、`startAutoScrollLoop`、`ensureAutoScrollLoop`、`edgePanActive`、`cancelEdgePanLoop`、`ensureEdgePanLoop`、`cancelDrag`、`cancelScrollbarDrag`、`cancelPan`、`cancelMarquee`、`cancelPointerInteractions`、`updateScrollbarHover`、`clearScrollbarHover`、`handlePointerDown`、`handlePointerMove`、`handlePointerUp`、`handleWheel`、`handleKeyDown`、`handleDragOver`、`emitChange`、`resolveResourceDropTarget`、`handleDrop`、`fitToScreen`、`centerOnNode`、`centerOnSelection`、`zoomTo`。

> `emitChange` 本地函数本切片**终于可以删掉**了——切片 2 文档解释过它为什么暂留（拖拽换位/跨父级移动/资源拖入这几个当时还没迁移的调用点要自己 emit）。现在这些调用点全部迁进了 `drag-controller.js`，改用 `edit-controller` 暴露的 `emitChangeIfApplied`（Task 2），`Minimap.vue` 不再需要这个本地包装。

保留：`syncConfigFromProps`、`emitConfigChange`、`handleOverviewNavigate`（这三个跟拖拽无关，本切片不动）。

- [ ] **Step 4: 改写 `createInteractionController()` 的 deps**

删除这一行（核心渲染降级判断不再需要 Vue 本地闭包，根 controller 永久改接 `drag.getInteractionRenderState`）：

```js
    getInteractionRenderState: () => interactionRenderState(),
```

删除这三行（相机方法不再需要 Vue 本地"先 cancel 再转发"的包装，根 controller 自己组合）：

```js
    centerOnNode: (id) => centerOnNode(id),
    fitToScreen: () => fitToScreen(),
    centerOnSelection: () => centerOnSelection(),
```

删除这一行（`cancelPointerInteractions` 不再需要 Vue 本地实现）：

```js
    cancelPointerInteractions: () => cancelPointerInteractions(),
```

删除这十行（指针/键盘/滚轮/拖放事件不再经过 `deps` 转发，根 controller `mount()` 直接派发给 `drag`/`handleKeyDown`）：

```js
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerLeave: clearScrollbarHover,
    onPointerCancel: cancelPointerInteractions,
    onLostPointerCapture: cancelPointerInteractions,
    onKeyDown: handleKeyDown,
    onWheel: handleWheel,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
```

在 `emitGroupStateChange: (next) => emit('group-state-change', next),` 之后插入（新增 `drag-controller` 需要的 deps）：

```js
    getBeforeNodeDrop: () => props.beforeNodeDrop,
    getBeforeGroupReorder: () => props.beforeGroupReorder,
    getBeforeNodeMove: () => props.beforeNodeMove,
    emitNodeDrop: (payload) => emit('node-drop', payload),
    emitGroupReorder: (payload) => emit('group-reorder', payload),
    emitNodeMove: (payload) => emit('node-move', payload),
```

`createInteractionController()` 整体改完之后只剩：

```js
function createInteractionController() {
  return createMinimapController({
    getGraph: () => props.graph,
    getLayoutDirection: () => props.layoutDirection,
    getOptions: () => effectiveOptions.value,
    getTheme: () => effectiveTheme.value,
    getRenderers: () => ({ node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer }),
    getViewportProp: () => props.viewport,
    getGroupStatesProp: () => props.groupStates,
    getSelectedIdsProp: () => props.selectedIds,
    emitSelect: (ids) => emit('select', ids),
    getReadonly: () => effectiveReadonly.value,
    getBeforeDelete: () => props.beforeDelete,
    getBeforeCopy: () => props.beforeCopy,
    getBeforeImport: () => props.beforeImport,
    getBeforePaste: () => props.beforePaste,
    emitDelete: (payload) => emit('delete', payload),
    emitCopy: (payload) => emit('copy', payload),
    emitPaste: (payload) => emit('paste', payload),
    emitImport: (payload) => emit('import', payload),
    emitExport: (payload) => emit('export', payload),
    emitChange: (payload) => emit('change', payload),
    emitSearch: (payload) => emit('search', payload),
    onSearchStateChange: ({ keyword, matches, currentIndex }) => {
      searchKeyword.value = keyword
      searchMatches.value = matches
      searchCurrentIndex.value = currentIndex
    },
    emitConfigChange,
    emitContextMenuAction: (payload) => emit('context-menu-action', payload),
    getContextMenuItemsProp: () => props.contextMenuItems,
    getMenuEl: () => contextMenuRef.value,
    onMenuStateChange: (state) => { contextMenuState.value = state },
    emitViewportChange: (next) => emit('viewport-change', next),
    emitGroupStateChange: (next) => emit('group-state-change', next),
    getBeforeNodeDrop: () => props.beforeNodeDrop,
    getBeforeGroupReorder: () => props.beforeGroupReorder,
    getBeforeNodeMove: () => props.beforeNodeMove,
    emitNodeDrop: (payload) => emit('node-drop', payload),
    emitGroupReorder: (payload) => emit('group-reorder', payload),
    emitNodeMove: (payload) => emit('node-move', payload),
    onRenderStats: (stats) => { renderStats.value = stats },
    onOverviewRender: (scene) => overviewRef.value?.render(scene),
  })
}
```

- [ ] **Step 5: `defineExpose`**

```js
defineExpose({
  fitToScreen: () => controller.fitToScreen(),
  centerOnNode: (id) => controller.centerOnNode(id),
  centerOnSelection: () => controller.centerOnSelection(),
  zoomTo: (scale, center) => controller.zoomTo(scale, center),
  setViewport: (viewport) => controller.setViewport(viewport),
  getViewport: () => controller.getViewport(),
  select: (ids, mode) => controller.select(ids, mode),
  clearSelection: () => controller.clearSelection(),
  search: (keyword) => controller.search(keyword),
  searchNext: () => controller.searchNext(),
  searchPrevious: () => controller.searchPrevious(),
  undo: () => controller.undo(),
  redo: () => controller.redo(),
  canUndo: () => controller.canUndo(),
  canRedo: () => controller.canRedo(),
  deleteSelection: () => controller.deleteSelection(),
  copySelection: () => controller.copySelection(),
  paste: () => controller.paste(),
  exportGraph: () => controller.exportGraph(),
  importGraph: (data) => controller.importGraph(data),
})
```

（只有 `fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo` 这四行变了——从调用本地函数改成直接转发 `controller.xxx()`，其余不变。）

- [ ] **Step 6: `onUnmounted`**

```js
onUnmounted(() => {
  controller?.cancelPointerInteractions()
  controller?.closeContextMenu()
  controller?.destroy()
  controller = null
})
```

（原来第一行是本地的 `cancelPointerInteractions()`，现在改成 `controller?.cancelPointerInteractions()`——本地实现已经删掉，这个方法现在是根 controller 转发 `drag.cancelPointerInteractions`。）

- [ ] **Step 7: 运行完整测试套件**

Run: `npm test`
Expected: 全部通过，且测试总数跟 Step 1 记录的基线一致（这一切片在 `Minimap.vue` 之外新增了 `drag-controller` 的测试，但既有 Vue 集成测试数量不变）。

- [ ] **Step 8: 跑 build**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 9: Commit**

```bash
git add src/minimap/Minimap.vue
git commit -m "refactor: wire Minimap.vue to drag-controller, drop migrated pointer/keyboard handling"
```

---

## Task 7: 全量验证与 ROADMAP 收尾

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: 跑全量测试**

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 3: 手动验收（开发服务器）**

Run: `npm run dev`，在浏览器打开示例图，依次验证：

- 拖拽普通节点跨父级移动、分组内换位，行为跟切片前一致。
- 拖拽节点进分组框、靠近边缘自动滚动、靠近画布边缘自动平移视口，行为跟切片前一致。
- 拖动分组框滚动条，松手提交、半路取消（比如切换 layoutDirection）会回滚。
- 框选（Cmd/Ctrl + 拖拽空白）多选节点。
- 空白拖拽平移画布、滚轮缩放、悬停分组框时滚轮改成滚动列表。
- 资源树拖入新节点。
- 拖拽中途调用 `fitToScreen`/`centerOnNode`/`centerOnSelection`（比如拖拽时点搜索跳转）会先取消当前拖拽，不留下"鬼影"。
- 控制台无报错。

- [ ] **Step 4: 更新 `ROADMAP.md`**

把：

```md
  - [ ] 切片 3：drag-controller（节点拖拽/滚动条拖拽/框选/空白平移/自动滚动/边缘平移/拖拽让位动画/资源拖放提交）
```

改成：

```md
  - [x] 切片 3：drag-controller（节点拖拽/滚动条拖拽/框选/空白平移/自动滚动/边缘平移/拖拽让位动画/资源拖放提交；`scrollbarMetrics`/`hitScrollbarThumb` 移进 `interaction.js`；`edit-controller` 暴露 `emitChangeIfApplied`、`context-menu-controller` 新增 `isOpen()` 供 drag/根 controller 复用；根 controller 收尾两个跨切片临时依赖（`cancelPointerInteractions`、相机方法包装函数），新增 `handleKeyDown` 本地派发，`mount()` 的指针/键盘/滚轮/拖放事件全部直接派发给真实 controller，`Minimap.vue` 不再有任何指针事件处理代码；[design](docs/superpowers/specs/2026-06-21-controller-extraction-slice-3-design.md)，[plan](docs/superpowers/plans/2026-06-21-controller-extraction-slice-3.md)，`npm test` 全过，`npm run build` 通过）
```

把"当前阶段"那几行改成（Controller 抽取三个切片全部完成，下一步是第五阶段剩余切片还是性能优化后续切片，留给下次头脑风暴跟用户确认，不在这里预设）：

```md
- **当前阶段**：Controller 抽取已全部完成（切片 1/2/3）；下一步待定——第五阶段切片 5/6（组件状态/可访问性、性能状态/生命周期收尾）或性能优化后续切片（空间索引/静态层缓存/拖拽动态层合帧）二选一，下次开始前先跟用户确认
- **当前阶段 Spec**：待头脑风暴产出后补充
- **当前阶段计划**：待头脑风暴产出后补充
```

把"下一步"改成：

```md
- **下一步**：Controller 抽取三个切片全部完成，`Minimap.vue` 只剩 props/emits/模板绑定/生命周期挂载/prop watcher 转发；下次会话先跟用户确认走第五阶段切片 5/6 还是性能优化后续切片，再头脑风暴对应的 spec/plan。
```

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark controller extraction slice 3 done"
```

## Self-Review

- **Spec coverage**：spec 文档列的范围内事项（`scrollbarMetrics`/`hitScrollbarThumb` 迁入 `interaction.js`、`edit-controller` 暴露 `emitChangeIfApplied`、`context-menu-controller` 新增 `isOpen()`、`drag-controller` 本体、根 controller 的组装顺序调整/4 个相机函数/`handleKeyDown`/`mount()` 直接派发、`Minimap.vue` 收尾）——全部在 Task 1-6 落地。spec 文档遗漏的 `updateLayout` dep 已经在 Task 4 里补上并标注，跟切片 2 处理 `emitExport` 遗漏的方式一致。
- **Placeholder 扫描**：写计划过程中确认了几处容易出错的地方并在文中显式核对：滚轮缩放改用 `core.zoomAt` 等价性验证（`viewportOptions` 只读的三个字段不受 `effectiveOptions` 默认值影响）、平移分支不能改用 `core.panBy`（语义不同：相对起点视口算总位移 vs 相对当前视口累加）、新增的 `reorder-group-child`/`groupId: null` 用于纯平铺兄弟换位（不只是真实分组框内换位）这一点用根 controller 既有测试（"applyOperation forwards..."）核对过。
- **类型一致性**：`drag-controller` 的方法名（`onPointerDown`/`onPointerMove`/`onPointerUp`/`onPointerLeave`/`onPointerCancel`/`onLostPointerCapture`/`onWheel`/`onDragOver`/`onDrop`/`cancelPointerInteractions`/`getInteractionRenderState`）在 Task 4（导出）、Task 5（根 controller 组装/`mount()` 绑定）之间逐一对应；`edit.emitChangeIfApplied`/`contextMenu.isOpen` 在 Task 2/3（导出）和 Task 4/5（消费）之间对应一致。
- **跨任务一致性**：Task 5 的 `deps` 形状变化说明（删除 10 个 `onXxx` + `getInteractionRenderState` + `cancelPointerInteractions` + 3 个相机包装；新增 6 个 `getBeforeXxx`/`emitXxx`）跟 Task 6 `Minimap.vue` 里实际删除/新增的代码行逐一对应，没有遗漏或重复。Task 5/6 的测试和手动验收步骤（Task 7）都覆盖了"拖拽中途调用相机方法会先取消拖拽"这条切片 3 才补齐的新行为。
