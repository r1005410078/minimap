# Phase 5 Cross-Parent Node Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any real node (plain or inside a group box) be dragged onto another node, becoming its child; if the drop target's real parent is the same as the drag origin's real parent, fall back to the existing same-parent reorder; add edge-of-canvas auto-pan during drag.

**Architecture:** Add a new pure `move-node` operation to the existing operation/history layer for cross-parent moves. Generalize the existing group-internal drag-shift math (`drag-transition.js`) to accept any parent's children, not just a group's. Add a new pure drop-target resolver (`interaction.js`) that hit-tests the whole canvas and returns the real target parent (plus group, if the target's children happen to be grouped) with cycle prevention built in. Relocate the existing "drag ghost" rendering in `renderer.js` to a top-level draw call so it renders regardless of whether the current hover target is a group. Finally, rewrite `Minimap.vue`'s pointer handlers to start a drag from any node hit (not just group items), continuously re-resolve the drop target on every `pointermove`, and dispatch either the existing `reorder-group-child` (same real parent) or the new `move-node` (different real parent) on drop.

**Tech Stack:** Vue 2.7 SFC, Canvas 2D, pure JS graph/layout/interaction helpers, `node:test`, Vue Test Utils, jsdom canvas mocks, Vite build.

## Global Constraints

- Any real node (plain or group-internal) can be dragged. Dropping it onto another node makes that node the new parent; the dragged node (and its whole subtree) becomes its child, appended to `children`.
- If the drop target's real parent equals the drag origin's real parent, dispatch the existing `reorder-group-child` operation (unchanged operation, now reachable from a wider set of gestures). Otherwise dispatch the new `move-node` operation.
- Dropping a node onto itself or any of its own descendants must be rejected (`reason: 'invalid'`), both live during drag (no misleading highlight) and defensively inside the `move-node` operation itself.
- Hovering over a group-box item during drag reuses the existing shift-preview animation (now generalized to work for any target group, not just the drag's origin group). Hovering over a plain (ungrouped) node only highlights it — no sibling shift animation.
- Cursor near the canvas edge during an active drag triggers a fixed-speed viewport auto-pan, independent of the existing per-group auto-scroll.
- `readonly` blocks both `move-node` and `reorder-group-child`. `beforeNodeMove` blocks `move-node`; `beforeGroupReorder` blocks `reorder-group-child` (including the new ungrouped-sibling-reorder case).
- `move-node`'s undo/redo inverse uses the established whole-graph-snapshot pattern (`{ type: 'replace-graph', payload: { graph: before } }`), matching `delete-nodes`/`paste-nodes`/`replace-graph`.
- Dragging a node out to become a new root is out of scope. `options.drag.*` configuration, precise shift-preview for ungrouped targets, and cross-instance dragging are out of scope.
- Every task that touches the shared pointer-handling code (`handlePointerDown`/`handlePointerMove`/`handlePointerUp` and the functions they call) must keep the full existing `test/minimap-group-interaction.test.js` suite passing unmodified — that file is the regression safety net for this plan and must not be edited.

---

## File Map

- Modify: `src/minimap/graph-operations.js`
  - Add `move-node` operation: payload `{ nodeId, toParentId, index }`, cycle prevention, whole-graph-snapshot inverse.
- Modify: `src/minimap/drag-transition.js`
  - `buildVirtualOrder(group, childId, insertIndex)` → `buildVirtualOrder(children, childId, insertIndex)` (takes the children array directly).
  - `childWorldRectsById(group, order)` recomputes `rows` from `order.length` instead of trusting `group.rows`, so a virtually-inserted foreign child that exceeds the group's original grid capacity still gets a rect.
- Modify: `src/minimap/interaction.js`
  - Add `resolveDropTarget(graph, layout, point, draggedNodeId)`: hit-tests the point, resolves the real target parent (and group, if any), with cycle prevention.
  - Add `edgePanVelocity(screenPoint, containerWidth, containerHeight, edgeZone, maxSpeed)`: screen-space edge-proximity velocity for canvas auto-pan.
- Modify: `src/minimap/renderer.js`
  - Move the "drag ghost" drawing out of `drawGroupChildren` into a new top-level `drawNodeDragGhost`, called once from `renderScene` regardless of whether the current drop target is a group. No field renames — `state.groupDrag` keeps its shape; `groupId` can now legitimately be `null`.
- Modify: `src/minimap/Minimap.vue`
  - `handlePointerDown`: start a drag from any node hit (plain or group-item), not only group items.
  - Replace `updateDragInsertion`/`beginDragVisuals` with `updateDragTarget`, which re-resolves the drop target on every move via `resolveDropTarget` and reuses the generalized shift-preview math for whichever group (if any) is currently hovered.
  - `dragRenderContext`: resolve the rendered group by id each call (was previously fixed to the drag's origin group).
  - `handlePointerUp`: dispatch `reorder-group-child` (same real parent) or `move-node` (different real parent) based on the live-resolved target.
  - Add prop `beforeNodeMove`, event `node-move`.
- Create: `test/minimap-node-move.test.js`
  - New Vue-integration tests for cross-parent move, cross-group move, ungrouped-sibling reorder, cycle prevention, hooks, and the new event (Task 5); extended with edge-of-canvas auto-pan tests (Task 6).
- Modify: `src/minimap/Minimap.vue` (Task 6, after Task 5 lands)
  - Add the edge-of-canvas auto-pan loop, gated by the new `resolveDropTarget`/`edgePanVelocity` and `dragState.lastScreenPoint`/`dragging` from Tasks 3 and 5.
- Modify: `ROADMAP.md`
  - Mark slice 3 complete; advance current phase to slice 4.

---

### Task 1: `move-node` Operation

**Files:**
- Modify: `src/minimap/graph-operations.js`
- Modify: `test/minimap-graph-operations.test.js`

**Interfaces:**
- Produces: operation type `'move-node'`, payload `{ nodeId, toParentId, index }`, applied via the existing `createGraphOperationManager(graph).apply(...)`. On success, `result.operation.payload.index` is the clamped final index.

- [ ] **Step 1: Write failing tests**

Append to `test/minimap-graph-operations.test.js`:

```js
test('move-node moves a node and its subtree to a new parent and can undo redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'move-node',
    payload: { nodeId: 'grid-tie', toParentId: 'cluster-25', index: 1 },
  })

  assert.equal(result.applied, true)
  assert.equal(result.operation.payload.index, 1)
  assert.equal(graph.nodes.get('grid-tie').parentId, 'cluster-25')
  assert.equal(graph.nodes.get('energy-root').children.includes('grid-tie'), false)
  assert.equal(graph.nodes.get('cluster-25').children[1], 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')

  manager.undo()
  assert.equal(graph.nodes.get('grid-tie').parentId, 'energy-root')
  assert.equal(graph.nodes.get('energy-root').children.includes('grid-tie'), true)
  assert.equal(graph.nodes.get('cluster-25').children.includes('grid-tie'), false)

  manager.redo()
  assert.equal(graph.nodes.get('grid-tie').parentId, 'cluster-25')
})

test('move-node removes a moved root from rootIds', () => {
  const graph = createDemoGraph()
  graph.rootIds.push('standalone')
  graph.nodes.set('standalone', { id: 'standalone', label: 'Standalone', parentId: null, children: [] })
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'move-node',
    payload: { nodeId: 'standalone', toParentId: 'cluster-25', index: 0 },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(graph.rootIds, ['energy-root'])
  assert.equal(graph.nodes.get('standalone').parentId, 'cluster-25')

  manager.undo()
  assert.deepEqual(graph.rootIds, ['energy-root', 'standalone'])
})

test('move-node rejects moving a node onto itself or its own descendant', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(
    manager.apply({ type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'grid-tie', index: 0 } }).reason,
    'invalid',
  )
  assert.equal(
    manager.apply({ type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'feeder-1', index: 0 } }).reason,
    'invalid',
  )
  assert.equal(graph.nodes.get('grid-tie').parentId, 'energy-root')
})

test('move-node returns invalid for a missing node or missing target parent', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(
    manager.apply({ type: 'move-node', payload: { nodeId: 'missing', toParentId: 'cluster-25', index: 0 } }).reason,
    'invalid',
  )
  assert.equal(
    manager.apply({ type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'missing', index: 0 } }).reason,
    'invalid',
  )
})

test('move-node respects readonly and before hooks', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(
    manager.apply(
      { type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'cluster-25', index: 0 } },
      { readonly: true },
    ).reason,
    'readonly',
  )
  assert.equal(
    manager.apply(
      { type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'cluster-25', index: 0 } },
      { before: () => false },
    ).reason,
    'blocked',
  )
  assert.equal(graph.nodes.get('grid-tie').parentId, 'energy-root')
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- test/minimap-graph-operations.test.js`

Expected: FAIL because `'move-node'` is not a recognized operation type.

- [ ] **Step 3: Implement `move-node`**

In `src/minimap/graph-operations.js`, add this function above `applyOperation` (near `applyDeleteNodes`/`applyReplaceGraph`):

```js
function isNodeOrDescendant(graph, nodeId, candidateId) {
  let current = candidateId
  while (current) {
    if (current === nodeId) return true
    current = graph.nodes.get(current)?.parentId ?? null
  }
  return false
}

function applyMoveNode(graph, operation) {
  const { nodeId, toParentId, index } = operation.payload
  const node = nodeId ? graph.nodes.get(nodeId) : null
  const target = toParentId ? graph.nodes.get(toParentId) : null
  if (!node || !target) return blockedResult(graph, operation, 'invalid')
  if (isNodeOrDescendant(graph, nodeId, toParentId)) return blockedResult(graph, operation, 'invalid')

  const before = cloneGraphData(graph)

  if (node.parentId) {
    const oldParent = graph.nodes.get(node.parentId)
    oldParent.children = oldParent.children.filter((id) => id !== nodeId)
  } else {
    graph.rootIds = graph.rootIds.filter((id) => id !== nodeId)
  }

  const insertIndex = clampIndex(index, target.children.length)
  target.children = [...target.children]
  target.children.splice(insertIndex, 0, nodeId)
  node.parentId = toParentId

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, index: insertIndex } },
    inverse: { type: 'replace-graph', payload: { graph: before } },
    graph,
  })
}
```

Add the dispatch branch to `applyOperation`, directly after the `delete-nodes` branch:

```js
  if (operation.type === 'move-node') return applyMoveNode(graph, operation)
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- test/minimap-graph-operations.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/graph-operations.js test/minimap-graph-operations.test.js
git commit -m "feat: add move-node operation for cross-parent moves"
```

---

### Task 2: Generalize Drag-Shift Math

**Files:**
- Modify: `src/minimap/drag-transition.js`
- Modify: `test/minimap-drag-transition.test.js`

**Interfaces:**
- Produces: `buildVirtualOrder(children, childId, insertIndex)` — now takes a plain array of ids instead of a group object. `childWorldRectsById(group, order)` keeps its existing signature but now derives `rows` from `order.length`.

- [ ] **Step 1: Update the existing test for the new `buildVirtualOrder` signature**

In `test/minimap-drag-transition.test.js`, replace:

```js
test('buildVirtualOrder inserts the dragged child at the target index', () => {
  const group = { children: ['a', 'b', 'c', 'd'] }
  assert.deepEqual(buildVirtualOrder(group, 'b', 0), ['b', 'a', 'c', 'd'])
  assert.deepEqual(buildVirtualOrder(group, 'b', 2), ['a', 'c', 'b', 'd'])
})
```

with:

```js
test('buildVirtualOrder inserts the dragged child at the target index', () => {
  assert.deepEqual(buildVirtualOrder(['a', 'b', 'c', 'd'], 'b', 0), ['b', 'a', 'c', 'd'])
  assert.deepEqual(buildVirtualOrder(['a', 'b', 'c', 'd'], 'b', 2), ['a', 'c', 'b', 'd'])
})

test('buildVirtualOrder inserts a foreign id that was not already in the array', () => {
  assert.deepEqual(buildVirtualOrder(['a', 'b', 'c'], 'z', 1), ['a', 'z', 'b', 'c'])
})
```

And replace the line `const original = childWorldRectsById(group, group.children)` test that calls `buildVirtualOrder(group, 'cluster-1', 2)` — find this test:

```js
test('childWorldRectsById shifts visible children when the virtual order changes', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((item) => item.parentId === 'heap-1')
  const original = childWorldRectsById(group, group.children)
  const reordered = childWorldRectsById(group, buildVirtualOrder(group, 'cluster-1', 2))

  assert.notEqual(original['cluster-1'].y, reordered['cluster-1'].y)
  assert.notEqual(original['cluster-2'].x, reordered['cluster-2'].x)
})
```

and change the `buildVirtualOrder(group, 'cluster-1', 2)` call to `buildVirtualOrder(group.children, 'cluster-1', 2)`:

```js
test('childWorldRectsById shifts visible children when the virtual order changes', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((item) => item.parentId === 'heap-1')
  const original = childWorldRectsById(group, group.children)
  const reordered = childWorldRectsById(group, buildVirtualOrder(group.children, 'cluster-1', 2))

  assert.notEqual(original['cluster-1'].y, reordered['cluster-1'].y)
  assert.notEqual(original['cluster-2'].x, reordered['cluster-2'].x)
})
```

Append a new test verifying the `rows` recompute fix:

```js
test('childWorldRectsById computes a rect for a virtually inserted child beyond the original grid capacity', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((item) => item.parentId === 'heap-1')
  const order = [...group.children, 'feeder-1']

  const rects = childWorldRectsById(group, order)

  assert.ok(rects['feeder-1'])
  assert.equal(typeof rects['feeder-1'].x, 'number')
  assert.equal(typeof rects['feeder-1'].y, 'number')
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- test/minimap-drag-transition.test.js`

Expected: FAIL — `buildVirtualOrder` still expects a group object, and the new beyond-capacity test finds no rect for the extra id.

- [ ] **Step 3: Implement the generalization**

In `src/minimap/drag-transition.js`, replace:

```js
export function buildVirtualOrder(group, childId, insertIndex) {
  const order = group.children.filter((id) => id !== childId)
  order.splice(insertIndex, 0, childId)
  return order
}

export function childWorldRectsById(group, order) {
  const virtualGroup = { ...group, children: order }
  const rects = {}
  for (const child of visibleGroupChildren(virtualGroup)) {
    rects[child.id] = { ...child.rect }
  }
  return rects
}
```

with:

```js
export function buildVirtualOrder(children, childId, insertIndex) {
  const order = children.filter((id) => id !== childId)
  order.splice(insertIndex, 0, childId)
  return order
}

export function childWorldRectsById(group, order) {
  const columns = Math.max(1, group.columns)
  const virtualGroup = { ...group, children: order, rows: Math.ceil(order.length / columns) }
  const rects = {}
  for (const child of visibleGroupChildren(virtualGroup)) {
    rects[child.id] = { ...child.rect }
  }
  return rects
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- test/minimap-drag-transition.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/drag-transition.js test/minimap-drag-transition.test.js
git commit -m "feat: generalize drag-shift math to any parent's children"
```

---

### Task 3: Drop Target Resolution And Edge-Pan Velocity

**Files:**
- Modify: `src/minimap/interaction.js`
- Modify: `test/minimap-interaction.test.js`

**Interfaces:**
- Produces: `export function resolveDropTarget(graph, layout, point, draggedNodeId)` → `{ valid: false }` or `{ valid: true, parentId, group, insertIndex }` (`group` is `null` and `insertIndex` is `null` when the hit is a plain node).
- Produces: `export function edgePanVelocity(screenPoint, containerWidth, containerHeight, edgeZone = 24, maxSpeed = 12)` → `{ x, y }`.

- [ ] **Step 1: Write failing tests**

`test/minimap-interaction.test.js` already defines `const VIEWPORT = { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 }` at the top and imports `hitTest, findInsertionIndex, groupGridIndexAt, exceedsDragThreshold, groupAutoScrollSpeed, groupInsertIndexToParentIndex` from `'../src/minimap/interaction.js'`. It does not yet have a "first item center" helper. Update the import line to:

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
} from '../src/minimap/interaction.js'
```

Append this helper directly after the `multiGroupGraph` function:

```js
function firstItemCenter(group) {
  return {
    x: group.x + GROUP.padding + GROUP.itemW / 2,
    y: group.y + GROUP.header + GROUP.padding + GROUP.itemH / 2,
  }
}
```

Then append these tests (using the file's existing `VIEWPORT` constant, not a new one):

```js
test('resolveDropTarget resolves a plain node hit as the new parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const targetRect = layout.nodes.get('feeder-2')
  const point = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'feeder-2')
  assert.equal(target.group, null)
  assert.equal(target.insertIndex, null)
})

test('resolveDropTarget resolves a group item hit to the group real parent and an insert index', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const point = firstItemCenter(group)

  const target = resolveDropTarget(graph, layout, point, 'feeder-1')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'heap-1')
  assert.equal(target.group.id, group.id)
  assert.equal(target.insertIndex, 0)
})

test('resolveDropTarget rejects dropping a node onto itself or its own descendant', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const selfRect = layout.nodes.get('grid-tie')
  const descendantRect = layout.nodes.get('feeder-1')

  assert.equal(
    resolveDropTarget(graph, layout, { x: selfRect.x + 1, y: selfRect.y + 1 }, 'grid-tie').valid,
    false,
  )
  assert.equal(
    resolveDropTarget(graph, layout, { x: descendantRect.x + 1, y: descendantRect.y + 1 }, 'grid-tie').valid,
    false,
  )
})

test('resolveDropTarget returns invalid for a miss or a group header hit', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const headerPoint = { x: group.x + 5, y: group.y + 5 }

  assert.equal(resolveDropTarget(graph, layout, { x: -9999, y: -9999 }, 'feeder-1').valid, false)
  assert.equal(resolveDropTarget(graph, layout, headerPoint, 'feeder-1').valid, false)
})

test('edgePanVelocity returns nonzero velocity only near container edges', () => {
  assert.deepEqual(edgePanVelocity({ x: 400, y: 300 }, 800, 600), { x: 0, y: 0 })
  assert.ok(edgePanVelocity({ x: 2, y: 300 }, 800, 600).x < 0)
  assert.ok(edgePanVelocity({ x: 798, y: 300 }, 800, 600).x > 0)
  assert.ok(edgePanVelocity({ x: 400, y: 2 }, 800, 600).y < 0)
  assert.ok(edgePanVelocity({ x: 400, y: 598 }, 800, 600).y > 0)
})

test('edgePanVelocity scales toward maxSpeed at the very edge', () => {
  const atEdge = edgePanVelocity({ x: 0, y: 300 }, 800, 600, 24, 12)
  const nearEdge = edgePanVelocity({ x: 20, y: 300 }, 800, 600, 24, 12)
  assert.ok(Math.abs(atEdge.x) > Math.abs(nearEdge.x))
  assert.ok(Math.abs(atEdge.x) <= 12)
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- test/minimap-interaction.test.js`

Expected: FAIL — `resolveDropTarget` and `edgePanVelocity` are not exported yet.

- [ ] **Step 3: Implement `resolveDropTarget` and `edgePanVelocity`**

In `src/minimap/interaction.js`, add at the end of the file:

```js
function isNodeOrDescendant(graph, nodeId, candidateId) {
  let current = candidateId
  while (current) {
    if (current === nodeId) return true
    current = graph.nodes.get(current)?.parentId ?? null
  }
  return false
}

// 拖拽悬停目标解析：命中分组框 item 时返回真实父节点 + 该分组 + 组内插入下标；
// 命中普通节点时该节点本身就是新的目标父节点，不计算插入下标（追加到末尾）；
// 命中分组框 header、命中空白、或目标是被拖节点自己/其后代时，返回 invalid。
export function resolveDropTarget(graph, layout, point, draggedNodeId) {
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
    const parentId = hit.id
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    return { valid: true, parentId, group: null, insertIndex: null }
  }

  return { valid: false }
}

// 屏幕坐标点靠近容器边缘时返回应叠加的视口平移速度；中心区域返回 {x:0, y:0}。
export function edgePanVelocity(screenPoint, containerWidth, containerHeight, edgeZone = 24, maxSpeed = 12) {
  const axisVelocity = (coord, size) => {
    if (coord < edgeZone) return -maxSpeed * Math.min(1, (edgeZone - coord) / edgeZone)
    if (coord > size - edgeZone) return maxSpeed * Math.min(1, (coord - (size - edgeZone)) / edgeZone)
    return 0
  }
  return {
    x: axisVelocity(screenPoint.x, containerWidth),
    y: axisVelocity(screenPoint.y, containerHeight),
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- test/minimap-interaction.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/interaction.js test/minimap-interaction.test.js
git commit -m "feat: add cross-canvas drop target resolution and edge-pan velocity"
```

---

### Task 4: Relocate Drag Ghost Rendering

**Files:**
- Modify: `src/minimap/renderer.js`
- Modify: `test/minimap-renderer.test.js`

**Interfaces:**
- Consumes: `state.groupDrag` shape unchanged: `{ groupId, order, draggingChildId, ghostRect, childRectsById, dropSlotOpacity }`. `groupId` may now legitimately be `null` (no group is the current drop target).
- No change to any exported function signature — this task only moves where, inside `renderer.js`, the ghost gets drawn.

- [ ] **Step 1: Write a failing test for the new capability**

Append to `test/minimap-renderer.test.js`:

```js
test('renderScene draws a node drag ghost even when no group is the active drop target', () => {
  const ctx = createMockCtx()
  const scene = demoScene()
  const draggingNodeId = 'feeder-1'
  const ghostRect = { x: 420, y: 180, width: 160, height: 34 }

  renderScene(ctx, {
    ...scene,
    state: {
      groupDrag: {
        groupId: null,
        order: null,
        draggingChildId: draggingNodeId,
        ghostRect,
        childRectsById: null,
        dropSlotOpacity: 1,
      },
    },
  })

  const draggedNode = scene.graph.nodes.get(draggingNodeId)
  const draggedLabelCalls = ctx.methodsOf('fillText').filter((call) => call.args[0] === draggedNode.label)
  assert.equal(draggedLabelCalls.length, 1)
  assert.deepEqual(draggedLabelCalls[0].args.slice(1), [ghostRect.x + 10, ghostRect.y + ghostRect.height / 2])
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- test/minimap-renderer.test.js`

Expected: FAIL — with `groupId: null`, no group's `drawGroupChildren` call matches `state.groupDrag.groupId === group.id`, so today nothing draws the ghost and `draggedLabelCalls.length` is `0`.

- [ ] **Step 3: Move the ghost drawing to a top-level function**

In `src/minimap/renderer.js`, inside `drawGroupChildren`, remove this block (it currently sits right before the function's final `ctx.restore()`):

```js
  if (dragContext) {
    const node = graph.nodes.get(dragContext.draggingChildId)
    if (node) {
      const itemState = { ...makeState(dragContext.draggingChildId, selectedIds, highlightedIds, dimmedIds), dragging: true }
      const previousAlpha = ctx.globalAlpha ?? 1
      ctx.globalAlpha = 0.85
      if (renderers.node) renderers.node(ctx, { node, rect: dragContext.ghostRect, state: itemState, theme, viewport })
      else drawNode(ctx, node, dragContext.ghostRect, itemState, theme)
      ctx.globalAlpha = previousAlpha
    }
  }
```

`drawGroupChildren` keeps everything else (the clip, the visible-children loop, the drop-slot rendering) unchanged — only this ghost block is removed.

Add a new function directly above `// --- 入口 ---`:

```js
function drawNodeDragGhost(ctx, graph, nodeDrag, theme, renderers, viewport, selectedIds, highlightedIds, dimmedIds) {
  const node = graph.nodes.get(nodeDrag.draggingChildId)
  if (!node) return
  const itemState = { ...makeState(nodeDrag.draggingChildId, selectedIds, highlightedIds, dimmedIds), dragging: true }
  const previousAlpha = ctx.globalAlpha ?? 1
  ctx.globalAlpha = 0.85
  if (renderers.node) renderers.node(ctx, { node, rect: nodeDrag.ghostRect, state: itemState, theme, viewport })
  else drawNode(ctx, node, nodeDrag.ghostRect, itemState, theme)
  ctx.globalAlpha = previousAlpha
}
```

In `renderScene`, directly after the loop that draws plain `node` items (the `for (const { item, screen } of items) { if (item.type !== 'node') continue ... }` loop) and before `if (state.selectionRect) drawSelectionRect(...)`, add:

```js
  if (state.groupDrag) {
    drawNodeDragGhost(ctx, graph, state.groupDrag, theme, renderers, viewport, selectedIds, highlightedIds, dimmedIds)
  }
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- test/minimap-renderer.test.js`

Expected: PASS, including the two pre-existing drag-ghost tests (`'drawGroupChildren in drag mode uses animated child rects and drop slot opacity'` and `'drawGroupChildren in drag mode draws a drop slot and a single ghost for the dragged child'`) and the regression test (`'drawGroupChildren without drag or scrollbar hover context behaves exactly like before (regression)'`) — none of these three need any edits; they assert on `renderScene`'s overall output, which is unchanged by this relocation.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/renderer.js test/minimap-renderer.test.js
git commit -m "feat: render drag ghost independently of the active group target"
```

---

### Task 5: Drag Initiation, Live Target Tracking, And Dispatch Routing

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Create: `test/minimap-node-move.test.js`

**Interfaces:**
- Consumes: `resolveDropTarget`/`edgePanVelocity` not yet wired in this task (edge-pan is Task 6) — only `resolveDropTarget` from Task 3, `buildVirtualOrder`/`childWorldRectsById` from Task 2, `move-node` operation from Task 1.
- Produces: new prop `beforeNodeMove`, new event `node-move`. `dragState.nodeId`/`fromParentId`/`targetParentId`/`targetGroupId`/`insertIndex` replace the old `dragState.groupId`/`childId`.

**Regression requirement:** this task rewrites the shared pointer-handling functions that `test/minimap-group-interaction.test.js` already covers. That file must not be edited and must keep passing in full — it is this task's regression safety net.

- [ ] **Step 1: Read the current pointer-handling code**

Open `src/minimap/Minimap.vue` and locate (read, do not edit yet): `handlePointerDown`, `handlePointerMove`, `handlePointerUp`, `updateDragInsertion`, `beginDragVisuals`, `scheduleDragShift`, `dragRenderContext`, `shouldAutoScroll`, `startAutoScrollLoop`, `ensureAutoScrollLoop`, `cancelAutoScrollLoop`, `cancelDrag`. Confirm their current content matches what this task's steps describe replacing — line numbers will have shifted from earlier tasks' unrelated edits, but the code bodies should match exactly (none of Tasks 1-4 touched this file).

- [ ] **Step 2: Write failing tests in a new file**

Create `test/minimap-node-move.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, GROUP } from '../src/minimap/layout.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

const LAYOUT_OPTS = { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 }

function dispatchPointerDown(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
}

function dispatchPointerMove(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointermove', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
}

function dispatchPointerUp(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerup', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
}

function nodeCenter(layout, nodeId) {
  const rect = layout.nodes.get(nodeId)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function firstItemCenter(group) {
  return {
    x: group.x + GROUP.padding + GROUP.itemW / 2,
    y: group.y + GROUP.header + GROUP.padding + GROUP.itemH / 2,
  }
}

test('dragging a plain node onto another plain node makes it the new parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'feeder-2')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(graph.nodes.get('feeder-2').children.includes('feeder-1'), true)
  assert.equal(wrapper.emitted('node-move').length, 1)
  assert.equal(wrapper.emitted('node-move')[0][0].nodeId, 'feeder-1')
  assert.equal(wrapper.emitted('node-move')[0][0].fromParentId, 'grid-tie')
  assert.equal(wrapper.emitted('node-move')[0][0].toParentId, 'feeder-2')
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'move-node')

  wrapper.vm.undo()
  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  wrapper.destroy()
})

test('dragging a node into a different group than its origin moves it under that group real parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const targetGroup = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = firstItemCenter(targetGroup)

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'heap-1')
  assert.equal(graph.nodes.get('heap-1').children[0], 'feeder-1')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(wrapper.emitted('node-move').length, 1)
  wrapper.destroy()
})

test('dragging an ungrouped sibling onto another ungrouped sibling reorders within the same parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-3')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('node-move'), undefined)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'reorder-group-child')
  wrapper.destroy()
})

test('dragging a node onto its own descendant does not move it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'grid-tie')
  const to = nodeCenter(layout, 'feeder-1')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('grid-tie').parentId, 'energy-root')
  assert.equal(wrapper.emitted('node-move'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('readonly and beforeNodeMove block cross-parent moves', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const readonlyWrapper = mount(Minimap, { propsData: { graph, readonly: true } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(readonlyWrapper, from)
  dispatchPointerMove(readonlyWrapper, to)
  dispatchPointerUp(readonlyWrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  readonlyWrapper.destroy()

  const blockedGraph = createDemoGraph()
  const blockedWrapper = mount(Minimap, {
    propsData: { graph: blockedGraph, beforeNodeMove: () => false },
  })
  const blockedFrom = nodeCenter(layout, 'feeder-1')
  const blockedTo = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(blockedWrapper, blockedFrom)
  dispatchPointerMove(blockedWrapper, blockedTo)
  dispatchPointerUp(blockedWrapper, blockedTo)

  assert.equal(blockedGraph.nodes.get('feeder-1').parentId, 'grid-tie')
  blockedWrapper.destroy()
})

test('clicking a plain node without moving still selects it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const point = nodeCenter(layout, 'feeder-1')
  dispatchPointerDown(wrapper, point)
  dispatchPointerUp(wrapper, point)

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])
  assert.equal(wrapper.emitted('node-move'), undefined)
  wrapper.destroy()
})
```

- [ ] **Step 3: Run the new test file and verify it fails**

Run: `npm test -- test/minimap-node-move.test.js`

Expected: FAIL — plain-node dragging does not yet move anything, and `beforeNodeMove`/`node-move` do not exist.

- [ ] **Step 4: Add the new prop and event**

In `src/minimap/Minimap.vue`, add `beforeNodeMove` to `defineProps` directly after `beforeImport`:

```js
  beforeImport: { type: Function, default: null },
  beforeNodeMove: { type: Function, default: null },
```

Add `'node-move'` to `defineEmits`, directly after `'paste'`:

```js
  'paste',
  'node-move',
```

- [ ] **Step 5: Rewrite `handlePointerDown`'s drag-initiation branch**

Replace this block (currently the only branch that starts a drag):

```js
  if (hit?.type === 'group' && hit.zone === 'item') {
    canvasRef.value.setPointerCapture?.(event.pointerId)
    dragState = {
      groupId: hit.id,
      childId: hit.childId,
      additive: isAdditiveSelection(event),
      startScreen: { x: event.clientX, y: event.clientY },
      dragging: false,
      insertIndex: 0,
      ghostWorldPoint: null,
      ghostScreenRect: null,
      scrollRafId: null,
      shiftFromById: null,
      shiftToById: null,
      shiftStartedAt: null,
      slotFadeStartedAt: null,
      shiftRafId: null,
    }
    return
  }
```

with:

```js
  if ((hit?.type === 'group' && hit.zone === 'item') || hit?.type === 'node') {
    const nodeId = hit.type === 'group' ? hit.childId : hit.id
    const node = props.graph.nodes.get(nodeId)
    if (!node) return
    canvasRef.value.setPointerCapture?.(event.pointerId)
    dragState = {
      nodeId,
      fromParentId: node.parentId,
      additive: isAdditiveSelection(event),
      startScreen: { x: event.clientX, y: event.clientY },
      dragging: false,
      targetParentId: null,
      targetGroupId: null,
      insertIndex: 0,
      ghostWorldPoint: null,
      ghostScreenRect: null,
      lastScreenPoint: null,
      scrollRafId: null,
      shiftFromById: null,
      shiftToById: null,
      shiftStartedAt: null,
      slotFadeStartedAt: null,
      shiftRafId: null,
    }
    return
  }
```

Everything else in `handlePointerDown` (the scrollbar branch, the group-header branch, the no-hit branch, and the final `setSelected(...)` fallthrough line) stays exactly as-is — the final fallthrough line is now only reached for `hit.type === 'group' && hit.zone === 'body'` (clicking blank space inside a group still selects the group itself, unchanged).

- [ ] **Step 6: Replace `updateDragInsertion`/`beginDragVisuals` with `updateDragTarget`**

Delete `updateDragInsertion` and `beginDragVisuals` entirely (their current bodies):

```js
function updateDragInsertion(group, worldPoint, { animateShift = true } = {}) {
  const restGroup = { ...group, children: group.children.filter((id) => id !== dragState.childId) }
  const nextIndex = groupGridIndexAt(restGroup, worldPoint)
  const autoScrolling = shouldAutoScroll(group)
  const canAnimateShift = animateShift && !autoScrolling

  if (nextIndex !== dragState.insertIndex) {
    if (canAnimateShift) scheduleDragShift(group, nextIndex)
    else clearDragShiftAnimation()
    dragState.insertIndex = nextIndex
  } else if (autoScrolling) {
    clearDragShiftAnimation()
  }

  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
}
```

```js
function beginDragVisuals(group) {
  const toOrder = buildVirtualOrder(group, dragState.childId, dragState.insertIndex)
  dragState.shiftFromById = childWorldRectsById(group, group.children)
  dragState.shiftToById = childWorldRectsById(group, toOrder)
  dragState.shiftStartedAt = now()
  dragState.slotFadeStartedAt = now()
}
```

Add `updateDragTarget` in their place:

```js
function updateDragTarget(worldPoint) {
  const target = resolveDropTarget(props.graph, layout, worldPoint, dragState.nodeId)
  const previousGroupId = dragState.targetGroupId
  const previousIndex = dragState.insertIndex

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
    dragState.insertIndex = 0
  }

  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
}
```

Add `resolveDropTarget` to the existing `interaction.js` import line:

```js
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
  resolveDropTarget,
} from './interaction.js'
```

- [ ] **Step 7: Update `scheduleDragShift` to accept a `reset` option and the new array-based `buildVirtualOrder`**

Replace:

```js
function scheduleDragShift(group, insertIndex) {
  const timestamp = now()
  const fromById =
    dragState.shiftFromById && dragState.shiftToById && dragState.shiftStartedAt != null
      ? currentShiftRects(
          dragState.shiftFromById,
          dragState.shiftToById,
          dragState.shiftStartedAt,
          DRAG_SHIFT_DURATION_MS,
          timestamp,
        )
      : childWorldRectsById(group, group.children)
  const toOrder = buildVirtualOrder(group, dragState.childId, insertIndex)
  dragState.shiftFromById = fromById
  dragState.shiftToById = childWorldRectsById(group, toOrder)
  dragState.shiftStartedAt = timestamp
}
```

with:

```js
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
```

- [ ] **Step 8: Rewrite `dragRenderContext` to resolve the current target group by id**

Replace:

```js
function dragRenderContext() {
  if (!dragState || !dragState.dragging || !layout) return null
  const group = layout.groups.find((g) => g.id === dragState.groupId)
  if (!group) return null
  const order = buildVirtualOrder(group, dragState.childId, dragState.insertIndex)
  const timestamp = now()
  const autoScrolling = shouldAutoScroll(group)
  const childRectsById =
    !autoScrolling &&
    dragState.shiftFromById &&
    dragState.shiftToById &&
    dragState.shiftStartedAt != null
      ? currentShiftRects(
          dragState.shiftFromById,
          dragState.shiftToById,
          dragState.shiftStartedAt,
          DRAG_SHIFT_DURATION_MS,
          timestamp,
        )
      : null
  const dropSlotOpacity =
    autoScrolling || dragState.slotFadeStartedAt == null
      ? 1
      : dragShiftEasedProgress(dragState.slotFadeStartedAt, DRAG_SHIFT_DURATION_MS, timestamp)
  return {
    groupId: group.id,
    order,
    draggingChildId: dragState.childId,
    ghostRect: dragState.ghostScreenRect,
    childRectsById,
    dropSlotOpacity,
  }
}
```

with:

```js
function dragRenderContext() {
  if (!dragState || !dragState.dragging || !layout) return null
  const timestamp = now()
  const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
  if (!group) {
    return {
      groupId: null,
      order: null,
      draggingChildId: dragState.nodeId,
      ghostRect: dragState.ghostScreenRect,
      childRectsById: null,
      dropSlotOpacity: 1,
    }
  }
  const order = buildVirtualOrder(group.children, dragState.nodeId, dragState.insertIndex)
  const autoScrolling = shouldAutoScroll(group)
  const childRectsById =
    !autoScrolling &&
    dragState.shiftFromById &&
    dragState.shiftToById &&
    dragState.shiftStartedAt != null
      ? currentShiftRects(
          dragState.shiftFromById,
          dragState.shiftToById,
          dragState.shiftStartedAt,
          DRAG_SHIFT_DURATION_MS,
          timestamp,
        )
      : null
  const dropSlotOpacity =
    autoScrolling || dragState.slotFadeStartedAt == null
      ? 1
      : dragShiftEasedProgress(dragState.slotFadeStartedAt, DRAG_SHIFT_DURATION_MS, timestamp)
  return {
    groupId: group.id,
    order,
    draggingChildId: dragState.nodeId,
    ghostRect: dragState.ghostScreenRect,
    childRectsById,
    dropSlotOpacity,
  }
}
```

- [ ] **Step 9: Update `shouldAutoScroll`/`startAutoScrollLoop` to use the current target group**

Replace:

```js
function shouldAutoScroll(group) {
  return group && dragState?.ghostWorldPoint && groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y) !== 0
}
```

with (unchanged — `shouldAutoScroll` already takes `group` as a parameter, it just now gets called with `dragState.targetGroup`-resolved groups instead of a fixed origin group; no edit needed here).

Replace:

```js
function startAutoScrollLoop() {
  const tick = (time) => {
    if (!dragState || !dragState.dragging) return
    const group = layout.groups.find((g) => g.id === dragState.groupId)
    if (group && dragState.ghostWorldPoint) {
      const delta = groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y)
      if (delta !== 0) {
        group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)
        clearDragShiftAnimation()
        updateDragInsertion(group, dragState.ghostWorldPoint, { animateShift: false })
      }
    }
    renderCurrent()
    const timestamp = time ?? now()
    const scrolling = shouldAutoScroll(group)
    if (scrolling || dragShiftActive(timestamp)) dragState.scrollRafId = requestAnimationFrame(tick)
    else dragState.scrollRafId = null
  }
  dragState.scrollRafId = requestAnimationFrame(tick)
}
```

with:

```js
function startAutoScrollLoop() {
  const tick = (time) => {
    if (!dragState || !dragState.dragging) return
    const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
    if (group && dragState.ghostWorldPoint) {
      const delta = groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y)
      if (delta !== 0) {
        group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)
        clearDragShiftAnimation()
        updateDragTarget(dragState.ghostWorldPoint)
      }
    }
    renderCurrent()
    const timestamp = time ?? now()
    const scrolling = shouldAutoScroll(group)
    if (scrolling || dragShiftActive(timestamp)) dragState.scrollRafId = requestAnimationFrame(tick)
    else dragState.scrollRafId = null
  }
  dragState.scrollRafId = requestAnimationFrame(tick)
}
```

Replace:

```js
function ensureAutoScrollLoop() {
  if (!dragState?.dragging || dragState.scrollRafId != null) return
  const group = layout?.groups.find((g) => g.id === dragState.groupId)
  if (!shouldAutoScroll(group) && !dragShiftActive()) return
  startAutoScrollLoop()
}
```

with:

```js
function ensureAutoScrollLoop() {
  if (!dragState?.dragging || dragState.scrollRafId != null) return
  const group = dragState.targetGroupId ? layout?.groups.find((g) => g.id === dragState.targetGroupId) : null
  if (!shouldAutoScroll(group) && !dragShiftActive()) return
  startAutoScrollLoop()
}
```

- [ ] **Step 10: Rewrite `handlePointerMove`'s dragging branch**

Replace:

```js
  if (!dragState) {
    const scrollbarHit = hitScrollbarThumb(pointFromEvent(event))
    updateScrollbarHover(scrollbarHit?.group.id ?? null)
    return
  }
  const screenPoint = { x: event.clientX, y: event.clientY }
  const group = layout.groups.find((g) => g.id === dragState.groupId)
  if (!group) return
  const worldPoint = pointFromEvent(event)

  if (!dragState.dragging) {
    if (!exceedsDragThreshold(dragState.startScreen, screenPoint)) return
    dragState.dragging = true
    updateDragInsertion(group, worldPoint)
    beginDragVisuals(group)
    ensureAutoScrollLoop()
  } else {
    updateDragInsertion(group, worldPoint)
  }

  renderCurrent()
  ensureAutoScrollLoop()
  if (dragShiftActive()) ensureDragShiftLoop()
```

with:

```js
  if (!dragState) {
    const scrollbarHit = hitScrollbarThumb(pointFromEvent(event))
    updateScrollbarHover(scrollbarHit?.group.id ?? null)
    return
  }
  const screenPoint = { x: event.clientX, y: event.clientY }
  const worldPoint = pointFromEvent(event)
  dragState.lastScreenPoint = screenPoint

  if (!dragState.dragging) {
    if (!exceedsDragThreshold(dragState.startScreen, screenPoint)) return
    dragState.dragging = true
    dragState.slotFadeStartedAt = now()
    ensureAutoScrollLoop()
  }

  updateDragTarget(worldPoint)
  renderCurrent()
  ensureAutoScrollLoop()
  if (dragShiftActive()) ensureDragShiftLoop()
```

(The scrollbar/marquee/pan branches above this in `handlePointerMove` are untouched.)

- [ ] **Step 11: Rewrite `handlePointerUp`'s dragging branch**

Replace:

```js
  if (!dragState) return

  if (dragState.dragging) {
    cancelAutoScrollLoop()
    cancelDragShiftLoop()
    const group = layout.groups.find((g) => g.id === dragState.groupId)
    if (group) {
      const parent = props.graph.nodes.get(group.parentId)
      const index = groupInsertIndexToParentIndex(parent, group, dragState.childId, dragState.insertIndex)
      const operation = {
        type: 'reorder-group-child',
        payload: { groupId: group.id, parentId: group.parentId, childId: dragState.childId, index },
      }
      const result = graphOperations().apply(operation, {
        readonly: props.readonly,
        before: props.beforeGroupReorder,
      })
      if (result.applied) {
        updateGroupState(group.id, { scrollTop: group.scrollTop })
        updateLayout()
        emit('group-reorder', {
          groupId: group.id,
          childId: dragState.childId,
          index: result.operation.payload.index,
        })
        emitChange(result)
      } else {
        renderCurrent()
      }
    }
  } else {
    setSelected(applySelectionClick(currentSelectedIds(), dragState.childId, { additive: dragState.additive }))
  }

  dragState = null
```

with:

```js
  if (!dragState) return

  if (dragState.dragging) {
    cancelAutoScrollLoop()
    cancelDragShiftLoop()
    if (dragState.targetParentId) {
      const parent = props.graph.nodes.get(dragState.targetParentId)
      const targetGroup = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
      const index = targetGroup
        ? groupInsertIndexToParentIndex(parent, targetGroup, dragState.nodeId, dragState.insertIndex)
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
        const result = graphOperations().apply(operation, {
          readonly: props.readonly,
          before: props.beforeGroupReorder,
        })
        if (result.applied) {
          if (targetGroup) updateGroupState(targetGroup.id, { scrollTop: targetGroup.scrollTop })
          updateLayout()
          emit('group-reorder', {
            groupId: dragState.targetGroupId,
            childId: dragState.nodeId,
            index: result.operation.payload.index,
          })
          emitChange(result)
        } else {
          renderCurrent()
        }
      } else {
        const operation = {
          type: 'move-node',
          payload: { nodeId: dragState.nodeId, toParentId: dragState.targetParentId, index },
        }
        const result = graphOperations().apply(operation, {
          readonly: props.readonly,
          before: props.beforeNodeMove,
        })
        if (result.applied) {
          updateLayout()
          emit('node-move', {
            nodeId: dragState.nodeId,
            fromParentId: dragState.fromParentId,
            toParentId: dragState.targetParentId,
            index: result.operation.payload.index,
          })
          emitChange(result)
        } else {
          renderCurrent()
        }
      }
    } else {
      renderCurrent()
    }
  } else {
    setSelected(applySelectionClick(currentSelectedIds(), dragState.nodeId, { additive: dragState.additive }))
  }

  dragState = null
```

- [ ] **Step 12: Run the new test file and verify it passes**

Run: `npm test -- test/minimap-node-move.test.js`

Expected: PASS.

- [ ] **Step 13: Run the full existing group-interaction suite and confirm zero regressions**

Run: `npm test -- test/minimap-group-interaction.test.js`

Expected: PASS, every test unmodified and green — this is the regression check for this task's rewrite.

- [ ] **Step 14: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-node-move.test.js
git commit -m "feat: support cross-parent node dragging with live target resolution"
```

---

### Task 6: Edge-Of-Canvas Auto-Pan During Drag

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-node-move.test.js`

**Interfaces:**
- Consumes: `edgePanVelocity` from Task 3, `dragState.lastScreenPoint`/`dragState.dragging`/`cancelDrag` from Task 5.

- [ ] **Step 1: Write a failing test**

Append to `test/minimap-node-move.test.js`:

```js
test('dragging near the canvas edge pans the viewport', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, { x: 795, y: 300 })

  // handlePointerMove schedules both the existing auto-scroll/slot-fade RAF loop
  // and the new edge-pan RAF loop on this first move past the drag threshold;
  // drain several frames so the edge-pan tick (whichever order it lands in) runs.
  for (let i = 0; i < 5; i++) frames.runNext(16 * (i + 1))

  assert.equal(wrapper.emitted('viewport-change').length > 0, true)
  const lastViewport = wrapper.emitted('viewport-change').at(-1)[0]
  assert.notEqual(lastViewport.x, 0)

  dispatchPointerUp(wrapper, { x: 795, y: 300 })
  wrapper.destroy()
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- test/minimap-node-move.test.js`

Expected: FAIL — no `viewport-change` is emitted yet for an edge-adjacent drag.

- [ ] **Step 3: Import `edgePanVelocity` and add the edge-pan loop**

Add `edgePanVelocity` to the existing `interaction.js` import line in `src/minimap/Minimap.vue` (the one updated in Task 5):

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

Add `edgePanRafId: null` to the `dragState` object literal created in `handlePointerDown` (directly after `scrollRafId: null,`):

```js
      scrollRafId: null,
      edgePanRafId: null,
```

Add these two functions directly after `ensureAutoScrollLoop`:

```js
function edgePanActive() {
  if (!dragState?.dragging || !dragState.lastScreenPoint) return false
  const velocity = edgePanVelocity(dragState.lastScreenPoint, cssWidth, cssHeight)
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
    const velocity = edgePanVelocity(dragState.lastScreenPoint, cssWidth, cssHeight)
    if (velocity.x !== 0 || velocity.y !== 0) {
      applyViewport(panViewportBy(currentViewport(), { x: -velocity.x, y: -velocity.y }, viewportOptions(props.options)))
      updateDragTarget(screenToWorld(dragState.lastScreenPoint, currentViewport()))
      renderCurrent()
    }
    if (edgePanActive()) dragState.edgePanRafId = requestAnimationFrame(tick)
    else dragState.edgePanRafId = null
  }
  dragState.edgePanRafId = requestAnimationFrame(tick)
}
```

Call `ensureEdgePanLoop()` in `handlePointerMove`'s dragging branch, directly after `ensureAutoScrollLoop()` (the second, unconditional call added in Task 5 Step 10):

```js
  updateDragTarget(worldPoint)
  renderCurrent()
  ensureAutoScrollLoop()
  ensureEdgePanLoop()
  if (dragShiftActive()) ensureDragShiftLoop()
```

Extend `cancelDrag` to also cancel the edge-pan loop. Replace:

```js
function cancelDrag() {
  if (!dragState) return
  cancelAutoScrollLoop()
  cancelDragShiftLoop()
  dragState = null
  renderCurrent()
}
```

with:

```js
function cancelDrag() {
  if (!dragState) return
  cancelAutoScrollLoop()
  cancelDragShiftLoop()
  cancelEdgePanLoop()
  dragState = null
  renderCurrent()
}
```

Extend `handlePointerUp`'s dragging branch to also cancel the edge-pan loop, alongside the existing `cancelAutoScrollLoop()`/`cancelDragShiftLoop()` calls added in Task 5 Step 11:

```js
  if (dragState.dragging) {
    cancelAutoScrollLoop()
    cancelDragShiftLoop()
    cancelEdgePanLoop()
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- test/minimap-node-move.test.js`

Expected: PASS.

- [ ] **Step 5: Run the full group-interaction regression suite again**

Run: `npm test -- test/minimap-group-interaction.test.js`

Expected: PASS — confirms the edge-pan addition does not interfere with existing group-internal drag behavior (the auto-scroll test fixtures keep the pointer well within the canvas, away from the edge zone, so `edgePanActive()` stays false throughout).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-node-move.test.js
git commit -m "feat: auto-pan the viewport when dragging near the canvas edge"
```

---

### Task 7: Roadmap And Full Verification

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Run full verification**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Update `ROADMAP.md`**

Set current phase:

```md
- **当前阶段**：第五阶段切片 4 —— 组件状态与可访问性
- **当前阶段 Spec**：待创建；`loading`/空图/`error` 状态、`error` 事件、`options.keyboard` 开关、aria 状态区域
- **当前阶段计划**：待创建；spec 确认后写第五阶段切片 4 implementation plan
```

Mark slice 3 complete:

```md
  - [x] 切片 3：节点跨父级拖拽移动与排序（任意真实节点都可拖到另一个父节点下面变成其子节点；目标父节点跟起点父节点相同时退化为现有 `reorder-group-child`（含未分组兄弟互拖新场景）；新增 `move-node` operation 处理跨父级移动，复用整图快照回滚做 undo/redo；悬停分组框 item 时复用并泛化让位动画，悬停普通节点时只高亮；拖近画布边缘自动平移视口；`beforeNodeMove`/`beforeGroupReorder`/`readonly` 拦截；[spec](docs/superpowers/specs/2026-06-20-phase-5-cross-parent-move.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-cross-parent-move.md)，`npm test` 与 `npm run build` 通过）
```

Set next step:

```md
- **下一步**：创建第五阶段切片 4「组件状态与可访问性」spec 和 plan。
```

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark phase 5 slice 3 complete"
```

---

## Self-Review Checklist

- Spec coverage:
  - Any node draggable, drop target becomes new parent: Task 5.
  - Same real parent falls back to `reorder-group-child` (including ungrouped siblings): Task 5.
  - New `move-node` for cross-parent moves, snapshot-based undo/redo: Task 1, Task 5.
  - Cycle prevention (live, during drag, and inside the operation): Task 3 (`resolveDropTarget`), Task 1 (`applyMoveNode`).
  - Rich shift-preview for group targets, simple highlight for plain-node targets: Task 2 (generalized math), Task 4 (ghost relocation), Task 5 (wiring).
  - Edge-of-canvas auto-pan: Task 6.
  - `readonly`/`beforeNodeMove`/`beforeGroupReorder`: Task 1, Task 5.
  - Root nodes draggable in, not draggable out to become new roots: Task 1 (`applyMoveNode` only ever sets a real `toParentId`; no operation path produces a new root).
- Scope guard (per spec's 范围外):
  - No "drag out to become new root" interaction added anywhere.
  - No `options.drag.*` configuration added.
  - No tree-relayout-based precise shift-preview for ungrouped targets — only a highlight.
  - No cross-instance dragging.
- Regression guard:
  - `test/minimap-group-interaction.test.js` is never edited and must pass in full after Task 5 and Task 6 (explicit verification steps in both).
- Verification:
  - Focused tests after each task.
  - Full `npm test` and `npm run build` before marking the slice complete (Task 7).
