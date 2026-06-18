# Phase 1 正交连线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

**Goal:** 把所有 minimap 连线从中心点直线改为正交折线，并在终点绘制箭头，同时保持自定义 `edgeRenderer` 的既有中心点契约不变。

**Architecture:** 新增 `src/minimap/orthogonal.js` 承载纯路由算法，`renderer.js` 继续负责端点解析、坐标映射和 Canvas 绘制。`resolveEdges` 保留 `from`/`to` 中心点字段并新增 `fromBox`/`toBox` 世界坐标包围盒；默认绘制使用 box 生成折线路径，自定义 edge renderer 仍只接收屏幕中心点。

**Tech Stack:** Vue 2.7 + Vite + Canvas 2D；纯 JS ESM；Node 内置 `node --test`；现有 mock Canvas ctx。

---

## Source Spec

- Spec: `docs/superpowers/specs/2026-06-18-phase-1-orthogonal-edges.md`
- Existing renderer contract: `docs/superpowers/specs/2026-06-18-phase-1-canvas-renderer.md`

## File Structure

- Create `src/minimap/orthogonal.js`: pure `orthogonalPath(fromBox, toBox, mainAxis)` function. No Canvas, Vue, graph, or viewport dependency.
- Create `test/minimap-orthogonal.test.js`: pure function tests for horizontal, vertical, overlap fallback, touching intervals, and shared-spine behavior.
- Modify `src/minimap/renderer.js`: import `orthogonalPath`; make `resolveEdges` attach endpoint boxes; derive `mainAxis` from `scene.direction` or `scene.layoutDirection`; draw default orthogonal edges and arrows.
- Modify `src/minimap/theme.js`: add `theme.edge.arrowSize`.
- Modify `src/minimap/Minimap.vue`: pass `layoutDirection` into `renderScene` so default edge drawing can choose `x` or `y` as main axis.
- Modify `test/minimap-renderer.test.js`: assert box contract, default polyline calls, arrow fill, vertical direction, custom renderer contract, and no regression for folded endpoint routing.
- Modify `ROADMAP.md`: persist that the current next slice is orthogonal edges while implementation is in progress, then mark it complete at the final task.

## Global Constraints

- Do not change the visual theme beyond adding `edge.arrowSize`.
- Do not add runtime or dev dependencies.
- Do not expose `fromBox` or `toBox` to custom `edgeRenderer` params in this slice.
- Do not add layout switching animation, viewport anchor compensation, or a demo direction toggle.
- Keep all geometry in world coordinates until `renderScene` maps points to screen coordinates.
- Each task must run `npm test` and `npm run build` before committing.

## Progress

- [x] Task 1: `orthogonalPath` pure function + tests
- [x] Task 2: `resolveEdges` endpoint box contract
- [x] Task 3: default orthogonal edge drawing + arrows + direction plumbing
- [x] Task 4: docs progress sync + full verification

切片完成：commit `7902000`..`0d4b711`，`npm test` 全过、`npm run build` 通过。

---

### Task 1: `orthogonalPath` Pure Function

**Files:**
- Create: `src/minimap/orthogonal.js`
- Create: `test/minimap-orthogonal.test.js`

**Interfaces:**
- `orthogonalPath(fromBox, toBox, mainAxis) -> [{ x, y }, { x, y }, { x, y }, { x, y }]`
- `fromBox` / `toBox`: `{ x, y, width, height }` in world coordinates.
- `mainAxis`: `'x'` for horizontal layouts, `'y'` for vertical layouts.

- [x] **Step 1: Write the failing pure function tests**

Create `test/minimap-orthogonal.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { orthogonalPath } from '../src/minimap/orthogonal.js'

test('orthogonalPath routes left-to-right boxes as horizontal-vertical-horizontal', () => {
  const from = { x: 0, y: 20, width: 100, height: 40 }
  const to = { x: 220, y: 100, width: 120, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'x'), [
    { x: 100, y: 40 },
    { x: 160, y: 40 },
    { x: 160, y: 120 },
    { x: 220, y: 120 },
  ])
})

test('orthogonalPath routes right-to-left boxes toward each other', () => {
  const from = { x: 300, y: 20, width: 100, height: 40 }
  const to = { x: 40, y: 100, width: 120, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'x'), [
    { x: 300, y: 40 },
    { x: 230, y: 40 },
    { x: 230, y: 120 },
    { x: 160, y: 120 },
  ])
})

test('orthogonalPath falls back to cross-axis routing when main-axis intervals overlap', () => {
  const from = { x: 100, y: 20, width: 100, height: 40 }
  const to = { x: 130, y: 120, width: 120, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'x'), [
    { x: 150, y: 60 },
    { x: 150, y: 90 },
    { x: 190, y: 90 },
    { x: 190, y: 120 },
  ])
})

test('orthogonalPath treats touching main-axis intervals as overlap', () => {
  const from = { x: 0, y: 100, width: 100, height: 40 }
  const to = { x: 100, y: 20, width: 120, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'x'), [
    { x: 50, y: 100 },
    { x: 50, y: 80 },
    { x: 160, y: 80 },
    { x: 160, y: 60 },
  ])
})

test('orthogonalPath routes top-to-bottom boxes as vertical-horizontal-vertical', () => {
  const from = { x: 20, y: 0, width: 100, height: 40 }
  const to = { x: 160, y: 180, width: 100, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'y'), [
    { x: 70, y: 40 },
    { x: 70, y: 110 },
    { x: 210, y: 110 },
    { x: 210, y: 180 },
  ])
})

test('orthogonalPath gives siblings of the same parent a shared spine coordinate', () => {
  const parent = { x: 0, y: 100, width: 120, height: 40 }
  const childA = { x: 240, y: 40, width: 120, height: 40 }
  const childB = { x: 240, y: 180, width: 120, height: 40 }

  const pathA = orthogonalPath(parent, childA, 'x')
  const pathB = orthogonalPath(parent, childB, 'x')

  assert.equal(pathA[1].x, pathB[1].x)
  assert.equal(pathA[2].x, pathB[2].x)
  assert.equal(pathA[1].x, 180)
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL with a module-not-found error for `../src/minimap/orthogonal.js`.

- [x] **Step 3: Implement the pure function**

Create `src/minimap/orthogonal.js`:

```js
// Phase 1 正交连线：根据两个世界坐标包围盒生成固定四点的三段折线路径。
// 不做避障；不依赖 Canvas / Vue / graph。见 docs/superpowers/specs/2026-06-18-phase-1-orthogonal-edges.md

function axisConfig(mainAxis) {
  return mainAxis === 'y'
    ? {
        main: 'y',
        cross: 'x',
        mainSize: 'height',
        crossSize: 'width',
      }
    : {
        main: 'x',
        cross: 'y',
        mainSize: 'width',
        crossSize: 'height',
      }
}

function center(box, axis, sizeKey) {
  return box[axis] + box[sizeKey] / 2
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd
}

function point(mainAxis, mainValue, crossValue) {
  return mainAxis === 'x' ? { x: mainValue, y: crossValue } : { x: crossValue, y: mainValue }
}

export function orthogonalPath(fromBox, toBox, mainAxis = 'x') {
  const axis = axisConfig(mainAxis)
  const fromMainStart = fromBox[axis.main]
  const fromMainEnd = fromMainStart + fromBox[axis.mainSize]
  const toMainStart = toBox[axis.main]
  const toMainEnd = toMainStart + toBox[axis.mainSize]
  const mainOverlaps = rangesOverlap(fromMainStart, fromMainEnd, toMainStart, toMainEnd)

  const routeAxis = mainOverlaps
    ? {
        main: axis.cross,
        cross: axis.main,
        mainSize: axis.crossSize,
        crossSize: axis.mainSize,
      }
    : axis

  const fromCenter = center(fromBox, routeAxis.main, routeAxis.mainSize)
  const toCenter = center(toBox, routeAxis.main, routeAxis.mainSize)
  const fromBeforeTo = fromCenter <= toCenter

  const fromExitMain = fromBeforeTo ? fromBox[routeAxis.main] + fromBox[routeAxis.mainSize] : fromBox[routeAxis.main]
  const toEntryMain = fromBeforeTo ? toBox[routeAxis.main] : toBox[routeAxis.main] + toBox[routeAxis.mainSize]
  const bendMain = (fromExitMain + toEntryMain) / 2
  const fromCross = center(fromBox, routeAxis.cross, routeAxis.crossSize)
  const toCross = center(toBox, routeAxis.cross, routeAxis.crossSize)

  return [
    point(routeAxis.main, fromExitMain, fromCross),
    point(routeAxis.main, bendMain, fromCross),
    point(routeAxis.main, bendMain, toCross),
    point(routeAxis.main, toEntryMain, toCross),
  ]
}
```

- [x] **Step 4: Run tests to verify the pure function passes**

Run:

```bash
npm test
```

Expected: PASS. The new `test/minimap-orthogonal.test.js` tests pass alongside the existing suite.

- [x] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: build exits successfully.

- [x] **Step 6: Commit**

```bash
git add src/minimap/orthogonal.js test/minimap-orthogonal.test.js
git commit -m "feat: add orthogonal edge routing"
```

---

### Task 2: `resolveEdges` Endpoint Box Contract

**Files:**
- Modify: `src/minimap/renderer.js`
- Modify: `test/minimap-renderer.test.js`

**Interfaces:**
- `resolveEdges(graph, layout)` keeps `from` / `to` as world center points.
- `resolveEdges(graph, layout)` adds `fromBox` / `toBox` as the exact world-coordinate box used to derive those centers.
- Folded endpoints still route to their parent group box.

- [x] **Step 1: Write failing tests for endpoint boxes**

Modify the existing `resolveEdges builds tree edges and routes folded endpoints to the group` test in `test/minimap-renderer.test.js` to include these assertions:

```js
test('resolveEdges builds tree edges and routes folded endpoints to the group', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges(graph, layout)

  assert.ok(edges.some((edge) => edge.kind === 'tree'))

  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const groupCenter = { x: heapGroup.x + heapGroup.width / 2, y: heapGroup.y + heapGroup.height / 2 }
  const business = edges.find((edge) => edge.id === 'edge-1') // cluster-8 -> cluster-25
  assert.deepEqual(business.from, groupCenter)
  assert.deepEqual(business.fromBox, heapGroup)

  const targetBox = layout.nodes.get('cluster-25')
  assert.deepEqual(business.toBox, targetBox)
  assert.deepEqual(business.to, {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  })
})
```

Add this new test to the same file:

```js
test('resolveEdges includes boxes for tree edges without changing center points', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges(graph, layout)

  const edge = edges.find((candidate) => candidate.id === 'tree:energy-root:grid-tie')
  const fromBox = layout.nodes.get('energy-root')
  const toBox = layout.nodes.get('grid-tie')

  assert.deepEqual(edge.fromBox, fromBox)
  assert.deepEqual(edge.toBox, toBox)
  assert.deepEqual(edge.from, {
    x: fromBox.x + fromBox.width / 2,
    y: fromBox.y + fromBox.height / 2,
  })
  assert.deepEqual(edge.to, {
    x: toBox.x + toBox.width / 2,
    y: toBox.y + toBox.height / 2,
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL because `edge.fromBox` and `edge.toBox` are currently `undefined`.

- [x] **Step 3: Update `resolveEdges` to resolve boxes and centers together**

In `src/minimap/renderer.js`, replace the existing `centerOfBox` / `resolveEdges` block with this code:

```js
const centerOfBox = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

// 父子树默认连线 + graph.edges 业务线；端点保留世界坐标中心，
// 并附带用于默认正交绘制的世界坐标包围盒。
// 端点落在被折叠子节点上时路由到其所在分组框。
export function resolveEdges(graph, layout) {
  const edges = []
  const groupByParent = new Map(layout.groups.map((group) => [group.parentId, group]))

  const endpointOf = (id) => {
    const box = layout.nodes.get(id)
    if (box) return { point: centerOfBox(box), box }
    const node = graph.nodes.get(id)
    const group = node && groupByParent.get(node.parentId)
    return group ? { point: centerOfBox(group), box: group } : null
  }

  for (const item of layout.visibleItems) {
    if (item.type !== 'node') continue
    const node = graph.nodes.get(item.id)
    if (!node || !node.children || node.children.length === 0) continue
    const fromEndpoint = { point: centerOfBox(item), box: item }
    const group = groupByParent.get(item.id)
    if (group) {
      edges.push({
        id: `tree:${item.id}:group`,
        kind: 'tree',
        from: fromEndpoint.point,
        to: centerOfBox(group),
        fromBox: fromEndpoint.box,
        toBox: group,
      })
    } else {
      for (const childId of node.children) {
        const childBox = layout.nodes.get(childId)
        if (childBox) {
          edges.push({
            id: `tree:${item.id}:${childId}`,
            kind: 'tree',
            from: fromEndpoint.point,
            to: centerOfBox(childBox),
            fromBox: fromEndpoint.box,
            toBox: childBox,
          })
        }
      }
    }
  }

  for (const edge of graph.edges || []) {
    const from = endpointOf(edge.source)
    const to = endpointOf(edge.target)
    if (from && to) {
      edges.push({
        id: edge.id,
        kind: edge.kind || 'relation',
        from: from.point,
        to: to.point,
        fromBox: from.box,
        toBox: to.box,
      })
    }
  }

  return edges
}
```

- [x] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test
```

Expected: PASS. Existing edge resolution tests and new box assertions all pass.

- [x] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: build exits successfully.

- [x] **Step 6: Commit**

```bash
git add src/minimap/renderer.js test/minimap-renderer.test.js
git commit -m "feat: include edge endpoint boxes"
```

---

### Task 3: Default Orthogonal Drawing, Arrows, and Direction Plumbing

**Files:**
- Modify: `src/minimap/renderer.js`
- Modify: `src/minimap/theme.js`
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-renderer.test.js`

**Interfaces:**
- `renderScene(ctx, scene)` accepts `scene.layoutDirection` or `scene.direction`; values are `'horizontal'` / `'vertical'`.
- Default edge drawing uses `mainAxis = 'y'` only for vertical direction; otherwise `mainAxis = 'x'`.
- Custom `renderers.edge` receives `{ edge, from, to, theme, viewport }`, where `edge` does not expose `fromBox` / `toBox` to that callback.

- [x] **Step 1: Add failing renderer tests for orthogonal lines, arrows, vertical direction, and custom edge contract**

Add these imports to the top of `test/minimap-renderer.test.js`:

```js
import { defaultTheme } from '../src/minimap/theme.js'
```

Add these tests:

```js
test('renderScene draws default edges as three-segment orthogonal polylines', () => {
  const ctx = createMockCtx()
  renderScene(ctx, demoScene())

  const firstMove = ctx.methodsOf('moveTo').find((call) => call.args[0] === 220 && call.args[1] === 457.6)
  const moveIndex = ctx.calls.indexOf(firstMove)
  const lineTos = ctx.calls.slice(moveIndex + 1).filter((call) => call.method === 'lineTo').slice(0, 3)

  assert.deepEqual(lineTos.map((call) => call.args), [
    [260, 457.6],
    [260, 184],
    [300, 184],
  ])
})

test('renderScene draws arrow triangles at edge endpoints', () => {
  const ctx = createMockCtx()
  renderScene(ctx, demoScene())

  const fillCalls = ctx.methodsOf('fill')
  const closePathCalls = ctx.methodsOf('closePath')

  assert.ok(fillCalls.length > 0)
  assert.ok(closePathCalls.length > 0)
  assert.ok(ctx.calls.some((call) => call.method === 'set:fillStyle' && call.args[0] === defaultTheme.edge.color))
})

test('renderScene uses vertical direction for vertical orthogonal edges', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'vertical', viewportWidth: 1200, viewportHeight: 760 })
  const ctx = createMockCtx()
  renderScene(ctx, {
    graph,
    layout,
    layoutDirection: 'vertical',
    viewport: { x: 100, y: 100, scale: 1 },
    width: 2400,
    height: 1600,
  })

  const firstMove = ctx.methodsOf('moveTo').find((call) => call.args[0] === 830.5 && call.args[1] === 140)
  const moveIndex = ctx.calls.indexOf(firstMove)
  const lineTos = ctx.calls.slice(moveIndex + 1).filter((call) => call.method === 'lineTo').slice(0, 3)

  assert.deepEqual(lineTos.map((call) => call.args), [
    [830.5, 180],
    [304, 180],
    [304, 220],
  ])
})

test('custom edgeRenderer still receives only center points and no endpoint boxes', () => {
  const calls = []
  const ctx = createMockCtx()

  renderScene(ctx, demoScene({
    renderers: {
      edge: (_ctx, params) => calls.push(params),
    },
  }))

  assert.ok(calls.length > 0)
  assert.deepEqual(Object.keys(calls[0]).sort(), ['edge', 'from', 'theme', 'to', 'viewport'])
  assert.equal('fromBox' in calls[0].edge, false)
  assert.equal('toBox' in calls[0].edge, false)
  assert.deepEqual(calls[0].from, { x: calls[0].edge.from.x + 100, y: calls[0].edge.from.y + 100 })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL because default drawing still emits a single straight `lineTo`, no arrow `fill`, no direction-aware path, and the custom callback currently receives `edge` with boxes after Task 2.

- [x] **Step 3: Add `arrowSize` to the default theme**

In `src/minimap/theme.js`, change the `edge` entry to:

```js
  edge: { color: '#3a4f66', width: 1, arrowSize: 6 },
```

- [x] **Step 4: Import `orthogonalPath` and add screen path helpers**

In `src/minimap/renderer.js`, add this import:

```js
import { orthogonalPath } from './orthogonal.js'
```

Add these helper functions above `drawEdge`:

```js
function screenPathForEdge(edge, viewport, mainAxis) {
  return orthogonalPath(edge.fromBox, edge.toBox, mainAxis).map((point) => worldToScreen(point, viewport))
}

function edgeForCustomRenderer(edge) {
  return {
    id: edge.id,
    kind: edge.kind,
    from: edge.from,
    to: edge.to,
  }
}

function mainAxisForScene(scene) {
  return scene.layoutDirection === 'vertical' || scene.direction === 'vertical' ? 'y' : 'x'
}
```

- [x] **Step 5: Replace straight `drawEdge` with polyline + arrow drawing**

In `src/minimap/renderer.js`, replace the current `drawEdge` function with:

```js
function drawArrow(ctx, path, theme) {
  const tip = path[path.length - 1]
  const prev = path[path.length - 2]
  const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x)
  const size = theme.edge.arrowSize
  const spread = Math.PI / 7

  ctx.fillStyle = theme.edge.color
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(tip.x - Math.cos(angle - spread) * size, tip.y - Math.sin(angle - spread) * size)
  ctx.lineTo(tip.x - Math.cos(angle + spread) * size, tip.y - Math.sin(angle + spread) * size)
  ctx.closePath()
  ctx.fill()
}

function drawEdge(ctx, path, theme) {
  ctx.strokeStyle = theme.edge.color
  ctx.lineWidth = theme.edge.width
  ctx.beginPath()
  ctx.moveTo(path[0].x, path[0].y)
  ctx.lineTo(path[1].x, path[1].y)
  ctx.lineTo(path[2].x, path[2].y)
  ctx.lineTo(path[3].x, path[3].y)
  ctx.stroke()
  drawArrow(ctx, path, theme)
}
```

- [x] **Step 6: Use direction-aware default drawing and hide boxes from custom renderers**

In `src/minimap/renderer.js`, inside `renderScene`, add:

```js
  const mainAxis = mainAxisForScene(scene)
```

Then replace the current edge loop:

```js
  for (const edge of resolveEdges(graph, layout)) {
    const from = worldToScreen(edge.from, viewport)
    const to = worldToScreen(edge.to, viewport)
    if (renderers.edge) renderers.edge(ctx, { edge, from, to, theme, viewport })
    else drawEdge(ctx, from, to, theme)
  }
```

with:

```js
  for (const edge of resolveEdges(graph, layout)) {
    const from = worldToScreen(edge.from, viewport)
    const to = worldToScreen(edge.to, viewport)
    if (renderers.edge) renderers.edge(ctx, { edge: edgeForCustomRenderer(edge), from, to, theme, viewport })
    else drawEdge(ctx, screenPathForEdge(edge, viewport, mainAxis), theme)
  }
```

- [x] **Step 7: Pass layout direction from the Vue shell**

In `src/minimap/Minimap.vue`, inside the `renderScene(ctx, { ... })` call, add:

```js
    layoutDirection: props.layoutDirection,
```

The full call should look like:

```js
  renderScene(ctx, {
    layout,
    graph: props.graph,
    viewport,
    width: cssWidth,
    height: cssHeight,
    layoutDirection: props.layoutDirection,
    theme: props.theme || defaultTheme,
    state: { selectedIds: new Set(currentSelectedIds()) },
  })
```

- [x] **Step 8: Run tests to verify they pass**

Run:

```bash
npm test
```

Expected: PASS. Renderer tests confirm three-segment paths, arrows, vertical routing, and custom edge contract.

- [x] **Step 9: Run build**

Run:

```bash
npm run build
```

Expected: build exits successfully.

- [x] **Step 10: Commit**

```bash
git add src/minimap/renderer.js src/minimap/theme.js src/minimap/Minimap.vue test/minimap-renderer.test.js
git commit -m "feat: draw orthogonal edges with arrows"
```

---

### Task 4: Docs Progress Sync and Full Verification

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/superpowers/plans/2026-06-18-phase-1-orthogonal-edges.md`

**Goal:** Persist the completed slice status so a new session can resume from the right next step.

- [x] **Step 1: Update ROADMAP current progress**

In `ROADMAP.md`, replace the `当前进度` block with this content:

```md
## 当前进度

> 换窗口/新会话时先读这里。进度是持久状态，做完一步就更新本块。

- **当前阶段**：第一阶段（核心可用能力）—— 进行中
- **当前阶段计划**：[逻辑层](docs/superpowers/plans/2026-06-18-phase-1-core-logic.md) ｜ [Canvas 渲染器](docs/superpowers/plans/2026-06-18-phase-1-canvas-renderer.md) ｜ [Vue 组件壳 + 资源树拖入](docs/superpowers/plans/2026-06-18-phase-1-vue-shell.md) ｜ [正交连线](docs/superpowers/plans/2026-06-18-phase-1-orthogonal-edges.md)（切片级进度在各 plan「进度」一节）
- **已完成切片**：
  - 逻辑层 `graph` / `layout` / `coords` + 测试（commit `893b6b7`）
  - Canvas 渲染器 `renderer` / `theme` + 测试（commit `1caccd8`，`npm test` 22 全过）
  - Vue 组件壳 `Minimap.vue` / `ResourceTree.vue` / `interaction.js` + 资源树拖入 + 测试（commit `0c50895`..`e4c451b`，`npm test` 49 全过，浏览器手动验收通过）
  - 正交连线 `orthogonalPath` / `resolveEdges` endpoint boxes / 折线 + 箭头绘制 + 测试（commit 见本切片 plan 进度，`npm test` 与 `npm run build` 通过）
- **下一步**：第一阶段最后一个切片——布局切换动画（按 brainstorm → spec → plan → implement 推进）
- **待办切片**：布局切换动画；验收点全绿后勾「第一阶段」
```

After committing the slice, copy the exact completed-slice line from this plan's Progress section into the roadmap entry if a commit hash is desired there.

- [x] **Step 2: Update this plan progress**

In `docs/superpowers/plans/2026-06-18-phase-1-orthogonal-edges.md`, change the progress checklist to:

```md
## Progress

- [x] Task 1: `orthogonalPath` pure function + tests
- [x] Task 2: `resolveEdges` endpoint box contract
- [x] Task 3: default orthogonal edge drawing + arrows + direction plumbing
- [x] Task 4: docs progress sync + full verification

切片完成：commit `$(git rev-parse --short HEAD)`，`npm test` 全过、`npm run build` 通过。
```

When applying this edit manually, run `git rev-parse --short HEAD` after the implementation commit and replace the command substitution text with that exact short hash before committing the docs progress update.

- [x] **Step 3: Run full verification**

Run:

```bash
npm test
```

Expected: PASS with all tests passing.

Run:

```bash
npm run build
```

Expected: build exits successfully.

- [x] **Step 4: Inspect git diff before committing**

Run:

```bash
git diff -- ROADMAP.md docs/superpowers/plans/2026-06-18-phase-1-orthogonal-edges.md
```

Expected: diff only contains progress/status updates for the orthogonal edges slice.

- [x] **Step 5: Commit docs progress**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-06-18-phase-1-orthogonal-edges.md
git commit -m "docs: mark orthogonal edges slice complete"
```

---

## Self-Review

- Spec coverage: Task 1 covers the pure route algorithm, main-axis overlap fallback, touching intervals, horizontal/vertical axes, and shared spine behavior. Task 2 covers `resolveEdges` box fields while preserving centers and folded endpoint routing. Task 3 covers default polyline drawing, arrows, direction plumbing, and custom renderer contract. Task 4 covers persistent roadmap progress.
- Non-goals preserved: no layout switching animation, viewport anchor compensation, demo direction toggle, obstacle avoidance, group-internal child routing, or style overhaul.
- Type consistency: plan uses `layoutDirection` / `direction` as scene-level direction fields, `mainAxis` as `'x'|'y'`, and preserves existing `from` / `to` point fields.
- Verification: each implementation task includes `npm test`, `npm run build`, and a focused commit.
