# 性能优化切片 3：空间索引接入 hitTest / 框选查询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the linear scans inside `hitTest` and `idsInSelectionRect` with a grid-backed spatial index so neither scales with total node count, without changing either function's public signature or behavior.

**Architecture:** New pure module `interaction/spatial-index.js` buckets `layout.visibleItems` (top-level node/group-box rects only) into a fixed-size grid; a `WeakMap`-memoized accessor keyed by the `layout` object reuses the same index across repeated queries and naturally invalidates whenever `computeLayout()` produces a new `layout`. `hitTest` and `idsInSelectionRect` swap their internals to query this index; callers are untouched.

**Tech Stack:** Plain JS (no Vue/DOM dependency), Node test runner (`node:test` + `node:assert/strict`), existing `createDemoGraph`/`computeLayout` test fixtures.

## Global Constraints

- No new runtime dependencies (project rule: no third-party spatial index library; fixed-size grid bucket only).
- `hitTest(layout, point)` and `idsInSelectionRect(layout, screenRect, viewport)` signatures and return shapes must not change — all 5 existing call sites (`drag-controller.js` ×4, `context-menu-controller.js` ×1) and existing tests must keep passing unmodified.
- No render-time viewport culling (`queryViewport`) in this slice — out of scope, deferred to the slice-4 cache design.
- No timing-based/benchmark test assertions — only correctness assertions (per project testing conventions: avoid brittle assertions, prefer state/count checks).
- `npm test` and `npm run build` must both pass before this slice is done.

Spec: [docs/superpowers/specs/2026-06-22-spatial-index-design.md](../specs/2026-06-22-spatial-index-design.md)

---

## File Structure

- Create `src/minimap/interaction/spatial-index.js`
  - Pure grid index: `buildSpatialIndex`, `queryPoint`, `queryRect`, plus memoized `getSpatialIndex`.
  - No Vue/DOM/render dependency.
- Create `test/minimap-spatial-index.test.js`
  - Unit coverage for bucketing, point/rect queries, memoization.
- Modify `src/minimap/coords/coords.js`
  - Add `screenRectToWorld`, the rect-level inverse of `screenToWorld`.
- Modify `test/minimap-coords.test.js`
  - Coverage for `screenRectToWorld`, including a reversed-rect case.
- Modify `src/minimap/coords/README.md`
  - Add `screenRectToWorld` to the `coords.js` row.
- Modify `src/minimap/interaction/interaction.js`
  - `hitTest` internals swap to `queryPoint(getSpatialIndex(layout), point)`.
- Modify `test/minimap-interaction.test.js`
  - Add a regression case with items spread across distant grid cells.
- Modify `src/minimap/interaction/selection.js`
  - `idsInSelectionRect` internals swap to query the index in world space, then expand only the groups that matched.
- Modify `test/minimap-selection.test.js`
  - Add regression cases for "marquee never touches the group box" and "marquee only grazes a corner of the group box".
- Modify `src/minimap/interaction/README.md`
  - Add `spatial-index.js` to the file table; fix the now-stale `worldRectToScreen` dependency note; add `coords/coords.js` to allowed imports.
- Modify `ROADMAP.md`
  - Add 切片 3 entry under 性能优化切片.

## Task 1: Spatial Index Module

**Files:**
- Create: `src/minimap/interaction/spatial-index.js`
- Create: `test/minimap-spatial-index.test.js`

**Interfaces:**
- Produces: `buildSpatialIndex(layout, { cellWidth, cellHeight } = {}) -> { cellWidth, cellHeight, buckets: Map<string, item[]> }`, `queryPoint(index, point) -> item | null`, `queryRect(index, rect) -> item[]`, `getSpatialIndex(layout) -> index` (memoized). `item` here is whatever shape `layout.visibleItems` entries have (`{ type, id, x, y, width, height, ... }`) — passed through unchanged.

- [ ] **Step 1: Write failing spatial-index tests**

Create `test/minimap-spatial-index.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSpatialIndex, queryPoint, queryRect, getSpatialIndex } from '../src/minimap/interaction/spatial-index.js'

// 默认网格 256x128；三个 item 故意分散到互不相邻的网格单元，
// 用来验证查询只命中各自所在的 bucket，不会漏检或跨格误检。
function sampleLayout() {
  return {
    visibleItems: [
      { type: 'node', id: 'origin-node', x: 0, y: 0, width: 100, height: 40 },
      { type: 'group', id: 'mid-group', x: 500, y: 500, width: 200, height: 200 },
      { type: 'node', id: 'far-node', x: 2000, y: 1500, width: 100, height: 40 },
    ],
  }
}

test('buildSpatialIndex buckets items by the grid cells their rect overlaps', () => {
  const index = buildSpatialIndex(sampleLayout())
  // mid-group 横跨 x:500-700 (col 1..2), y:500-700 (row 3..5)
  assert.ok(index.buckets.get('1:3').some((item) => item.id === 'mid-group'))
  assert.ok(index.buckets.get('2:5').some((item) => item.id === 'mid-group'))
  assert.equal(index.buckets.has('0:0'), true)
  assert.equal(index.buckets.get('0:0').length, 1)
})

test('queryPoint returns the item containing the point', () => {
  const index = buildSpatialIndex(sampleLayout())
  assert.deepEqual(queryPoint(index, { x: 50, y: 20 }), {
    type: 'node', id: 'origin-node', x: 0, y: 0, width: 100, height: 40,
  })
  assert.deepEqual(queryPoint(index, { x: 2050, y: 1520 }), {
    type: 'node', id: 'far-node', x: 2000, y: 1500, width: 100, height: 40,
  })
})

test('queryPoint returns null when no item contains the point', () => {
  const index = buildSpatialIndex(sampleLayout())
  assert.equal(queryPoint(index, { x: 1000, y: 1000 }), null)
  assert.equal(queryPoint(index, { x: 10000, y: 10000 }), null)
})

test('queryRect returns an empty array when the rect overlaps no item', () => {
  const index = buildSpatialIndex(sampleLayout())
  assert.deepEqual(queryRect(index, { x: 10000, y: 10000, width: 10, height: 10 }), [])
})

test('queryRect returns only items whose rect intersects, deduped across cells', () => {
  const index = buildSpatialIndex(sampleLayout())
  // 覆盖 origin-node 和 mid-group，够不到 far-node
  const ids = queryRect(index, { x: 0, y: 0, width: 700, height: 700 }).map((item) => item.id)
  assert.deepEqual(ids.sort(), ['mid-group', 'origin-node'])
})

test('queryRect returns a multi-cell item exactly once', () => {
  const index = buildSpatialIndex(sampleLayout())
  // far-node 横跨 col 7..8；矩形覆盖它整个范围，不应该因为跨两个 bucket 被算两次
  const matches = queryRect(index, { x: 1900, y: 1400, width: 300, height: 300 })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].id, 'far-node')
})

test('getSpatialIndex memoizes per layout object identity', () => {
  const layout = sampleLayout()
  const first = getSpatialIndex(layout)
  const second = getSpatialIndex(layout)
  assert.equal(first, second)

  const otherLayout = sampleLayout()
  const third = getSpatialIndex(otherLayout)
  assert.notEqual(first, third)
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- test/minimap-spatial-index.test.js
```

Expected: fails because `src/minimap/interaction/spatial-index.js` does not exist.

- [ ] **Step 3: Implement the spatial index**

Create `src/minimap/interaction/spatial-index.js`:

```js
// 性能优化切片 3：顶层可见项（节点矩形 + 分组外框矩形）的网格空间索引，
// 给 hitTest 和框选范围查询用。只覆盖 layout.visibleItems，不覆盖分组内部子节点——
// 分组内部命中范围本身受可见窗口限制，不是这里要解决的瓶颈。
// 见 docs/superpowers/specs/2026-06-22-spatial-index-design.md

const DEFAULT_CELL_WIDTH = 256
const DEFAULT_CELL_HEIGHT = 128

function cellKey(col, row) {
  return `${col}:${row}`
}

function addToBucket(buckets, key, item) {
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = []
    buckets.set(key, bucket)
  }
  bucket.push(item)
}

export function buildSpatialIndex(layout, { cellWidth = DEFAULT_CELL_WIDTH, cellHeight = DEFAULT_CELL_HEIGHT } = {}) {
  const buckets = new Map()
  for (const item of layout.visibleItems) {
    const startCol = Math.floor(item.x / cellWidth)
    const endCol = Math.floor((item.x + item.width) / cellWidth)
    const startRow = Math.floor(item.y / cellHeight)
    const endRow = Math.floor((item.y + item.height) / cellHeight)
    for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
        addToBucket(buckets, cellKey(col, row), item)
      }
    }
  }
  return { cellWidth, cellHeight, buckets }
}

function containsPoint(item, point) {
  return (
    point.x >= item.x &&
    point.x <= item.x + item.width &&
    point.y >= item.y &&
    point.y <= item.y + item.height
  )
}

function intersects(a, b) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

export function queryPoint(index, point) {
  const col = Math.floor(point.x / index.cellWidth)
  const row = Math.floor(point.y / index.cellHeight)
  const bucket = index.buckets.get(cellKey(col, row))
  if (!bucket) return null
  for (const item of bucket) {
    if (containsPoint(item, point)) return item
  }
  return null
}

export function queryRect(index, rect) {
  const startCol = Math.floor(rect.x / index.cellWidth)
  const endCol = Math.floor((rect.x + rect.width) / index.cellWidth)
  const startRow = Math.floor(rect.y / index.cellHeight)
  const endRow = Math.floor((rect.y + rect.height) / index.cellHeight)
  const seen = new Set()
  const matches = []
  for (let col = startCol; col <= endCol; col++) {
    for (let row = startRow; row <= endRow; row++) {
      const bucket = index.buckets.get(cellKey(col, row))
      if (!bucket) continue
      for (const item of bucket) {
        if (seen.has(item)) continue
        seen.add(item)
        if (intersects(item, rect)) matches.push(item)
      }
    }
  }
  return matches
}

const indexCache = new WeakMap()

export function getSpatialIndex(layout) {
  let index = indexCache.get(layout)
  if (!index) {
    index = buildSpatialIndex(layout)
    indexCache.set(layout, index)
  }
  return index
}
```

- [ ] **Step 4: Verify spatial-index tests pass**

Run:

```bash
npm test -- test/minimap-spatial-index.test.js
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/interaction/spatial-index.js test/minimap-spatial-index.test.js
git commit -m "feat: add grid-backed spatial index for layout visible items"
```

## Task 2: `screenRectToWorld` Coordinate Helper

**Files:**
- Modify: `src/minimap/coords/coords.js`
- Modify: `test/minimap-coords.test.js`
- Modify: `src/minimap/coords/README.md`

**Interfaces:**
- Produces: `screenRectToWorld(rect, viewport) -> { x, y, width, height }` — rect-level inverse of `screenToWorld(point, viewport)`; always returns a normalized rect (non-negative width/height) regardless of the input rect's sign.

- [ ] **Step 1: Write failing test**

Append to `test/minimap-coords.test.js`:

```js
test('screenRectToWorld converts a screen rect to world space using viewport scale and offset', () => {
  const viewport = { x: -10, y: 5, scale: 2 }
  assert.deepEqual(screenRectToWorld({ x: 50, y: 85, width: 60, height: 80 }, viewport), {
    x: 30, y: 40, width: 30, height: 40,
  })
})

test('screenRectToWorld normalizes a rect with negative width or height', () => {
  const viewport = { x: 0, y: 0, scale: 1 }
  assert.deepEqual(screenRectToWorld({ x: 100, y: 100, width: -50, height: -20 }, viewport), {
    x: 50, y: 80, width: 50, height: 20,
  })
})
```

Update the import at the top of the file:

```js
import { worldToScreen, screenToWorld, screenRectToWorld } from '../src/minimap/coords/coords.js'
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- test/minimap-coords.test.js
```

Expected: fails because `screenRectToWorld` is not exported from `coords.js`.

- [ ] **Step 3: Implement `screenRectToWorld`**

In `src/minimap/coords/coords.js`, append:

```js
export function screenRectToWorld(rect, viewport) {
  const a = screenToWorld({ x: rect.x, y: rect.y }, viewport)
  const b = screenToWorld({ x: rect.x + rect.width, y: rect.y + rect.height }, viewport)
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}
```

- [ ] **Step 4: Verify coords tests pass**

Run:

```bash
npm test -- test/minimap-coords.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Update `coords/README.md`**

In `src/minimap/coords/README.md`, change the `coords.js` row:

```diff
-| `coords.js` | `worldToScreen` / `screenToWorld` |
+| `coords.js` | `worldToScreen` / `screenToWorld` / `screenRectToWorld` |
```

- [ ] **Step 6: Commit**

```bash
git add src/minimap/coords/coords.js test/minimap-coords.test.js src/minimap/coords/README.md
git commit -m "feat: add screenRectToWorld coordinate helper"
```

## Task 3: `hitTest` Uses the Spatial Index

**Files:**
- Modify: `src/minimap/interaction/interaction.js`
- Modify: `test/minimap-interaction.test.js`

**Interfaces:**
- Consumes: `getSpatialIndex(layout)`, `queryPoint(index, point)` from Task 1's `spatial-index.js`.
- Produces: `hitTest(layout, point)` — signature and return shape unchanged from current behavior.

- [ ] **Step 1: Write failing regression test**

Append to `test/minimap-interaction.test.js`:

```js
test('hitTest finds items spread across distant spatial-index grid cells', () => {
  const farGroup = {
    id: 'far-group',
    parentId: 'p',
    x: 3000,
    y: 2000,
    width: 200,
    height: 150,
    scrollTop: 0,
    rows: 0,
    columns: 1,
    children: [],
  }
  const layout = {
    visibleItems: [
      { type: 'node', id: 'origin-node', x: 0, y: 0, width: 120, height: 40 },
      { type: 'group', id: 'far-group', parentId: 'p', x: 3000, y: 2000, width: 200, height: 150 },
    ],
    groups: [farGroup],
  }

  assert.deepEqual(hitTest(layout, { x: 60, y: 20 }), { type: 'node', id: 'origin-node' })
  assert.deepEqual(hitTest(layout, { x: 3100, y: 2010 }), { type: 'group', id: 'far-group', zone: 'header' })
  assert.equal(hitTest(layout, { x: 1500, y: 1000 }), null)
})
```

This test passes against the *current* implementation too (it's a regression guard, not a failure-first test — the linear scan already handles distant items correctly). The point of this step is to lock in the behavior before swapping internals, so step 4 proves the swap didn't change it.

- [ ] **Step 2: Run test to verify it passes against the current implementation**

Run:

```bash
npm test -- test/minimap-interaction.test.js
```

Expected: all tests pass, including the new one (confirms current behavior before refactor).

- [ ] **Step 3: Swap `hitTest` internals to use the spatial index**

In `src/minimap/interaction/interaction.js`, add the import (next to the existing `graph/layout.js` import):

```diff
 import { GROUP, NODE, LEVEL_GAP, visibleGroupChildren } from '../graph/layout.js'
+import { getSpatialIndex, queryPoint } from './spatial-index.js'
```

Replace `hitTest`:

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

`containsPoint` stays — it's still used by `hitTestGroupZone` and `findInsertionIndex` elsewhere in this file.

- [ ] **Step 4: Run tests to verify the swap preserves behavior**

Run:

```bash
npm test -- test/minimap-interaction.test.js
```

Expected: all tests pass unchanged, including every existing `hitTest`/`resolveDropTarget`/`resolveResourceDropPreview` test (they all call `hitTest` transitively).

- [ ] **Step 5: Commit**

```bash
git add src/minimap/interaction/interaction.js test/minimap-interaction.test.js
git commit -m "perf: back hitTest with the spatial index instead of a linear scan"
```

## Task 4: `idsInSelectionRect` Uses the Spatial Index

**Files:**
- Modify: `src/minimap/interaction/selection.js`
- Modify: `test/minimap-selection.test.js`
- Modify: `src/minimap/interaction/README.md`

**Interfaces:**
- Consumes: `getSpatialIndex(layout)`, `queryRect(index, rect)` from Task 1; `screenRectToWorld(rect, viewport)` from Task 2.
- Produces: `idsInSelectionRect(layout, screenRect, viewport)` — signature and return shape unchanged.

- [ ] **Step 1: Write failing regression tests**

Append to `test/minimap-selection.test.js`. First update the `graph/layout.js` import to also pull in `visibleGroupChildren`:

```diff
-import { computeLayout } from '../src/minimap/graph/layout.js'
+import { computeLayout, visibleGroupChildren } from '../src/minimap/graph/layout.js'
```

Then append:

```js
test("idsInSelectionRect excludes a group's children when the marquee never touches the group box", () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const cluster25Group = layout.groups.find((group) => group.parentId === 'cluster-25')

  const ids = idsInSelectionRect(
    layout,
    { x: grid.x, y: grid.y, width: grid.width, height: grid.height },
    { x: 0, y: 0, scale: 1 },
  )

  assert.deepEqual(ids, ['grid-tie'])
  assert.equal(heapGroup.children.some((childId) => ids.includes(childId)), false)
  assert.equal(cluster25Group.children.some((childId) => ids.includes(childId)), false)
})

test("idsInSelectionRect includes a group's children when the marquee only grazes a corner of the group box", () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const firstChild = visibleGroupChildren(heapGroup)[0]

  const ids = idsInSelectionRect(
    layout,
    {
      x: heapGroup.x,
      y: heapGroup.y,
      width: firstChild.rect.x + firstChild.rect.width / 2 - heapGroup.x,
      height: firstChild.rect.y + firstChild.rect.height / 2 - heapGroup.y,
    },
    { x: 0, y: 0, scale: 1 },
  )

  assert.ok(ids.includes(firstChild.id))
  assert.equal(ids.includes('grid-tie'), false)
  assert.equal(ids.includes('cluster-25'), false)
})
```

- [ ] **Step 2: Run tests to verify they pass against the current implementation**

Run:

```bash
npm test -- test/minimap-selection.test.js
```

Expected: all tests pass, including the two new ones (regression guards before the refactor).

- [ ] **Step 3: Swap `idsInSelectionRect` internals to use the spatial index**

In `src/minimap/interaction/selection.js`, update the imports:

```diff
 import { visibleGroupChildren } from '../graph/layout.js'
-import { resolveEdges, worldRectToScreen } from '../render/renderer.js'
+import { resolveEdges } from '../render/renderer.js'
+import { screenRectToWorld } from '../coords/coords.js'
+import { getSpatialIndex, queryRect } from './spatial-index.js'
```

Replace `idsInSelectionRect`:

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

`visibleSelectableItems` stays unchanged — `itemIds()`/`buildSelectionRelations` still need the full "every selectable id" list and are not part of this slice's hot path.

- [ ] **Step 4: Run tests to verify the swap preserves behavior**

Run:

```bash
npm test -- test/minimap-selection.test.js
```

Expected: all tests pass unchanged, including the pre-existing `idsInSelectionRect returns visible nodes intersecting the marquee but not group containers` test and the two new regression tests from Step 1.

- [ ] **Step 5: Update `interaction/README.md`**

In `src/minimap/interaction/README.md`:

```diff
 | `interaction.js` | `hitTest`、`resolveDropTarget`、`scrollbarMetrics`/`hitScrollbarThumb`、自动滚动/边缘平移速度等 |
 | `drag-transition.js` | 分组框内换位让位动画：虚拟顺序、子节点矩形插值 |
 | `selection.js` | `applySelectionClick`、`applySelectionSet`、`idsInSelectionRect` |
+| `spatial-index.js` | `buildSpatialIndex`/`queryPoint`/`queryRect`/`getSpatialIndex`：顶层可见项的网格空间索引，供 `hitTest`/`idsInSelectionRect` 用 |
```

```diff
 **依赖方向：**

-- 可 import `graph/layout.js`、`render/renderer.js`（如 `worldRectToScreen` 用于框选）
+- 可 import `graph/layout.js`、`coords/coords.js`（如 `screenRectToWorld` 用于框选）、`render/renderer.js`（如 `resolveEdges` 用于选中关系高亮）
 - 函数签名中 layout 由调用方显式传入，不在此层持有 controller 引用
 - 不应 import `controllers/`、`components/`
```

- [ ] **Step 6: Commit**

```bash
git add src/minimap/interaction/selection.js test/minimap-selection.test.js src/minimap/interaction/README.md
git commit -m "perf: back idsInSelectionRect with the spatial index instead of a full scan"
```

## Task 5: Roadmap and Full Verification

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Update roadmap**

In `ROADMAP.md`, under 性能优化切片, add a new line after the 切片 1 entry (and update 下一步):

```diff
 - **性能优化切片**：
   - [x] 切片 1：大图交互合帧与缩放降级渲染（新增 `render-scheduler.js`、`render-quality.js`；平移/框选高频路径合帧；缩小时减少文字和分组子项绘制；拖拽合帧、空间索引和静态缓存作为后续独立切片；[spec](docs/superpowers/specs/2026-06-21-large-graph-performance.md)，[plan](docs/superpowers/plans/2026-06-21-large-graph-performance.md)，`npm test` 363 全过，`npm run build` 通过）
+  - [x] 切片 3：空间索引接入 hitTest / 框选矩形查询（新增 `interaction/spatial-index.js`：固定网格 bucket 只覆盖顶层可见项，`WeakMap` 按 `layout` 对象身份记忆化；`hitTest`/`idsInSelectionRect` 原地换内部实现，签名和调用方不变；新增 `coords.screenRectToWorld` 把框选矩形一次性转换到世界坐标；视口裁剪 `queryViewport` 留给切片 4；[spec](docs/superpowers/specs/2026-06-22-spatial-index-design.md)，[plan](docs/superpowers/plans/2026-06-22-spatial-index.md)，`npm test` 全过，`npm run build` 通过）
```

(Leave the surrounding "下一步" line as-is unless all of 性能优化切片 4/第五阶段切片 5/6 are also done — this slice only completes 切片 3.)

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- test/minimap-spatial-index.test.js test/minimap-coords.test.js test/minimap-interaction.test.js test/minimap-selection.test.js
```

Expected: all focused tests pass.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass (no count regression from before this slice) and the build succeeds.

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: record spatial index performance slice in roadmap"
```

## Self-Review

- **Spec coverage:** `buildSpatialIndex`/`queryPoint`/`queryRect`/`getSpatialIndex` (Task 1) ✓; `hitTest` swap (Task 3) ✓; `idsInSelectionRect` swap + `screenRectToWorld` (Task 2 + Task 4) ✓; invalidation-boundary behavior is structural (WeakMap keyed by `layout` identity) and covered by Task 1's memoization test ✓; `queryViewport`/render culling explicitly out of scope per spec ✓; README/architecture doc updates ✓; ROADMAP entry ✓.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `buildSpatialIndex(layout, options) -> { cellWidth, cellHeight, buckets }`, `queryPoint(index, point) -> item|null`, `queryRect(index, rect) -> item[]`, `getSpatialIndex(layout) -> index`, `screenRectToWorld(rect, viewport) -> rect` — names and shapes match exactly between Task 1/2 (producers) and Task 3/4 (consumers).
- **Module placement:** `spatial-index.js` lives in `interaction/` (not `render/`), matching its only two consumers and architecture.md's layering — corrected during spec review before this plan was written.
