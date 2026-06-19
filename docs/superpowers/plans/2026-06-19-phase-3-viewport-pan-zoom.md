# Phase 3 Viewport Pan Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 3 slice 1: controlled/uncontrolled viewport state, blank-canvas panning, wheel zoom anchored under the cursor, zoom bounds, and `viewport-change` events.

**Architecture:** Keep viewport math in a new pure `src/minimap/viewport.js` module so pan/zoom behavior is testable without Vue. `Minimap.vue` owns pointer/wheel routing and uses the same `currentViewport()`/`setViewport()` controlled-state pattern as `selectedIds` and `groupStates`. Existing group wheel scrolling keeps priority; canvas zoom only runs when wheel does not hit a scrollable group.

**Tech Stack:** Vue 2.7 SFC, Canvas 2D, Node `node:test`, existing jsdom/@vue/test-utils helpers, no new dependencies.

---

## Progress

- [x] Task 1: Add pure viewport math
- [x] Task 2: Wire controlled/uncontrolled viewport state
- [x] Task 3: Add wheel zoom
- [x] Task 4: Add blank-canvas pan
- [x] Task 5: Update docs and verify in browser

Completion note: implementation landed in commits `29c8ccb..2af8e4c`. Verification run on 2026-06-19: `npm test` passed 172/172; `npm run build` passed; `curl -fsSL http://127.0.0.1:5173/` confirmed the dev server served the app shell; `npm test -- test/minimap-viewport-interaction.test.js test/minimap-group-interaction.test.js test/minimap-select.test.js` passed 40/40 for wheel/pointer interaction coverage. In-app Browser verification could not run because the Browser plugin reported no available `iab` browser instance.

## File Structure

- Create `src/minimap/viewport.js`
  - Pure helpers: `DEFAULT_VIEWPORT`, `viewportOptions`, `normalizeViewport`, `clampScale`, `sameViewport`, `zoomViewportAt`, `panViewportBy`.
  - No Vue, DOM, or Canvas dependencies.
- Create `test/minimap-viewport.test.js`
  - Unit tests for zoom anchor stability, scale clamping, pan deltas, and normalization.
- Create `test/minimap-viewport-interaction.test.js`
  - Vue/component tests for `viewport` prop, `viewport-change`, group-wheel priority, wheel zoom, and blank pan.
- Modify `src/minimap/Minimap.vue`
  - Add `viewport` prop and `viewport-change` event.
  - Replace module-level direct viewport reads/writes with `currentViewport()` and `applyViewport()`.
  - Add `panState` for blank-canvas drag.
  - Extend `handleWheel` with canvas zoom fallback after group scroll handling declines the event.
- Modify `docs/superpowers/specs/2026-06-19-phase-3-view-selection.md`
  - Mark slice 1 complete after implementation and verification.
- Modify `ROADMAP.md`
  - Add slice 1 to completed slices with commit range and verification results, then set next step to slice 2 plan.

---

## Task 1: Add Pure Viewport Math

**Files:**
- Create: `src/minimap/viewport.js`
- Create: `test/minimap-viewport.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/minimap-viewport.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { screenToWorld } from '../src/minimap/coords.js'
import {
  DEFAULT_VIEWPORT,
  clampScale,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  viewportOptions,
  zoomViewportAt,
} from '../src/minimap/viewport.js'

function assertApprox(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)
}

test('viewportOptions returns defaults and accepts overrides', () => {
  assert.deepEqual(viewportOptions(null), { minScale: 0.25, maxScale: 3, zoomSensitivity: 0.0015 })
  assert.deepEqual(viewportOptions({ minScale: 0.5, maxScale: 2, zoomSensitivity: 0.002 }), {
    minScale: 0.5,
    maxScale: 2,
    zoomSensitivity: 0.002,
  })
})

test('normalizeViewport fills missing values and clamps scale', () => {
  assert.deepEqual(normalizeViewport(null), DEFAULT_VIEWPORT)
  assert.deepEqual(normalizeViewport({ x: 12 }), { x: 12, y: 0, scale: 1 })
  assert.deepEqual(normalizeViewport({ x: 1, y: 2, scale: 10 }, { minScale: 0.5, maxScale: 2 }), {
    x: 1,
    y: 2,
    scale: 2,
  })
})

test('clampScale respects min and max bounds even if options are reversed', () => {
  assert.equal(clampScale(0.1, { minScale: 0.25, maxScale: 3 }), 0.25)
  assert.equal(clampScale(5, { minScale: 0.25, maxScale: 3 }), 3)
  assert.equal(clampScale(0.1, { minScale: 3, maxScale: 0.25 }), 0.25)
})

test('zoomViewportAt keeps the cursor world point stable', () => {
  const beforeViewport = { x: -100, y: 50, scale: 1 }
  const screenPoint = { x: 300, y: 240 }
  const beforeWorld = screenToWorld(screenPoint, beforeViewport)
  const next = zoomViewportAt(beforeViewport, screenPoint, -200, {
    minScale: 0.25,
    maxScale: 3,
    zoomSensitivity: 0.0015,
  })
  const afterWorld = screenToWorld(screenPoint, next)

  assert.ok(next.scale > beforeViewport.scale)
  assertApprox(afterWorld.x, beforeWorld.x)
  assertApprox(afterWorld.y, beforeWorld.y)
})

test('zoomViewportAt clamps scale at both boundaries', () => {
  const point = { x: 100, y: 100 }
  assert.equal(zoomViewportAt({ x: 0, y: 0, scale: 2.9 }, point, -1000, { minScale: 0.25, maxScale: 3 }).scale, 3)
  assert.equal(zoomViewportAt({ x: 0, y: 0, scale: 0.3 }, point, 1000, { minScale: 0.25, maxScale: 3 }).scale, 0.25)
})

test('panViewportBy offsets x and y without changing scale', () => {
  assert.deepEqual(panViewportBy({ x: 10, y: -5, scale: 2 }, { x: 30, y: -20 }), {
    x: 40,
    y: -25,
    scale: 2,
  })
})

test('sameViewport compares x y and scale', () => {
  assert.equal(sameViewport({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0, scale: 1 }), true)
  assert.equal(sameViewport({ x: 0, y: 0, scale: 1 }, { x: 0, y: 1, scale: 1 }), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/minimap-viewport.test.js
```

Expected: FAIL with an import error for `../src/minimap/viewport.js`.

- [ ] **Step 3: Implement viewport helpers**

Create `src/minimap/viewport.js`:

```js
import { screenToWorld } from './coords.js'

export const DEFAULT_VIEWPORT = Object.freeze({ x: 0, y: 0, scale: 1 })

const DEFAULT_OPTIONS = Object.freeze({
  minScale: 0.25,
  maxScale: 3,
  zoomSensitivity: 0.0015,
})

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

export function viewportOptions(options = null) {
  const rawMin = finiteOr(options?.minScale, DEFAULT_OPTIONS.minScale)
  const rawMax = finiteOr(options?.maxScale, DEFAULT_OPTIONS.maxScale)
  return {
    minScale: Math.min(rawMin, rawMax),
    maxScale: Math.max(rawMin, rawMax),
    zoomSensitivity: finiteOr(options?.zoomSensitivity, DEFAULT_OPTIONS.zoomSensitivity),
  }
}

export function clampScale(scale, options = DEFAULT_OPTIONS) {
  const normalized = viewportOptions(options)
  return Math.min(normalized.maxScale, Math.max(normalized.minScale, finiteOr(scale, DEFAULT_VIEWPORT.scale)))
}

export function normalizeViewport(viewport, options = DEFAULT_OPTIONS) {
  return {
    x: finiteOr(viewport?.x, DEFAULT_VIEWPORT.x),
    y: finiteOr(viewport?.y, DEFAULT_VIEWPORT.y),
    scale: clampScale(viewport?.scale, options),
  }
}

export function sameViewport(a, b) {
  return a.x === b.x && a.y === b.y && a.scale === b.scale
}

export function zoomViewportAt(viewport, screenPoint, deltaY, options = DEFAULT_OPTIONS) {
  const normalizedOptions = viewportOptions(options)
  const before = normalizeViewport(viewport, normalizedOptions)
  const worldPoint = screenToWorld(screenPoint, before)
  const zoomFactor = Math.exp(-deltaY * normalizedOptions.zoomSensitivity)
  const nextScale = clampScale(before.scale * zoomFactor, normalizedOptions)
  return {
    x: screenPoint.x - worldPoint.x * nextScale,
    y: screenPoint.y - worldPoint.y * nextScale,
    scale: nextScale,
  }
}

export function panViewportBy(viewport, delta) {
  const before = normalizeViewport(viewport)
  return {
    x: before.x + delta.x,
    y: before.y + delta.y,
    scale: before.scale,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- test/minimap-viewport.test.js
```

Expected: PASS for all `minimap-viewport` tests.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/viewport.js test/minimap-viewport.test.js
git commit -m "feat: add viewport pan zoom math"
```

---

## Task 2: Wire Controlled/Uncontrolled Viewport State

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Create: `test/minimap-viewport-interaction.test.js`

- [ ] **Step 1: Write failing component tests for viewport state**

Create `test/minimap-viewport-interaction.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubAnimationFrame, stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()
stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

function callsSinceLastClear(ctx) {
  const lastClear = ctx.calls.map((call) => call.method).lastIndexOf('clearRect')
  return ctx.calls.slice(lastClear + 1)
}

function renderedRectForLabel(ctx, label) {
  const calls = callsSinceLastClear(ctx)
  const labelIndex = calls.findIndex((call) => call.method === 'fillText' && call.args[0] === label)
  assert.notEqual(labelIndex, -1)
  const rectCall = calls.slice(0, labelIndex).findLast((call) => call.method === 'strokeRect')
  assert.ok(rectCall)
  const [x, y, width, height] = rectCall.args
  return { x, y, width, height }
}

test('viewport prop renders the graph with the supplied transform', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mount(Minimap, { propsData: { graph, viewport: { x: 100, y: 50, scale: 2 } } })
  const ctx = contexts.at(-1)
  const rect = renderedRectForLabel(ctx, 'Grid Tie')
  const world = layout.nodes.get('grid-tie')

  assert.equal(rect.x, world.x * 2 + 100)
  assert.equal(rect.y, world.y * 2 + 50)
  assert.equal(rect.width, world.width * 2)
  assert.equal(rect.height, world.height * 2)
  wrapper.destroy()
})

test('changing viewport prop re-renders without recomputing graph data', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, viewport: { x: 0, y: 0, scale: 1 } } })
  const ctx = contexts.at(-1)
  const before = renderedRectForLabel(ctx, 'Grid Tie')

  await wrapper.setProps({ viewport: { x: 80, y: 20, scale: 1 } })
  await wrapper.vm.$nextTick()

  const after = renderedRectForLabel(ctx, 'Grid Tie')
  assert.equal(after.x, before.x + 80)
  assert.equal(after.y, before.y + 20)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/minimap-viewport-interaction.test.js
```

Expected: FAIL because `Minimap.vue` does not define a `viewport` prop and still renders with `{ x: 0, y: 0, scale: 1 }`.

- [ ] **Step 3: Add viewport prop and state helpers**

In `src/minimap/Minimap.vue`, update imports:

```js
import {
  DEFAULT_VIEWPORT,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  viewportOptions,
  zoomViewportAt,
} from './viewport.js'
```

Add prop and event:

```js
viewport: { type: Object, default: null },
```

```js
const emit = defineEmits([
  'select',
  'node-drop',
  'change',
  'group-state-change',
  'group-reorder',
  'viewport-change',
])
```

Replace the old module viewport declaration:

```js
let internalViewport = { ...DEFAULT_VIEWPORT }
```

Add helpers near `currentGroupStates()`:

```js
function currentViewport() {
  return normalizeViewport(props.viewport ?? internalViewport, viewportOptions(props.options))
}

function applyViewport(nextViewport, { emitChange = true } = {}) {
  const next = normalizeViewport(nextViewport, viewportOptions(props.options))
  const previous = currentViewport()
  if (sameViewport(previous, next)) return false
  if (props.viewport === null) internalViewport = next
  if (emitChange) emit('viewport-change', next)
  renderCurrent(layout, next)
  return true
}
```

Then replace direct `viewport` reads in render/time-sensitive paths:

```js
function renderCurrent(currentLayout = layout, currentViewport = currentViewport()) {
  // keep body unchanged
}
```

Use a different parameter name to avoid shadowing:

```js
function renderCurrent(currentLayout = layout, renderViewport = currentViewport()) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...renderViewport }
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: renderViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: {
      selectedIds: new Set(currentSelectedIds()),
      groupDrag: dragRenderContext(),
      groupScrollbarHoverId: hoveredScrollbarGroupId,
    },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
}
```

In `finishLayout`, set internal state through a helper that does not emit on layout animation completion:

```js
function commitViewportSilently(nextViewport) {
  const next = normalizeViewport(nextViewport, viewportOptions(props.options))
  if (props.viewport === null) internalViewport = next
}

function finishLayout(nextLayout, nextViewport) {
  layout = nextLayout
  settledLayout = nextLayout
  commitViewportSilently(nextViewport)
  renderCurrent(layout, currentViewport())
}
```

Update `targetViewportFor`, `updateLayout`, `pointFromEvent`, `ghostRectForPoint`, and scrollbar math to use `currentViewport()` where they currently read `viewport`.

Add a watcher:

```js
watch(() => props.viewport, () => renderCurrent())
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- test/minimap-viewport-interaction.test.js test/minimap-shell.test.js test/minimap-group-interaction.test.js
```

Expected: PASS. If existing layout animation tests fail because `finishLayout` no longer stores compensated viewport, ensure uncontrolled `commitViewportSilently()` writes `internalViewport`.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-viewport-interaction.test.js
git commit -m "feat: support controlled minimap viewport"
```

---

## Task 3: Add Wheel Zoom

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-viewport-interaction.test.js`

- [ ] **Step 1: Add failing wheel zoom tests**

Append to `test/minimap-viewport-interaction.test.js`:

```js
function dispatchWheel(wrapper, point, deltaY) {
  const canvasEl = wrapper.find('canvas').element
  const event = new WheelEvent('wheel', {
    clientX: point.x,
    clientY: point.y,
    deltaY,
    bubbles: true,
    cancelable: true,
  })
  canvasEl.dispatchEvent(event)
  return event
}

function groupCenterForParent(parentId) {
  const layout = computeLayout(createDemoGraph(), { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const group = layout.groups.find((item) => item.parentId === parentId)
  return { x: group.x + group.width / 2, y: group.y + group.height / 2, groupId: group.id }
}

test('wheel zoom emits viewport-change and keeps the cursor world point stable', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const point = { x: 300, y: 240 }

  const event = dispatchWheel(wrapper, point, -200)

  assert.equal(event.defaultPrevented, true)
  const next = wrapper.emitted('viewport-change')[0][0]
  assert.ok(next.scale > 1)
  assert.ok(Math.abs((point.x - next.x) / next.scale - point.x) < 0.000001)
  assert.ok(Math.abs((point.y - next.y) / next.scale - point.y) < 0.000001)
  wrapper.destroy()
})

test('wheel zoom clamps scale using options bounds', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: { graph, options: { minScale: 0.75, maxScale: 1.2, zoomSensitivity: 0.01 } },
  })

  dispatchWheel(wrapper, { x: 100, y: 100 }, -1000)
  dispatchWheel(wrapper, { x: 100, y: 100 }, -1000)

  assert.equal(wrapper.emitted('viewport-change').at(-1)[0].scale, 1.2)
  wrapper.destroy()
})

test('wheel inside an overflowing group scrolls the group instead of zooming the canvas', () => {
  const graph = createDemoGraph()
  const { x, y } = groupCenterForParent('heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchWheel(wrapper, { x, y }, 200)

  assert.equal(wrapper.emitted('viewport-change'), undefined)
  assert.ok(wrapper.emitted('group-state-change').length > 0)
  wrapper.destroy()
})

test('controlled viewport wheel zoom emits but does not persist without prop update', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, viewport: { x: 0, y: 0, scale: 1 } } })
  const ctx = contexts.at(-1)
  const before = renderedRectForLabel(ctx, 'Grid Tie')

  dispatchWheel(wrapper, { x: 200, y: 200 }, -200)

  const after = renderedRectForLabel(ctx, 'Grid Tie')
  assert.deepEqual(after, before)
  assert.ok(wrapper.emitted('viewport-change')[0][0].scale > 1)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/minimap-viewport-interaction.test.js
```

Expected: FAIL because wheel outside groups does not zoom and `viewport-change` is not emitted.

- [ ] **Step 3: Implement wheel zoom fallback**

Refactor `handleWheel` in `src/minimap/Minimap.vue`:

```js
function screenPointFromEvent(event) {
  const rect = canvasRef.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function pointFromEvent(event) {
  return screenToWorld(screenPointFromEvent(event), currentViewport())
}

function handleWheel(event) {
  if (!layout) return
  const point = pointFromEvent(event)
  const hit = hitTest(layout, point)
  if (hit?.type === 'group') {
    const group = layout.groups.find((g) => g.id === hit.id)
    if (group?.overflowY) {
      event.preventDefault()
      const rawScrollTop = group.scrollTop + event.deltaY
      const nextScrollTop = clampGroupScroll(group, rawScrollTop)
      if (props.groupStates === null) group.scrollTop = nextScrollTop
      updateGroupState(group.id, { scrollTop: nextScrollTop })
      if (props.groupStates !== null) updateLayout({ animate: false, preserveAnchor: false })
      else renderCurrent()
      return
    }
  }

  event.preventDefault()
  const nextViewport = zoomViewportAt(
    currentViewport(),
    screenPointFromEvent(event),
    event.deltaY,
    viewportOptions(props.options),
  )
  applyViewport(nextViewport)
}
```

Ensure `pointFromEvent`, drag ghost, drop insertion, and scrollbar code all use `currentViewport()` after this refactor.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- test/minimap-viewport-interaction.test.js test/minimap-group-interaction.test.js
```

Expected: PASS. Existing group wheel tests must still pass and must not emit `viewport-change`.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-viewport-interaction.test.js
git commit -m "feat: zoom minimap viewport with wheel"
```

---

## Task 4: Add Blank-Canvas Pan

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-viewport-interaction.test.js`

- [ ] **Step 1: Add failing blank-pan tests**

Append to `test/minimap-viewport-interaction.test.js`:

```js
function dispatchPointerDown(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, pointerId: 10, bubbles: true }),
  )
}

function dispatchPointerMove(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointermove', { clientX: point.x, clientY: point.y, pointerId: 10, bubbles: true }),
  )
}

function dispatchPointerUp(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerup', { clientX: point.x, clientY: point.y, pointerId: 10, bubbles: true }),
  )
}

function dispatchPointerCancel(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointercancel', { clientX: point.x, clientY: point.y, pointerId: 10, bubbles: true }),
  )
}

test('dragging blank space pans the viewport and emits viewport-change', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, { x: -10000, y: -10000 })
  dispatchPointerMove(wrapper, { x: -9900, y: -10040 })
  dispatchPointerUp(wrapper, { x: -9900, y: -10040 })

  assert.deepEqual(wrapper.emitted('viewport-change').at(-1)[0], { x: 100, y: -40, scale: 1 })
  assert.deepEqual(wrapper.emitted('select')[0][0], [])
  wrapper.destroy()
})

test('controlled viewport pan emits but does not persist without prop update', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, viewport: { x: 0, y: 0, scale: 1 } } })
  const ctx = contexts.at(-1)
  const before = renderedRectForLabel(ctx, 'Grid Tie')

  dispatchPointerDown(wrapper, { x: -10000, y: -10000 })
  dispatchPointerMove(wrapper, { x: -9900, y: -10040 })
  dispatchPointerUp(wrapper, { x: -9900, y: -10040 })

  const after = renderedRectForLabel(ctx, 'Grid Tie')
  assert.deepEqual(after, before)
  assert.deepEqual(wrapper.emitted('viewport-change').at(-1)[0], { x: 100, y: -40, scale: 1 })
  wrapper.destroy()
})

test('pointercancel stops an active blank pan', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, { x: -10000, y: -10000 })
  dispatchPointerMove(wrapper, { x: -9950, y: -9950 })
  const emittedBeforeCancel = wrapper.emitted('viewport-change').length
  dispatchPointerCancel(wrapper, { x: -9950, y: -9950 })
  dispatchPointerMove(wrapper, { x: -9900, y: -9900 })

  assert.equal(wrapper.emitted('viewport-change').length, emittedBeforeCancel)
  wrapper.destroy()
})

test('dragging from a node does not pan the viewport in phase 3', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const point = { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 }
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, point)
  dispatchPointerMove(wrapper, { x: point.x + 80, y: point.y + 20 })
  dispatchPointerUp(wrapper, { x: point.x + 80, y: point.y + 20 })

  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/minimap-viewport-interaction.test.js
```

Expected: FAIL because blank pointer drag currently only clears selection and does not pan.

- [ ] **Step 3: Implement pan state**

In `src/minimap/Minimap.vue`, add module state:

```js
let panState = null
```

In `cancelPointerInteractions()` add pan cleanup:

```js
function cancelPan() {
  panState = null
}

function cancelPointerInteractions() {
  cancelDrag()
  cancelScrollbarDrag()
  cancelPan()
}
```

In `handlePointerDown`, replace the final blank-hit branch:

```js
if (!hit) {
  canvasRef.value.setPointerCapture?.(event.pointerId)
  setSelected([])
  panState = {
    pointerId: event.pointerId,
    startScreen: { x: event.clientX, y: event.clientY },
    startViewport: currentViewport(),
    moved: false,
  }
  return
}

setSelected([hit.id])
```

At the top of `handlePointerMove` after scrollbar handling and before dragState handling:

```js
if (panState) {
  const delta = {
    x: event.clientX - panState.startScreen.x,
    y: event.clientY - panState.startScreen.y,
  }
  panState.moved = panState.moved || delta.x !== 0 || delta.y !== 0
  applyViewport(panViewportBy(panState.startViewport, delta))
  return
}
```

At the start of `handlePointerUp`:

```js
if (panState) {
  panState = null
  return
}
```

Do not start panning on node, group body, group header, group item, or scrollbar hits.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- test/minimap-viewport-interaction.test.js test/minimap-select.test.js test/minimap-group-interaction.test.js
```

Expected: PASS. Existing blank-click selection clearing must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-viewport-interaction.test.js
git commit -m "feat: pan minimap viewport from blank canvas"
```

---

## Task 5: Update Docs and Verify in Browser

**Files:**
- Modify: `docs/superpowers/specs/2026-06-19-phase-3-view-selection.md`
- Modify: `docs/superpowers/plans/2026-06-19-phase-3-viewport-pan-zoom.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and build completes.

- [ ] **Step 2: Browser verification**

Start the app:

```bash
npm run dev -- --host 127.0.0.1
```

Use the in-app Browser to verify:

- Wheel over blank canvas zooms around the cursor.
- Wheel inside `heap-1` or `cluster-25` overflowing group scrolls that group and does not zoom the canvas.
- Drag blank canvas pans.
- Clicking/dragging on a node does not pan.
- Passing a controlled `viewport` in a test harness/demo keeps display controlled until prop update.

If the app has no direct UI toggle for controlled `viewport`, use automated component tests as the controlled-mode verification and record that in the docs.

- [ ] **Step 3: Update docs**

Update `docs/superpowers/specs/2026-06-19-phase-3-view-selection.md`:

```markdown
## 阶段状态

- [x] 切片 1：视口平移缩放
- [ ] 切片 2：选择模型和高亮

当前下一步：为切片 2「选择模型和高亮」写实施计划。
```

Update `ROADMAP.md` current progress:

```markdown
- **当前阶段计划**：[视口平移缩放](docs/superpowers/plans/2026-06-19-phase-3-viewport-pan-zoom.md)；下一步创建切片 2「选择模型和高亮」计划。
...
  - 视口平移缩放 `viewport.js` / `Minimap.vue` 受控 viewport + wheel zoom + blank pan + 测试（[plan](docs/superpowers/plans/2026-06-19-phase-3-viewport-pan-zoom.md)，`npm test` 与 `npm run build` 通过，浏览器验收通过）
...
  - [x] 切片 1：视口平移缩放（`viewport` 受控/非受控、空白拖拽平移、滚轮缩放、缩放边界、`viewport-change`）
  - [ ] 切片 2：选择模型和高亮（单选、多选、框选、空白/Esc 清空、父级/子级/相关连线高亮、非相关元素降权）
- **下一步**：写切片 2「选择模型和高亮」实施计划。
- **待办切片**：第三阶段切片 2「选择模型和高亮」。
```

At the top of this plan, mark Progress Task 1-5 as `[x]`.

- [ ] **Step 4: Run doc self-check**

Run:

```bash
node -e "const fs=require('fs'); const files=['docs/superpowers/plans/2026-06-19-phase-3-viewport-pan-zoom.md','docs/superpowers/specs/2026-06-19-phase-3-view-selection.md','ROADMAP.md']; const words=['\\u5360\\u4f4d\\u7b26','\\u672a\\u5b8c\\u6210\\u6761\\u76ee','\\u7a0d\\u540e\\u8865\\u5145']; let bad=false; for (const f of files) { const s=fs.readFileSync(f,'utf8'); for (const w of words) if (s.includes(w)) { console.error(f+': '+w); bad=true } } process.exit(bad?1:0)"
git diff --check
```

Expected: no placeholder hits and no whitespace errors.

- [ ] **Step 5: Commit docs**

```bash
git add ROADMAP.md docs/superpowers/specs/2026-06-19-phase-3-view-selection.md docs/superpowers/plans/2026-06-19-phase-3-viewport-pan-zoom.md
git commit -m "docs: mark viewport pan zoom slice complete"
```

---

## Plan Self-Review

- Spec coverage:
  - `viewport` prop and `viewport-change`: Task 2.
  - `options.minScale/maxScale/zoomSensitivity`: Task 1 and Task 3.
  - Wheel zoom anchored under cursor: Task 1 and Task 3.
  - Blank-canvas pan: Task 4.
  - Group wheel priority: Task 3.
  - Controlled/uncontrolled behavior: Task 2, Task 3, Task 4.
  - Browser verification: Task 5.
- Placeholder scan: no placeholder markers are intentionally present in this plan.
- Type consistency:
  - All viewport objects use `{ x, y, scale }`.
  - All events use `viewport-change`.
  - Helper names match the planned `src/minimap/viewport.js` exports.
