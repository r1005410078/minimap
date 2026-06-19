# Phase 3 Selection and Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 3 slice 2 by adding multi-selection, Shift-drag marquee selection, Esc/blank clearing, and selected-relationship highlight/dim rendering.

**Architecture:** Keep selection math in pure JS helpers so it can be tested without Vue or Canvas. `Minimap.vue` owns controlled/uncontrolled selection state and gesture routing. `renderer.js` consumes precomputed highlight/dim sets and selection-rect state, without knowing how gestures work.

**Tech Stack:** Vue 2 SFC via `@vue/test-utils`, Canvas 2D mock tests, Node `node:test`, existing minimap modules (`layout.js`, `interaction.js`, `renderer.js`, `Minimap.vue`).

---

## Current Context

- Third phase spec: `docs/superpowers/specs/2026-06-19-phase-3-view-selection.md`.
- Slice 1 viewport work is complete. Do not rewrite `viewport.js` unless a test proves a selection interaction needs it.
- Existing `Minimap.vue` already has:
  - `selectedIds` prop and `select` event.
  - Single-value internal selection via `internalSelectedId`.
  - Node click selection, group-item click selection, blank click clearing.
  - Blank drag pan from non-Shift empty canvas.
- Existing renderer state currently only uses `state.selectedIds`, `state.groupDrag`, and `state.groupScrollbarHoverId`.
- Node cross-parent drag/move remains Phase 5 and must not be implemented here.

## Files

- Create: `src/minimap/selection.js` - pure selection/highlight helpers.
- Modify: `src/minimap/renderer.js` - selected/highlighted/dimmed states and marquee rectangle drawing.
- Modify: `src/minimap/Minimap.vue` - internal selected ids array, modifier-click, Shift blank marquee, Esc clearing, focus.
- Modify: `test/minimap-select.test.js` - Vue interaction tests for multi-select, controlled mode, marquee, Esc.
- Modify: `test/minimap-renderer.test.js` - renderer state propagation/highlight/dim tests.
- Create: `test/minimap-selection.test.js` - pure helper tests.
- Modify after implementation: `docs/superpowers/specs/2026-06-19-phase-3-view-selection.md`, `ROADMAP.md`, and this plan progress block.

## Progress

- [x] Task 1: Pure Selection Helpers
- [x] Task 2: Renderer Highlight and Marquee Drawing
- [x] Task 3: Vue Multi-Select and Esc Clear
- [x] Task 4: Shift Blank Drag Marquee Selection
- [x] Task 5: Documentation and Verification

---

### Task 1: Pure Selection Helpers

**Files:**
- Create: `src/minimap/selection.js`
- Test: `test/minimap-selection.test.js`

- [ ] **Step 1: Write failing tests for selection set updates**

Create `test/minimap-selection.test.js` with:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applySelectionClick,
  buildSelectionRelations,
  idsInSelectionRect,
  intersectsRect,
} from '../src/minimap/selection.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'

test('applySelectionClick replaces selection without modifier keys', () => {
  assert.deepEqual(applySelectionClick(['a', 'b'], 'c', { additive: false }), ['c'])
})

test('applySelectionClick toggles item with additive modifier', () => {
  assert.deepEqual(applySelectionClick(['a'], 'b', { additive: true }), ['a', 'b'])
  assert.deepEqual(applySelectionClick(['a', 'b'], 'a', { additive: true }), ['b'])
})

test('intersectsRect handles reversed drag rectangles', () => {
  const rect = { x: 200, y: 200, width: -100, height: -80 }
  assert.equal(intersectsRect(rect, { x: 120, y: 130, width: 20, height: 20 }), true)
  assert.equal(intersectsRect(rect, { x: 20, y: 20, width: 20, height: 20 }), false)
})

test('idsInSelectionRect returns visible node and group ids whose screen boxes intersect', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const ids = idsInSelectionRect(layout, { x: grid.x - 5, y: grid.y - 5, width: heapGroup.x - grid.x + 20, height: heapGroup.y - grid.y + 20 }, { x: 0, y: 0, scale: 1 })
  assert.ok(ids.includes('grid-tie'))
  assert.ok(ids.includes(heapGroup.id))
})

test('buildSelectionRelations marks parent children relation edges and unrelated ids', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const relations = buildSelectionRelations(graph, layout, ['grid-tie'])

  assert.equal(relations.selectedIds.has('grid-tie'), true)
  assert.equal(relations.highlightedIds.has('energy-root'), true)
  assert.equal(relations.highlightedIds.has('feeder-2'), true)
  assert.equal(relations.dimmedIds.has('heap-1'), true)
  assert.equal(relations.highlightedEdgeIds.has('tree:energy-root:grid-tie'), true)
  assert.equal(relations.dimmedEdgeIds.has('tree:energy-root:heap-1'), true)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- test/minimap-selection.test.js
```

Expected: FAIL because `src/minimap/selection.js` does not exist.

- [ ] **Step 3: Implement pure helpers**

Create `src/minimap/selection.js`:

```js
import { worldRectToScreen, resolveEdges } from './renderer.js'

export function normalizeRect(rect) {
  const x = Math.min(rect.x, rect.x + rect.width)
  const y = Math.min(rect.y, rect.y + rect.height)
  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

export function intersectsRect(a, b) {
  const ra = normalizeRect(a)
  const rb = normalizeRect(b)
  return (
    ra.x <= rb.x + rb.width &&
    ra.x + ra.width >= rb.x &&
    ra.y <= rb.y + rb.height &&
    ra.y + ra.height >= rb.y
  )
}

export function applySelectionClick(currentIds, id, { additive = false } = {}) {
  if (!additive) return [id]
  return currentIds.includes(id) ? currentIds.filter((item) => item !== id) : [...currentIds, id]
}

export function idsInSelectionRect(layout, screenRect, viewport) {
  const ids = []
  for (const item of layout.visibleItems) {
    if ((item.type === 'node' || item.type === 'group') && intersectsRect(screenRect, worldRectToScreen(item, viewport))) {
      ids.push(item.id)
    }
  }
  return ids
}

function addNodeRelations(graph, id, relatedIds) {
  const node = graph.nodes.get(id)
  if (!node) return
  if (node.parentId) relatedIds.add(node.parentId)
  for (const childId of node.children || []) relatedIds.add(childId)
  for (const edge of graph.edges || []) {
    if (edge.source === id) relatedIds.add(edge.target)
    if (edge.target === id) relatedIds.add(edge.source)
  }
}

function addGroupRelations(graph, group, relatedIds) {
  if (group.parentId) relatedIds.add(group.parentId)
  for (const childId of group.children) {
    relatedIds.add(childId)
    addNodeRelations(graph, childId, relatedIds)
  }
}

function endpointIdsFor(edge) {
  return [edge.fromBox?.id, edge.toBox?.id].filter(Boolean)
}

function edgeTouchesSelected(edge, selected, groupsById) {
  const endpointIds = endpointIdsFor(edge)
  if (endpointIds.some((id) => selected.has(id))) return true
  for (const selectedId of selected) {
    const group = groupsById.get(selectedId)
    if (group && endpointIds.some((id) => group.children.includes(id))) return true
  }
  return false
}

export function buildSelectionRelations(graph, layout, selectedIds) {
  const selected = new Set(selectedIds)
  const highlightedIds = new Set()
  const highlightedEdgeIds = new Set()
  const dimmedIds = new Set()
  const dimmedEdgeIds = new Set()

  if (selected.size === 0) {
    return { selectedIds: selected, highlightedIds, dimmedIds, highlightedEdgeIds, dimmedEdgeIds }
  }

  const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
  for (const id of selected) {
    const group = groupsById.get(id)
    if (group) addGroupRelations(graph, group, highlightedIds)
    else addNodeRelations(graph, id, highlightedIds)
  }

  for (const edge of resolveEdges(graph, layout)) {
    if (edgeTouchesSelected(edge, selected, groupsById)) highlightedEdgeIds.add(edge.id)
    else dimmedEdgeIds.add(edge.id)
  }

  for (const item of layout.visibleItems) {
    if (item.type !== 'node' && item.type !== 'group') continue
    if (!selected.has(item.id) && !highlightedIds.has(item.id)) dimmedIds.add(item.id)
  }

  return { selectedIds: selected, highlightedIds, dimmedIds, highlightedEdgeIds, dimmedEdgeIds }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm test -- test/minimap-selection.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/selection.js test/minimap-selection.test.js
git commit -m "feat: add minimap selection helpers"
```

---

### Task 2: Renderer Highlight and Marquee Drawing

**Files:**
- Modify: `src/minimap/renderer.js`
- Test: `test/minimap-renderer.test.js`

- [ ] **Step 1: Write failing renderer tests**

Append to `test/minimap-renderer.test.js`:

```js
test('custom renderers receive selected highlighted and dimmed state sets', () => {
  const ctx = createMockCtx()
  const seenNodes = new Map()
  const seenGroups = new Map()
  const seenEdges = new Map()
  const scene = demoScene()
  const group = scene.layout.groups.find((item) => item.parentId === 'heap-1')

  renderScene(ctx, {
    ...scene,
    state: {
      selectedIds: new Set(['grid-tie']),
      highlightedIds: new Set(['energy-root']),
      dimmedIds: new Set([group.id]),
      highlightedEdgeIds: new Set(['tree:energy-root:grid-tie']),
      dimmedEdgeIds: new Set(['tree:group:' + group.id]),
    },
    renderers: {
      node: (_ctx, { node, state }) => seenNodes.set(node.id, state),
      group: (_ctx, { group, state }) => seenGroups.set(group.id, state),
      edge: (_ctx, { edge, state }) => seenEdges.set(edge.id, state),
    },
  })

  assert.equal(seenNodes.get('grid-tie').selected, true)
  assert.equal(seenNodes.get('energy-root').highlighted, true)
  assert.equal(seenGroups.get(group.id).dimmed, true)
  assert.equal(seenEdges.get('tree:energy-root:grid-tie').highlighted, true)
  assert.equal(seenEdges.get('tree:group:' + group.id).dimmed, true)
})

test('renderScene draws active selection rectangle after graph items', () => {
  const ctx = createMockCtx()
  renderScene(ctx, demoScene({ state: { selectionRect: { x: 10, y: 20, width: 100, height: 80 } } }))

  const lastStrokeRect = ctx.methodsOf('strokeRect').at(-1)
  assert.deepEqual(lastStrokeRect.args, [10, 20, 100, 80])
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- test/minimap-renderer.test.js
```

Expected: FAIL because edge custom payload lacks `state`, node/group states do not read highlight/dim sets, and no selection rect is drawn.

- [ ] **Step 3: Update renderer state plumbing**

In `src/minimap/renderer.js`:

```js
function makeState(id, selectedIds, highlightedIds, dimmedIds) {
  return {
    selected: selectedIds ? selectedIds.has(id) : false,
    hovered: false,
    dragging: false,
    highlighted: highlightedIds ? highlightedIds.has(id) : false,
    dimmed: dimmedIds ? dimmedIds.has(id) : false,
    readonly: false,
  }
}

function edgeState(edge, state) {
  return {
    selected: false,
    hovered: false,
    dragging: false,
    highlighted: state.highlightedEdgeIds ? state.highlightedEdgeIds.has(edge.id) : false,
    dimmed: state.dimmedEdgeIds ? state.dimmedEdgeIds.has(edge.id) : false,
    readonly: false,
  }
}
```

Change `drawNode`, `drawGroup`, and `drawEdge` to lower `ctx.globalAlpha` for `state.dimmed` and restore it afterwards. Keep visuals conservative:

```js
const previousAlpha = ctx.globalAlpha ?? 1
if (state.dimmed) ctx.globalAlpha = previousAlpha * 0.35
// existing drawing
ctx.globalAlpha = previousAlpha
```

Change custom renderer calls:

```js
renderers.edge(ctx, { edge: edgePayload(edge), from, to, state: edgeState(edge, state), theme, viewport })
```

Change node/group state creation to:

```js
const itemState = makeState(item.id, selectedIds, state.highlightedIds, state.dimmedIds)
```

For group children, pass the additional sets into `drawGroupChildren` and call `makeState(child.id, selectedIds, highlightedIds, dimmedIds)`.

Add a small rectangle overlay helper:

```js
function drawSelectionRect(ctx, rect, theme) {
  const previousAlpha = ctx.globalAlpha ?? 1
  ctx.globalAlpha = 0.16
  ctx.fillStyle = theme.node.selectedStroke
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.globalAlpha = previousAlpha
  ctx.strokeStyle = theme.node.selectedStroke
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.setLineDash([])
  ctx.globalAlpha = previousAlpha
}
```

At the end of `renderScene`, after nodes:

```js
if (state.selectionRect) drawSelectionRect(ctx, state.selectionRect, theme)
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm test -- test/minimap-renderer.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/renderer.js test/minimap-renderer.test.js
git commit -m "feat: render selection highlight state"
```

---

### Task 3: Vue Multi-Select and Esc Clear

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-select.test.js`

- [ ] **Step 1: Write failing Vue selection tests**

In `test/minimap-select.test.js`, replace helper `dispatchPointerDown` with an options-aware version:

```js
function dispatchPointerDown(wrapper, point, options = {}) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
      shiftKey: options.shiftKey ?? false,
      metaKey: options.metaKey ?? false,
      ctrlKey: options.ctrlKey ?? false,
      pointerId: options.pointerId ?? 1,
    }),
  )
}
```

Append:

```js
test('modifier clicking adds and toggles selected nodes', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const heap = layout.nodes.get('heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 })
  dispatchPointerDown(wrapper, { x: heap.x + heap.width / 2, y: heap.y + heap.height / 2 }, { shiftKey: true })
  dispatchPointerDown(wrapper, { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 }, { metaKey: true })

  assert.deepEqual(wrapper.emitted('select')[0][0], ['grid-tie'])
  assert.deepEqual(wrapper.emitted('select')[1][0], ['grid-tie', 'heap-1'])
  assert.deepEqual(wrapper.emitted('select')[2][0], ['heap-1'])
  wrapper.destroy()
})

test('Escape clears selection after canvas is focused', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const canvasEl = wrapper.find('canvas').element

  dispatchPointerDown(wrapper, { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 })
  canvasEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])
  wrapper.destroy()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- test/minimap-select.test.js
```

Expected: FAIL because internal selection stores one id and canvas does not handle `keydown`.

- [ ] **Step 3: Implement multi-select state**

In `src/minimap/Minimap.vue`:

```js
let internalSelectedIds = []
```

Replace `currentSelectedIds`:

```js
function currentSelectedIds() {
  if (props.selectedIds !== null) return props.selectedIds
  return internalSelectedIds
}
```

Replace `setSelected`:

```js
function setSelected(ids) {
  const nextIds = [...ids]
  if (props.selectedIds === null) internalSelectedIds = nextIds
  emit('select', nextIds)
  renderCurrent()
}
```

Add:

```js
function isAdditiveSelection(event) {
  return event.shiftKey || event.metaKey || event.ctrlKey
}
```

Import and use `applySelectionClick` from `selection.js`:

```js
import { applySelectionClick, buildSelectionRelations } from './selection.js'
```

For node/group body click:

```js
setSelected(applySelectionClick(currentSelectedIds(), hit.id, { additive: isAdditiveSelection(event) }))
```

For non-drag group item pointerup click:

```js
setSelected(applySelectionClick(currentSelectedIds(), dragState.childId, { additive: dragState.additive }))
```

Store `additive: isAdditiveSelection(event)` when creating `dragState`.

Add keydown handler:

```js
function handleKeyDown(event) {
  if (event.key === 'Escape' && currentSelectedIds().length > 0) {
    event.preventDefault()
    setSelected([])
  }
}
```

On mount/unmount add/remove:

```js
canvas.addEventListener('keydown', handleKeyDown)
canvas.removeEventListener('keydown', handleKeyDown)
```

Make canvas focusable in template:

```html
<canvas ref="canvasRef" tabindex="0"></canvas>
```

Call focus in `handlePointerDown`:

```js
canvasRef.value.focus?.()
```

In `renderCurrent`, compute relations:

```js
const relations = buildSelectionRelations(props.graph, currentLayout, currentSelectedIds())
```

Pass sets to renderer state:

```js
selectedIds: relations.selectedIds,
highlightedIds: relations.highlightedIds,
dimmedIds: relations.dimmedIds,
highlightedEdgeIds: relations.highlightedEdgeIds,
dimmedEdgeIds: relations.dimmedEdgeIds,
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm test -- test/minimap-select.test.js test/minimap-selection.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-select.test.js
git commit -m "feat: support minimap multi selection"
```

---

### Task 4: Shift Blank Drag Marquee Selection

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-select.test.js`

- [ ] **Step 1: Write failing marquee tests**

Add pointer helpers to `test/minimap-select.test.js`:

```js
function dispatchPointerMove(wrapper, point, options = {}) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointermove', {
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
      shiftKey: options.shiftKey ?? false,
      pointerId: options.pointerId ?? 1,
    }),
  )
}

function dispatchPointerUp(wrapper, point, options = {}) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerup', {
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
      shiftKey: options.shiftKey ?? false,
      pointerId: options.pointerId ?? 1,
    }),
  )
}
```

Append:

```js
test('Shift dragging blank space selects visible items in the marquee and does not pan', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const heap = layout.nodes.get('heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, { x: grid.x - 10, y: grid.y - 10 }, { shiftKey: true })
  dispatchPointerMove(wrapper, { x: heap.x + heap.width + 10, y: heap.y + heap.height + 10 }, { shiftKey: true })
  dispatchPointerUp(wrapper, { x: heap.x + heap.width + 10, y: heap.y + heap.height + 10 }, { shiftKey: true })

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['grid-tie', 'heap-1'])
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('empty Shift marquee clears selection', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 })
  dispatchPointerDown(wrapper, { x: -1000, y: -1000 }, { shiftKey: true })
  dispatchPointerMove(wrapper, { x: -900, y: -900 }, { shiftKey: true })
  dispatchPointerUp(wrapper, { x: -900, y: -900 }, { shiftKey: true })

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])
  wrapper.destroy()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- test/minimap-select.test.js
```

Expected: FAIL because Shift blank drag still goes through pan/clear branch.

- [ ] **Step 3: Implement marquee state**

In `src/minimap/Minimap.vue`, import:

```js
import { applySelectionClick, buildSelectionRelations, idsInSelectionRect, normalizeRect } from './selection.js'
```

Add module state:

```js
let marqueeState = null
```

In `renderCurrent` state, add:

```js
selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
```

Add cancel helper:

```js
function cancelMarquee() {
  marqueeState = null
}
```

Add it to `cancelPointerInteractions`.

In `handlePointerDown`, for blank hit:

```js
if (!hit) {
  settleAnimation()
  canvasRef.value.setPointerCapture?.(event.pointerId)
  const startScreen = screenPointFromEvent(event)
  if (event.shiftKey) {
    marqueeState = {
      pointerId: event.pointerId,
      startScreen,
      rect: { x: startScreen.x, y: startScreen.y, width: 0, height: 0 },
      active: false,
    }
    renderCurrent()
    return
  }
  setSelected([])
  panState = {
    pointerId: event.pointerId,
    startScreen: { x: event.clientX, y: event.clientY },
    startViewport: currentViewport(),
    moved: false,
  }
  return
}
```

In `handlePointerMove`, before pan:

```js
if (marqueeState) {
  const point = screenPointFromEvent(event)
  marqueeState.rect = {
    x: marqueeState.startScreen.x,
    y: marqueeState.startScreen.y,
    width: point.x - marqueeState.startScreen.x,
    height: point.y - marqueeState.startScreen.y,
  }
  marqueeState.active = true
  renderCurrent()
  return
}
```

In `handlePointerUp`, before pan:

```js
if (marqueeState) {
  const ids = marqueeState.active ? idsInSelectionRect(layout, marqueeState.rect, currentViewport()) : []
  marqueeState = null
  setSelected(ids)
  return
}
```

- [ ] **Step 4: Run interaction regression tests**

Run:

```bash
npm test -- test/minimap-select.test.js test/minimap-viewport-interaction.test.js test/minimap-group-interaction.test.js
```

Expected: PASS. This specifically guards that blank non-Shift pan still pans, node drag still does not pan, and group internal drag still works.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-select.test.js
git commit -m "feat: add minimap marquee selection"
```

---

### Task 5: Documentation and Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-19-phase-3-view-selection.md`
- Modify: `docs/superpowers/plans/2026-06-19-phase-3-selection-highlight.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and Vite build succeeds.

- [ ] **Step 2: Run focused Phase 3 verification**

Run:

```bash
npm test -- test/minimap-selection.test.js test/minimap-select.test.js test/minimap-renderer.test.js test/minimap-viewport-interaction.test.js test/minimap-group-interaction.test.js
```

Expected: PASS.

- [ ] **Step 3: Browser/dev-server verification**

Start dev server:

```bash
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/` in the available Browser plugin if an in-app Browser instance is available. Verify:

- Click one node: only that node is selected.
- Shift/Cmd/Ctrl click another node: both become selected.
- Shift/Cmd/Ctrl click an already selected node: it is removed.
- Shift drag from blank area: a marquee rectangle appears and selected items match the rectangle.
- Click blank area: selection clears.
- Press Esc while canvas is focused: selection clears.
- Selected node highlights parent/children/related edges and unrelated items dim.

If Browser plugin has no available `iab` instance, record that limitation in this plan, the spec, and ROADMAP, and rely on the real pointer/keyboard component tests plus Canvas mock renderer tests.

- [ ] **Step 4: Update docs**

Update:

- `docs/superpowers/specs/2026-06-19-phase-3-view-selection.md`
  - Mark slice 2 complete.
  - Add commit range and verification results.
- `ROADMAP.md`
  - Mark third phase complete if all third phase acceptance bullets pass.
  - Set current phase/next step to Phase 4 planning.
  - Add completed slice entry for selection/highlight.
- This plan
  - Mark all progress items complete.
  - Add final verification notes.

- [ ] **Step 5: Commit docs**

```bash
git add ROADMAP.md docs/superpowers/specs/2026-06-19-phase-3-view-selection.md docs/superpowers/plans/2026-06-19-phase-3-selection-highlight.md
git commit -m "docs: mark selection highlight slice complete"
```

## Self-Review

- Spec coverage: The plan covers single click, modifier click, Shift blank marquee, blank/Esc clear, selected relationship highlight, dimming, controlled `selectedIds`, and renderer state.
- Out of scope: The plan does not implement node cross-parent move, fit/center/search/overview, delete/copy, before hooks, undo/redo, or readonly behavior.
- Risk areas: The plan explicitly protects Phase 2 group item drag and Phase 3 blank pan by focused regression tests.
- Completion record: code commits `e83086b..6d3755c`; `npm test` 183 all passing; `npm run build` passing; dev server `http://127.0.0.1:5173/` reachable; Browser plugin still had no available `iab`, so verification used jsdom + Canvas mock + real component keyboard/pointer events.
