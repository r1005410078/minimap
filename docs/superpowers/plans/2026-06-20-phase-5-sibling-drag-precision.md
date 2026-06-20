# 兄弟节点拖拽精度调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通节点（分组框之外）之间的拖拽同时支持"插入排序"和"嵌套变成子节点"两种意图，且插入排序的命中区域大到鼠标能稳定瞄准，同时修正"兄弟重排序时高亮共同父节点而不是真正悬停目标"的 bug。

**Architecture:** 在 `src/minimap/interaction.js` 里把命中检测拆成三层优先级——① 两个相邻兄弟之间的物理空隙（最大、最自然的命中区）；② 命中具体兄弟节点矩形的边缘窄带（屏幕像素阈值，按 `viewport.scale` 换算，只在没有相邻空隙可用时起作用，比如列表最前/最后一个）；③ 命中节点中间大片区域则判定为嵌套（复用"拖到非兄弟节点身上"已有的逻辑路径，连带修正高亮 bug）。`resolveDropTarget` 统一返回一个 `previewRect`（插入预览框的世界坐标，嵌套模式下为 `null`），`Minimap.vue`/`renderer.js` 据此画一个跟分组框内部一样的 `dropSlot` 预览框，不需要新写绘制逻辑。

**Tech Stack:** Vue 2.7 `<script setup>`、Canvas 2D、`node:test` + `@vue/test-utils` v1 + jsdom + mock canvas ctx。

## Global Constraints

- 边缘窄带阈值固定为 5 屏幕像素，调用方按 `EDGE_THRESHOLD_SCREEN_PX / viewportScale` 换算成世界单位再传入命中检测（缩放后窄带视觉宽度不变）。
- 插入预览框固定尺寸 = 标准节点尺寸：`layout.js` 的 `NODE`（`{width: 120, height: 40}`）。
- 范围只覆盖分组框之外的普通节点之间的拖拽；分组框内部子节点的拖拽机制（`dragRenderContext`/`drawGroupChildren`/`scheduleDragShift`）完全不变。
- 其他兄弟节点不做让位位移动画，预览框出现时其他节点保持原位（可能与预览框轻微重叠，这是预期效果不是 bug）。
- `Minimap.vue` 里 `reorder-group-child` vs `move-node` 的派发判断（`dragState.targetParentId === dragState.fromParentId`，约第887行）完全不变，不需要修改——只要 `resolveDropTarget` 在各分支正确设置 `parentId`，派发逻辑自动正确。

---

### Task 1: 兄弟拖拽三层命中检测 + 插入预览框几何计算

**Files:**
- Modify: `src/minimap/layout.js:7`（给 `NODE` 常量加 `export`）
- Modify: `src/minimap/interaction.js:155-218`（重写 `siblingInsertIndexAt` → `siblingDropZoneAt`，新增 `siblingGapHitAt`/`siblingGapPreviewRect`/`siblingEdgePreviewRect`，改写 `resolveDropTarget`）
- Test: `test/minimap-interaction.test.js`

**Interfaces:**
- Consumes：既有 `hitTest(layout, point)`、`groupGridIndexAt(group, point)`、私有 `containsPoint(rect, point)`、`isNodeOrDescendant(graph, nodeId, candidateId)`（均已在本文件中，无需改动签名）。
- Produces：
  - `export const NODE` from `layout.js`：`{ width: 120, height: 40 }`。
  - `resolveDropTarget(graph, layout, point, draggedNodeId, direction = 'horizontal', viewportScale = 1)` 返回 `{ valid, parentId, group, insertIndex, previewRect }`；`previewRect` 是世界坐标矩形 `{x,y,width,height}` 或 `null`。这是 Task 2 要消费的字段。

- [ ] **Step 1: 把 `layout.js` 的 `NODE` 常量导出**

读取 `src/minimap/layout.js` 第7行，当前是：

```js
const NODE = { width: 120, height: 40 }
```

改成：

```js
export const NODE = { width: 120, height: 40 }
```

- [ ] **Step 2: 在 `test/minimap-interaction.test.js` 写4个失败的单测**

在文件顶部 import 列表（第5~14行）不需要改动，`resolveDropTarget` 已经在导入列表里。在第298行（现有 `'resolveDropTarget resolves a sibling plain node hit as a same-parent reorder target'` 测试结束的 `})` 之后）插入以下4个新测试：

```js
test('resolveDropTarget treats the middle of a sibling rect as a nest target, not a reorder', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const targetRect = layout.nodes.get('feeder-2')
  const point = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'feeder-2')
  assert.equal(target.group, null)
  assert.equal(target.insertIndex, null)
  assert.equal(target.previewRect, null)
})

test('resolveDropTarget resolves a hit in the gap between two siblings as an insert between them', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const feeder2Rect = layout.nodes.get('feeder-2')
  const feeder3Rect = layout.nodes.get('feeder-3')
  const point = {
    x: feeder2Rect.x + feeder2Rect.width / 2,
    y: (feeder2Rect.y + feeder2Rect.height + feeder3Rect.y) / 2,
  }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'grid-tie')
  assert.equal(target.group, null)
  assert.equal(target.insertIndex, 1)
  assert.ok(target.previewRect)
})

test('resolveDropTarget edge-band threshold scales with viewport.scale', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const targetRect = layout.nodes.get('feeder-2')
  // 离顶边4个世界单位：scale=1 时阈值是5世界单位，落在窄带内（reorder）；
  // scale=2 时阈值是2.5世界单位，落在窄带外，应该判定成 nest。
  const point = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + 4 }

  const atScale1 = resolveDropTarget(graph, layout, point, 'feeder-3', 'horizontal', 1)
  const atScale2 = resolveDropTarget(graph, layout, point, 'feeder-3', 'horizontal', 2)

  assert.equal(atScale1.parentId, 'grid-tie')
  assert.equal(atScale1.insertIndex, 1)
  assert.equal(atScale2.parentId, 'feeder-2')
  assert.equal(atScale2.insertIndex, null)
})

test('resolveDropTarget computes the sibling gap along the cross axis for a vertical layout', () => {
  const graph = createDemoGraph()
  const verticalOpts = { ...VIEWPORT, direction: 'vertical' }
  const layout = computeLayout(graph, verticalOpts)
  const feeder2Rect = layout.nodes.get('feeder-2')
  const feeder3Rect = layout.nodes.get('feeder-3')
  const point = {
    x: (feeder2Rect.x + feeder2Rect.width + feeder3Rect.x) / 2,
    y: feeder2Rect.y + feeder2Rect.height / 2,
  }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1', 'vertical')

  assert.equal(target.valid, true)
  assert.equal(target.insertIndex, 1)
  assert.ok(target.previewRect)
})
```

- [ ] **Step 3: 运行测试，确认新增的4个失败**

```bash
npm test -- test/minimap-interaction.test.js
```

预期：前两个新测试会失败在 `target.parentId`/`target.insertIndex` 断言上（现在中点判定永远把兄弟当 reorder，不会有 nest；现在没有空隙命中逻辑）；第三个测试会失败（现在 `resolveDropTarget` 不接受第6个 `viewportScale` 参数，阈值固定不随 scale 变化）；第四个测试会失败（同样没有空隙命中逻辑）。已有测试应该仍然全部通过。

- [ ] **Step 4: 重写 `src/minimap/interaction.js` 第155~218行**

读取当前文件第155~218行，确认是：

```js
function isNodeOrDescendant(graph, nodeId, candidateId) {
  let current = candidateId
  while (current) {
    if (current === nodeId) return true
    current = graph.nodes.get(current)?.parentId ?? null
  }
  return false
}

function siblingInsertIndexAt(graph, layout, point, draggedNodeId, targetNodeId, direction = 'horizontal') {
  const dragged = graph.nodes.get(draggedNodeId)
  const target = graph.nodes.get(targetNodeId)
  if (!dragged || !target || dragged.parentId !== target.parentId) return null
  const parent = dragged.parentId ? graph.nodes.get(dragged.parentId) : null
  const targetRect = layout.nodes.get(targetNodeId)
  if (!parent || !targetRect || !parent.children.includes(draggedNodeId) || !parent.children.includes(targetNodeId)) {
    return null
  }
  const restChildren = parent.children.filter((id) => id !== draggedNodeId)
  const targetIndex = restChildren.indexOf(targetNodeId)
  if (targetIndex === -1) return null
  const midpoint =
    direction === 'vertical'
      ? targetRect.x + targetRect.width / 2
      : targetRect.y + targetRect.height / 2
  const pointCross = direction === 'vertical' ? point.x : point.y
  return pointCross < midpoint ? targetIndex : targetIndex + 1
}

// 拖拽悬停目标解析：命中分组框 item 时返回真实父节点 + 该分组 + 组内插入下标；
// 命中同父兄弟普通节点时返回共同父节点 + 兄弟插入下标；
// 命中非兄弟普通节点时该节点本身就是新的目标父节点，不计算插入下标（追加到末尾）；
// 命中分组框 header、命中空白、或目标是被拖节点自己/其后代时，返回 invalid。
export function resolveDropTarget(graph, layout, point, draggedNodeId, direction = 'horizontal') {
  const hit = hitTest(layout, point)
  if (!hit) return { valid: false }

  if (hit.type === 'group' && hit.zone === 'item') {
    const group = layout.groups.find((g) => g.id === hit.id)
    if (!group) return { valid: false }
    const parentId = group.parentId
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    const restGroup = { ...group, children: group.children.filter((id) => id !== draggedNodeId) }
    const insertIndex = groupGridIndexAt(restGroup, point)
    return { valid: true, parentId, group, insertIndex }
  }

  if (hit.type === 'node') {
    const siblingIndex = siblingInsertIndexAt(graph, layout, point, draggedNodeId, hit.id, direction)
    if (siblingIndex !== null) {
      return {
        valid: true,
        parentId: graph.nodes.get(draggedNodeId).parentId,
        group: null,
        insertIndex: siblingIndex,
      }
    }
    const parentId = hit.id
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    return { valid: true, parentId, group: null, insertIndex: null }
  }

  return { valid: false }
}
```

整段替换成：

```js
function isNodeOrDescendant(graph, nodeId, candidateId) {
  let current = candidateId
  while (current) {
    if (current === nodeId) return true
    current = graph.nodes.get(current)?.parentId ?? null
  }
  return false
}

const EDGE_THRESHOLD_SCREEN_PX = 5

// 悬停目标矩形按 cross 轴分三段：起始边/结束边各留一条窄带（插入排序），
// 中间大片区域是嵌套（变成子节点）。窄带宽度按屏幕像素换算成世界单位传入，
// 缩放后窄带的视觉宽度不变；矩形太小塞不下两条窄带时各自收缩到一半，
// 保证不会重叠、也不会出现"中间区域宽度为负"。
function siblingDropZoneAt(graph, layout, point, draggedNodeId, targetNodeId, direction, edgeThresholdWorld) {
  const dragged = graph.nodes.get(draggedNodeId)
  const target = graph.nodes.get(targetNodeId)
  if (!dragged || !target || dragged.parentId !== target.parentId) return null
  const parent = dragged.parentId ? graph.nodes.get(dragged.parentId) : null
  const targetRect = layout.nodes.get(targetNodeId)
  if (!parent || !targetRect || !parent.children.includes(draggedNodeId) || !parent.children.includes(targetNodeId)) {
    return null
  }
  const restChildren = parent.children.filter((id) => id !== draggedNodeId)
  const targetIndex = restChildren.indexOf(targetNodeId)
  if (targetIndex === -1) return null

  const crossStart = direction === 'vertical' ? targetRect.x : targetRect.y
  const crossExtent = direction === 'vertical' ? targetRect.width : targetRect.height
  const pointCross = direction === 'vertical' ? point.x : point.y
  const threshold = Math.min(edgeThresholdWorld, crossExtent / 2)

  if (pointCross <= crossStart + threshold) return { mode: 'before', insertIndex: targetIndex }
  if (pointCross >= crossStart + crossExtent - threshold) return { mode: 'after', insertIndex: targetIndex + 1 }
  return { mode: 'nest' }
}

// 在"去掉被拖节点后的兄弟列表"里找相邻两个之间的物理空隙（SIBLING_GAP），
// 命中即判定插入到它们之间——比窄带宽得多，是拖拽时最自然会瞄准的落点，
// 不要求像素级精确停在某个节点边缘上。只看仍是平铺节点（未被分组框消费）的兄弟，
// 分组框内部的命中检测走另一套机制，不归这里管。
function siblingGapHitAt(graph, layout, point, draggedNodeId, direction) {
  const dragged = graph.nodes.get(draggedNodeId)
  if (!dragged?.parentId) return null
  const parent = graph.nodes.get(dragged.parentId)
  if (!parent) return null

  const restChildren = parent.children.filter((id) => id !== draggedNodeId)
  const plainRestChildren = restChildren.filter((id) => layout.nodes.has(id))

  for (let i = 0; i < plainRestChildren.length - 1; i++) {
    const rectA = layout.nodes.get(plainRestChildren[i])
    const rectB = layout.nodes.get(plainRestChildren[i + 1])
    const gapRect =
      direction === 'vertical'
        ? {
            x: rectA.x + rectA.width,
            y: Math.min(rectA.y, rectB.y),
            width: rectB.x - (rectA.x + rectA.width),
            height: Math.max(rectA.height, rectB.height),
          }
        : {
            x: Math.min(rectA.x, rectB.x),
            y: rectA.y + rectA.height,
            width: Math.max(rectA.width, rectB.width),
            height: rectB.y - (rectA.y + rectA.height),
          }
    if (containsPoint(gapRect, point)) {
      return { insertIndex: restChildren.indexOf(plainRestChildren[i + 1]) }
    }
  }
  return null
}

// 插入预览框（跟标准节点同样大小）的世界坐标位置：命中空隙时居中在空隙上。
// insertIndex 只会是 siblingGapHitAt 命中空隙时返回的下标，两侧节点必然都存在，
// 不需要兜底分支。
function siblingGapPreviewRect(graph, layout, draggedNodeId, insertIndex, direction) {
  const dragged = graph.nodes.get(draggedNodeId)
  const parent = graph.nodes.get(dragged.parentId)
  const restChildren = parent.children.filter((id) => id !== draggedNodeId)
  const rectA = layout.nodes.get(restChildren[insertIndex - 1])
  const rectB = layout.nodes.get(restChildren[insertIndex])
  if (direction === 'vertical') {
    const centerX = (rectA.x + rectA.width + rectB.x) / 2
    return { x: centerX - NODE.width / 2, y: rectA.y, width: NODE.width, height: NODE.height }
  }
  const centerY = (rectA.y + rectA.height + rectB.y) / 2
  return { x: rectA.x, y: centerY - NODE.height / 2, width: NODE.width, height: NODE.height }
}

// 命中边缘窄带时（没有相邻空隙可用，比如列表最前/最后一个），预览框贴在目标
// 节点对应那条边的外侧。
function siblingEdgePreviewRect(layout, targetNodeId, mode, direction) {
  const targetRect = layout.nodes.get(targetNodeId)
  if (direction === 'vertical') {
    const x = mode === 'before' ? targetRect.x - NODE.width : targetRect.x + targetRect.width
    return { x, y: targetRect.y, width: NODE.width, height: NODE.height }
  }
  const y = mode === 'before' ? targetRect.y - NODE.height : targetRect.y + targetRect.height
  return { x: targetRect.x, y, width: NODE.width, height: NODE.height }
}

// 拖拽悬停目标解析：先看是否命中两个相邻兄弟之间的物理空隙（插入排序，最容易瞄准）；
// 否则命中分组框 item 时返回真实父节点 + 该分组 + 组内插入下标；
// 命中同父兄弟普通节点的边缘窄带时返回共同父节点 + 兄弟插入下标（插入排序）；
// 命中同父兄弟普通节点中间区域、或命中非兄弟普通节点时，该节点本身就是新的目标父节点，
// 不计算插入下标（追加到末尾，嵌套变成子节点）；
// 命中分组框 header、命中空白、或目标是被拖节点自己/其后代时，返回 invalid。
export function resolveDropTarget(graph, layout, point, draggedNodeId, direction = 'horizontal', viewportScale = 1) {
  const edgeThresholdWorld = EDGE_THRESHOLD_SCREEN_PX / viewportScale

  const gapHit = siblingGapHitAt(graph, layout, point, draggedNodeId, direction)
  if (gapHit) {
    return {
      valid: true,
      parentId: graph.nodes.get(draggedNodeId).parentId,
      group: null,
      insertIndex: gapHit.insertIndex,
      previewRect: siblingGapPreviewRect(graph, layout, draggedNodeId, gapHit.insertIndex, direction),
    }
  }

  const hit = hitTest(layout, point)
  if (!hit) return { valid: false }

  if (hit.type === 'group' && hit.zone === 'item') {
    const group = layout.groups.find((g) => g.id === hit.id)
    if (!group) return { valid: false }
    const parentId = group.parentId
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    const restGroup = { ...group, children: group.children.filter((id) => id !== draggedNodeId) }
    const insertIndex = groupGridIndexAt(restGroup, point)
    return { valid: true, parentId, group, insertIndex, previewRect: null }
  }

  if (hit.type === 'node') {
    const zone = siblingDropZoneAt(graph, layout, point, draggedNodeId, hit.id, direction, edgeThresholdWorld)
    if (zone && zone.mode !== 'nest') {
      return {
        valid: true,
        parentId: graph.nodes.get(draggedNodeId).parentId,
        group: null,
        insertIndex: zone.insertIndex,
        previewRect: siblingEdgePreviewRect(layout, hit.id, zone.mode, direction),
      }
    }
    const parentId = hit.id
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    return { valid: true, parentId, group: null, insertIndex: null, previewRect: null }
  }

  return { valid: false }
}
```

然后把文件顶部的 import（第6行）：

```js
import { GROUP, visibleGroupChildren } from './layout.js'
```

改成：

```js
import { GROUP, NODE, visibleGroupChildren } from './layout.js'
```

- [ ] **Step 5: 运行测试，确认全部通过**

```bash
npm test -- test/minimap-interaction.test.js
```

预期：本文件全部测试（包括 Step 2 新增的4个，和原有的全部）都 PASS。重点检查原有这几个不应该回归：`resolveDropTarget resolves a non-sibling plain node hit as the new parent`、`resolveDropTarget resolves a sibling plain node hit as a same-parent reorder target`、`resolveDropTarget resolves a group item hit to the group real parent and an insert index`、`resolveDropTarget rejects dropping a node onto itself or its own descendant`、`resolveDropTarget returns invalid for a miss or a group header hit`。

- [ ] **Step 6: 跑全量测试，确认没有跨文件回归**

```bash
npm test
```

预期：全部通过（这一步只改了 `interaction.js`/`layout.js` 的内部实现，`Minimap.vue` 还没接上新的 `viewportScale`/`previewRect`，端到端测试此时应该用默认参数路径，行为跟改动前一致）。

- [ ] **Step 7: Commit**

```bash
git add src/minimap/layout.js src/minimap/interaction.js test/minimap-interaction.test.js
git commit -m "feat: add gap-hit insertion zone and nest zone for sibling node drag"
```

---

### Task 2: 接入 Minimap.vue 渲染 + 插入预览框绘制

**Files:**
- Modify: `src/minimap/Minimap.vue`（`dragState` 初始化、`updateDragTarget`、`renderCurrent` 里的 `dragHighlightId` 和 `renderScene` 调用）
- Modify: `src/minimap/renderer.js`（`renderScene` 新增插入预览框绘制）
- Test: `test/minimap-node-move.test.js`

**Interfaces:**
- Consumes：Task 1 产出的 `resolveDropTarget(graph, layout, point, draggedNodeId, direction, viewportScale)` 第6个参数和返回值里的 `previewRect` 字段；已有的 `worldRectToScreen(rect, viewport)`（`renderer.js` 已导出，`Minimap.vue` 已 import）；已有的 `drawDropSlot(ctx, rect, theme, opacity)`（`renderer.js` 内部私有函数，`renderScene` 同文件内可直接调用）；已有的 `currentViewport()`（`Minimap.vue` 内部函数）。
- Produces：`dragState.insertPreviewRect`（世界坐标矩形或 `null`，供本任务内部消费，不暴露给其他任务）；传给 `renderScene` 的 `state.siblingInsertPreview`（`{ rect }` 屏幕坐标或 `null`）。

- [ ] **Step 1: 在 `test/minimap-node-move.test.js` 加一个 `dropSlotDrawn` 辅助函数**

在第290行 `highlightedLabels` 函数定义之后（即 `}` 闭合之后）插入：

```js
// Helper to check if an insert-preview drop-slot box was drawn in the current frame
function dropSlotDrawn(ctx, theme) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  return calls.some((call) => call.method === 'set:fillStyle' && call.args[0] === theme.group.dropSlot.fill)
}
```

- [ ] **Step 2: 写4个失败的端到端测试**

在文件末尾（第399行 `wrapper.destroy()` 和文件结束 `})` 之后）追加：

```js
test('dragging a sibling into the gap between two other siblings shows an insert preview and inserts it between them', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const feeder2 = layout.nodes.get('feeder-2')
  const feeder3 = layout.nodes.get('feeder-3')
  const to = { x: feeder2.x + feeder2.width / 2, y: (feeder2.y + feeder2.height + feeder3.y) / 2 }

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)

  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-1', 'feeder-3'])
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('node-move'), undefined)
  wrapper.destroy()
})

test('dragging a sibling onto the leading edge of the first remaining sibling inserts before it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-2')
  const to = nodePoint(layout, 'feeder-1', { y: 2 })

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-2').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-1', 'feeder-3'])
  wrapper.destroy()
})

test('dragging a sibling onto the trailing edge of the last remaining sibling inserts after it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-2')
  const feeder3 = layout.nodes.get('feeder-3')
  const to = nodePoint(layout, 'feeder-3', { y: feeder3.height - 2 })

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-2').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-1', 'feeder-3', 'feeder-2'])
  wrapper.destroy()
})

test('dragging a sibling onto the middle of another sibling highlights that sibling itself, not the shared parent, and shows no insert preview', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  const highlightedMidDrag = highlightedLabels(contexts.at(-1), defaultTheme)
  assert.ok(
    highlightedMidDrag.includes('Feeder 2'),
    `feeder-2 should be highlighted as the live nest target; got: ${highlightedMidDrag}`,
  )
  assert.ok(
    !highlightedMidDrag.includes('Grid Tie'),
    `the shared parent (grid-tie) should not be highlighted; got: ${highlightedMidDrag}`,
  )
  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), false)

  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'feeder-2')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(graph.nodes.get('feeder-2').children.includes('feeder-1'), true)
  wrapper.destroy()
})
```

- [ ] **Step 3: 运行测试，确认新增的4个失败**

```bash
npm test -- test/minimap-node-move.test.js
```

预期：4个新测试里，2个失败、2个已经通过——

- **失败**：第1个测试（空隙命中）失败在 `assert.equal(dropSlotDrawn(...), true)`；第4个测试（中间区域 nest）失败在 `assert.equal(dropSlotDrawn(...), false)` 之前没问题，但因为现在还没有任何插入预览框绘制逻辑，`dropSlotDrawn` 恒为 `false`——也就是说第4个测试的高亮断言（`feeder-2` 被高亮、`Grid Tie` 不被高亮）此时已经能通过（Task 1 已经让 `resolveDropTarget` 在 nest 区域正确返回 `parentId: 'feeder-2'`），但整条测试仍然失败，因为 `dropSlotDrawn(...) === false` 这条本身没问题，真正缺的是渲染层还没有 `drawDropSlot` 调用——不对，这条断言期望 `false` 且现在恒为 `false`，所以第4个测试此时应该是**全部通过**的，不需要等 Step 4~7。运行一次确认：如果第4个测试已经 PASS，跳过它，只需要让第1个测试（依赖 `dropSlotDrawn(...) === true`，现在恒为 `false`，必然 FAIL）变绿。
- **已经通过**：第2、3个测试（首/尾边缘窄带）只检查最终 `children` 顺序，不检查渲染——Task 1 已经让 `resolveDropTarget` 本身支持边缘窄带判定，`updateDragTarget` 此时即使还没显式传 `viewportScale`，默认值 `1` 对这两个测试用的偏移量（2 个世界单位）已经足够落在 5 世界单位的窄带内，所以这两个测试此时应该已经是 PASS。

实际运行一次，确认这个判断：应该只有第1个测试 FAIL，其余3个 PASS。把实际结果记下来，继续往下实现（Step 4~7 完成后第1个测试会变绿，且不会影响其余3个）。

- [ ] **Step 4: 修改 `src/minimap/Minimap.vue` 的 `dragState` 初始化**

读取第729~748行，当前是：

```js
    dragState = {
      nodeId,
      fromParentId: node.parentId,
      additive: isAdditiveSelection(event),
      startScreen: screenPointFromEvent(event),
      dragging: false,
      targetParentId: null,
      targetGroupId: null,
      insertIndex: 0,
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
```

在 `insertIndex: 0,` 之后加一行：

```js
    dragState = {
      nodeId,
      fromParentId: node.parentId,
      additive: isAdditiveSelection(event),
      startScreen: screenPointFromEvent(event),
      dragging: false,
      targetParentId: null,
      targetGroupId: null,
      insertIndex: 0,
      insertPreviewRect: null,
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
```

- [ ] **Step 5: 修改 `updateDragTarget`，传 `viewportScale` 并存 `insertPreviewRect`**

读取第316~360行，当前是：

```js
function updateDragTarget(worldPoint) {
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
        }
      : resolveDropTarget(props.graph, layout, worldPoint, dragState.nodeId, props.layoutDirection)

  if (!target.valid) {
    clearDragShiftAnimation()
    dragState.targetParentId = null
    dragState.targetGroupId = null
    dragState.insertIndex = 0
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
  } else {
    clearDragShiftAnimation()
    dragState.targetParentId = target.parentId
    dragState.targetGroupId = null
    dragState.insertIndex = target.insertIndex
  }

  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
}
```

改成（三处改动：① `resolveDropTarget` 调用多传 `currentViewport().scale`；② 三个分支各自维护 `insertPreviewRect`；③ 手动悬停在分组框内部时构造的 `target` 字面量补一个 `previewRect: null`，跟 `resolveDropTarget` 的返回 shape 保持一致）：

```js
function updateDragTarget(worldPoint) {
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
          props.graph,
          layout,
          worldPoint,
          dragState.nodeId,
          props.layoutDirection,
          currentViewport().scale,
        )

  if (!target.valid) {
    clearDragShiftAnimation()
    dragState.targetParentId = null
    dragState.targetGroupId = null
    dragState.insertIndex = 0
    dragState.insertPreviewRect = null
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
    dragState.insertPreviewRect = null
  } else {
    clearDragShiftAnimation()
    dragState.targetParentId = target.parentId
    dragState.targetGroupId = null
    dragState.insertIndex = target.insertIndex
    dragState.insertPreviewRect = target.previewRect ?? null
  }

  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
}
```

- [ ] **Step 6: 修改 `renderCurrent` 里的 `dragHighlightId` 判断和 `renderScene` 调用**

读取第380~413行，当前是：

```js
function renderCurrent(currentLayout = layout, renderViewport = currentViewport()) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...renderViewport }
  // 拖拽过程中暂时不展示旧选区的父子关系高亮/降权——否则会跟拖拽目标高亮互相打架，
  // 视觉上显得"父节点亮了"而不是真正悬停的目标（旧选区跟当前拖拽目标是两件不相关的事）。
  const relations = dragState?.dragging
    ? buildSelectionRelations(props.graph, currentLayout, [])
    : buildSelectionRelations(props.graph, currentLayout, currentSelectedIds())
  const dragHighlightId =
    dragState?.dragging && !dragState.targetGroupId && dragState.targetParentId ? dragState.targetParentId : null
  const highlightedIds = dragHighlightId
    ? new Set([...relations.highlightedIds, dragHighlightId])
    : relations.highlightedIds
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: renderViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: {
      selectedIds: relations.selectedIds,
      highlightedIds,
      dimmedIds: relations.dimmedIds,
      highlightedEdgeIds: relations.highlightedEdgeIds,
      dimmedEdgeIds: relations.dimmedEdgeIds,
      groupDrag: dragRenderContext(),
      groupScrollbarHoverId: hoveredScrollbarGroupId,
      selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
    },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
```

把 `dragHighlightId` 那一行和 `state` 对象改成：

```js
function renderCurrent(currentLayout = layout, renderViewport = currentViewport()) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...renderViewport }
  // 拖拽过程中暂时不展示旧选区的父子关系高亮/降权——否则会跟拖拽目标高亮互相打架，
  // 视觉上显得"父节点亮了"而不是真正悬停的目标（旧选区跟当前拖拽目标是两件不相关的事）。
  const relations = dragState?.dragging
    ? buildSelectionRelations(props.graph, currentLayout, [])
    : buildSelectionRelations(props.graph, currentLayout, currentSelectedIds())
  const dragHighlightId =
    dragState?.dragging && !dragState.targetGroupId && !dragState.insertPreviewRect && dragState.targetParentId
      ? dragState.targetParentId
      : null
  const highlightedIds = dragHighlightId
    ? new Set([...relations.highlightedIds, dragHighlightId])
    : relations.highlightedIds
  const siblingInsertPreview =
    dragState?.dragging && dragState.insertPreviewRect
      ? { rect: worldRectToScreen(dragState.insertPreviewRect, renderViewport) }
      : null
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: renderViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: {
      selectedIds: relations.selectedIds,
      highlightedIds,
      dimmedIds: relations.dimmedIds,
      highlightedEdgeIds: relations.highlightedEdgeIds,
      dimmedEdgeIds: relations.dimmedEdgeIds,
      groupDrag: dragRenderContext(),
      groupScrollbarHoverId: hoveredScrollbarGroupId,
      selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
      siblingInsertPreview,
    },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
```

（`worldRectToScreen` 已经在文件第21行 `import { renderScene, worldRectToScreen } from './renderer.js'` 里导入，不需要再加 import。）

- [ ] **Step 7: 修改 `src/minimap/renderer.js` 的 `renderScene`，画插入预览框**

读取第538~554行，当前是：

```js
  for (const { item, screen } of items) {
    if (item.type !== 'node') continue
    if (state.groupDrag?.draggingChildId === item.id) continue
    const node = graph.nodes.get(item.id)
    const itemState = makeState(item.id, selectedIds, highlightedIds, dimmedIds)
    if (renderers.node) renderers.node(ctx, { node, rect: screen, state: itemState, theme, viewport })
    else drawNode(ctx, node, screen, itemState, theme)
    drawn++
  }

  if (state.groupDrag) {
    drawNodeDragGhost(ctx, graph, state.groupDrag, theme, renderers, viewport, selectedIds, highlightedIds, dimmedIds)
  }

  if (state.selectionRect) drawSelectionRect(ctx, state.selectionRect, theme)

  return { total: layout.visibleItems.length, drawn, culled, durationMs: now() - t0 }
```

在 `if (state.groupDrag) {...}` 这段之后、`if (state.selectionRect)` 之前插入：

```js
  for (const { item, screen } of items) {
    if (item.type !== 'node') continue
    if (state.groupDrag?.draggingChildId === item.id) continue
    const node = graph.nodes.get(item.id)
    const itemState = makeState(item.id, selectedIds, highlightedIds, dimmedIds)
    if (renderers.node) renderers.node(ctx, { node, rect: screen, state: itemState, theme, viewport })
    else drawNode(ctx, node, screen, itemState, theme)
    drawn++
  }

  if (state.groupDrag) {
    drawNodeDragGhost(ctx, graph, state.groupDrag, theme, renderers, viewport, selectedIds, highlightedIds, dimmedIds)
  }

  if (state.siblingInsertPreview) {
    drawDropSlot(ctx, state.siblingInsertPreview.rect, theme, 1)
  }

  if (state.selectionRect) drawSelectionRect(ctx, state.selectionRect, theme)

  return { total: layout.visibleItems.length, drawn, culled, durationMs: now() - t0 }
```

（`drawDropSlot` 在同一文件第392行已经定义，不需要 import。）

- [ ] **Step 8: 运行测试，确认 Task 2 新增的4个通过**

```bash
npm test -- test/minimap-node-move.test.js
```

预期：本文件全部测试通过，包括 Step 2 新增的4个和原有全部（重点检查不应该回归的：`dragging a sibling onto the upper half...`、`...lower half...`、`vertical layout sibling reorder...`、`dragging an ungrouped child onto its own real parent reorders...`、`readonly and beforeNodeMove block cross-parent moves`、`blocked cross-parent moves clear the plain-node drop target highlight`、`dragging an already-selected node shows the live drop target highlight...`）。

- [ ] **Step 9: 跑全量测试**

```bash
npm test
```

预期：全部通过。

- [ ] **Step 10: 跑构建确认没有语法/类型问题**

```bash
npm run build
```

预期：构建成功。

- [ ] **Step 11: Commit**

```bash
git add src/minimap/Minimap.vue src/minimap/renderer.js test/minimap-node-move.test.js
git commit -m "feat: render sibling drag insert preview and fix nest-mode highlight target"
```
