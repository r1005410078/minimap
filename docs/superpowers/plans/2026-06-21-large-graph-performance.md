# Large Graph Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make large, zoomed-out graphs responsive during pan and marquee interactions by adding render scheduling and zoom-aware render quality.

**Architecture:** Keep `Minimap.vue` as the orchestration layer. Move interaction frame coalescing into `render-scheduler.js` and zoom/interaction quality decisions into `render-quality.js`, then pass a small `quality` object into `renderScene()`.

**Tech Stack:** Vue 2.7 `<script setup>`, Canvas 2D, Node test runner, existing jsdom/canvas mocks.

---

## File Structure

- Create `src/minimap/render-scheduler.js`
  - Owns requestAnimationFrame coalescing.
  - Exposes `createRenderScheduler({ render, requestFrame, cancelFrame })`.
  - Has no Vue dependency.
- Create `src/minimap/render-quality.js`
  - Owns quality level decisions from viewport scale and interaction state.
  - Exposes `resolveRenderQuality(input)`.
  - Has no Vue dependency.
- Modify `src/minimap/renderer.js`
  - Accept `scene.quality`.
  - Skip node text in `compact` and `overview`.
  - Skip grouped child item details in `overview`.
  - Keep default behavior when `quality` is missing.
- Modify `src/minimap/Minimap.vue`
  - Instantiate one scheduler on mount.
  - Replace blank-pan and marquee `renderCurrent()` calls with `scheduleRender(reason)`.
  - Flush pending render on pointer up/cancel and before layout-affecting operations.
  - Pass `resolveRenderQuality(...)` output to `renderScene()`.
- Create `test/minimap-render-scheduler.test.js`
  - Unit coverage for coalescing, flush, cancel.
- Create `test/minimap-render-quality.test.js`
  - Unit coverage for scale and interaction quality decisions.
- Modify `test/minimap-renderer.test.js`
  - Coverage for skipping node text and group child details under degraded quality.
- Modify `test/minimap-shell.test.js`
  - Integration coverage for pan/marquee coalescing and final flush.
- Modify `ROADMAP.md`
  - Add performance optimization slice references.

## Task 1: Render Scheduler Module

**Files:**
- Create: `src/minimap/render-scheduler.js`
- Create: `test/minimap-render-scheduler.test.js`

- [x] **Step 1: Write failing scheduler tests**

Create `test/minimap-render-scheduler.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderScheduler } from '../src/minimap/render-scheduler.js'

function createFrameHarness() {
  const frames = []
  const cancelled = []
  let nextId = 1
  return {
    frames,
    cancelled,
    requestFrame(callback) {
      const frame = { id: nextId++, callback, cancelled: false }
      frames.push(frame)
      return frame.id
    },
    cancelFrame(id) {
      cancelled.push(id)
      const frame = frames.find((item) => item.id === id)
      if (frame) frame.cancelled = true
    },
    runNext(time = 0) {
      const frame = frames.find((item) => !item.cancelled && !item.ran)
      if (!frame) return false
      frame.ran = true
      frame.callback(time)
      return true
    },
  }
}

test('schedule coalesces multiple render requests into one frame', () => {
  const harness = createFrameHarness()
  const reasons = []
  const scheduler = createRenderScheduler({
    render: (reason) => reasons.push(reason),
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
  })

  scheduler.schedule('pan')
  scheduler.schedule('marquee')
  scheduler.schedule('hover')

  assert.equal(harness.frames.length, 1)
  assert.equal(scheduler.isScheduled(), true)
  assert.equal(harness.runNext(16), true)
  assert.deepEqual(reasons, ['pan,marquee,hover'])
  assert.equal(scheduler.isScheduled(), false)
})

test('flush executes a pending render immediately and clears the scheduled frame', () => {
  const harness = createFrameHarness()
  const reasons = []
  const scheduler = createRenderScheduler({
    render: (reason) => reasons.push(reason),
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
  })

  scheduler.schedule('pan')
  scheduler.flush()

  assert.deepEqual(reasons, ['pan'])
  assert.equal(harness.cancelled.includes(1), true)
  assert.equal(harness.runNext(16), false)
})

test('cancel drops a pending render without calling render', () => {
  const harness = createFrameHarness()
  let renders = 0
  const scheduler = createRenderScheduler({
    render: () => {
      renders += 1
    },
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
  })

  scheduler.schedule('hover')
  scheduler.cancel()

  assert.equal(renders, 0)
  assert.equal(harness.cancelled.includes(1), true)
  assert.equal(scheduler.isScheduled(), false)
})
```

- [x] **Step 2: Run scheduler test to verify failure**

Run:

```bash
npm test -- test/minimap-render-scheduler.test.js
```

Expected: fails because `src/minimap/render-scheduler.js` does not exist.

- [x] **Step 3: Implement scheduler**

Create `src/minimap/render-scheduler.js`:

```js
export function createRenderScheduler({
  render,
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
}) {
  let frameId = null
  const reasons = new Set()

  function drain() {
    frameId = null
    const reason = [...reasons].join(',')
    reasons.clear()
    render(reason)
  }

  function schedule(reason = 'render') {
    reasons.add(reason)
    if (frameId !== null) return
    frameId = requestFrame(() => drain())
  }

  function flush() {
    if (frameId === null) return
    const id = frameId
    frameId = null
    cancelFrame?.(id)
    const reason = [...reasons].join(',')
    reasons.clear()
    render(reason)
  }

  function cancel() {
    if (frameId !== null) cancelFrame?.(frameId)
    frameId = null
    reasons.clear()
  }

  function isScheduled() {
    return frameId !== null
  }

  return { schedule, flush, cancel, isScheduled }
}
```

- [x] **Step 4: Verify scheduler test passes**

Run:

```bash
npm test -- test/minimap-render-scheduler.test.js
```

Expected: all scheduler tests pass.

## Task 2: Render Quality Module

**Files:**
- Create: `src/minimap/render-quality.js`
- Create: `test/minimap-render-quality.test.js`

- [x] **Step 1: Write failing quality tests**

Create `test/minimap-render-quality.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRenderQuality } from '../src/minimap/render-quality.js'

test('full quality keeps text and group children at normal scale', () => {
  assert.deepEqual(resolveRenderQuality({ scale: 1, interacting: false }), {
    level: 'full',
    showText: true,
    showGroupChildren: true,
    simplifyEdges: false,
    simplifyChrome: false,
  })
})

test('compact quality hides text during small scale or active interactions', () => {
  assert.deepEqual(resolveRenderQuality({ scale: 0.3, interacting: false }), {
    level: 'compact',
    showText: false,
    showGroupChildren: true,
    simplifyEdges: false,
    simplifyChrome: true,
  })
  assert.equal(resolveRenderQuality({ scale: 1, interacting: true }).level, 'compact')
})

test('overview quality hides text and grouped child details at very small scale', () => {
  assert.deepEqual(resolveRenderQuality({ scale: 0.1, interacting: false }), {
    level: 'overview',
    showText: false,
    showGroupChildren: false,
    simplifyEdges: true,
    simplifyChrome: true,
  })
})
```

- [x] **Step 2: Run quality test to verify failure**

Run:

```bash
npm test -- test/minimap-render-quality.test.js
```

Expected: fails because `src/minimap/render-quality.js` does not exist.

- [x] **Step 3: Implement quality resolver**

Create `src/minimap/render-quality.js`:

```js
export function resolveRenderQuality({ scale = 1, interacting = false } = {}) {
  if (scale < 0.18) {
    return {
      level: 'overview',
      showText: false,
      showGroupChildren: false,
      simplifyEdges: true,
      simplifyChrome: true,
    }
  }

  if (scale < 0.45 || interacting) {
    return {
      level: 'compact',
      showText: false,
      showGroupChildren: true,
      simplifyEdges: false,
      simplifyChrome: true,
    }
  }

  return {
    level: 'full',
    showText: true,
    showGroupChildren: true,
    simplifyEdges: false,
    simplifyChrome: false,
  }
}
```

- [x] **Step 4: Verify quality test passes**

Run:

```bash
npm test -- test/minimap-render-quality.test.js
```

Expected: all quality tests pass.

## Task 3: Renderer Quality Support

**Files:**
- Modify: `src/minimap/renderer.js`
- Modify: `test/minimap-renderer.test.js`

- [x] **Step 1: Add renderer tests for degraded quality**

Append to `test/minimap-renderer.test.js`:

```js
test('compact quality skips default node text drawing', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { viewportWidth: 800, viewportHeight: 600 })
  const ctx = createMockCtx()

  renderScene(ctx, {
    graph,
    layout,
    viewport: { x: 0, y: 0, scale: 0.3 },
    width: 800,
    height: 600,
    quality: { showText: false, showGroupChildren: true },
  })

  assert.equal(ctx.calls.some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'), false)
})

test('overview quality skips grouped child detail drawing', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { viewportWidth: 800, viewportHeight: 600 })
  const ctx = createMockCtx()

  renderScene(ctx, {
    graph,
    layout,
    viewport: { x: 0, y: 0, scale: 0.1 },
    width: 800,
    height: 600,
    quality: { showText: false, showGroupChildren: false },
  })

  assert.equal(ctx.calls.some((call) => call.method === 'fillText' && String(call.args[0]).startsWith('cluster-')), false)
})
```

- [x] **Step 2: Run renderer test to verify failure**

Run:

```bash
npm test -- test/minimap-renderer.test.js
```

Expected: new tests fail because `renderScene` ignores `quality`.

- [x] **Step 3: Add quality plumbing to renderer**

In `src/minimap/renderer.js`:

- In `renderScene`, destructure `quality = {}`.
- Change `drawNode(ctx, node, screen, itemState, theme, viewport.scale)` to pass `quality`.
- Update `drawNode` to skip `fillText` when `quality.showText === false`.
- Wrap `drawGroupChildren(...)` so it only runs when `quality.showGroupChildren !== false`.

Implementation shape:

```js
const effectiveQuality = {
  showText: true,
  showGroupChildren: true,
  simplifyEdges: false,
  simplifyChrome: false,
  ...quality,
}
```

Inside default node drawing:

```js
if (quality.showText !== false) {
  ctx.fillStyle = theme.node.text
  ctx.font = scaledFont(theme.node.font, scale)
  ctx.fillText(node.label, rect.x + 12 * scale, rect.y + rect.height / 2 + 5 * scale)
}
```

Group child detail:

```js
if (effectiveQuality.showGroupChildren !== false) {
  drawGroupChildren(...)
}
```

- [x] **Step 4: Verify renderer test passes**

Run:

```bash
npm test -- test/minimap-renderer.test.js
```

Expected: renderer tests pass.

## Task 4: Vue Integration for Scheduler and Quality

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`

- [x] **Step 1: Add shell tests for pan coalescing and quality**

Append focused tests to `test/minimap-shell.test.js`:

```js
test('blank pan coalesces repeated pointermove renders into one animation frame', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const canvas = wrapper.find('canvas').element
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length
  const framesBefore = frames.scheduled.length

  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 760, clientY: 560, pointerId: 42, bubbles: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 750, clientY: 550, pointerId: 42, bubbles: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 740, clientY: 540, pointerId: 42, bubbles: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 730, clientY: 530, pointerId: 42, bubbles: true }))

  assert.equal(frames.scheduled.length, framesBefore + 1)
  assert.equal(ctx.calls.length, callsBefore)

  assert.equal(runFrameFrom(framesBefore, 1000), true)
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('marquee pointerup flushes the scheduled render immediately', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const canvas = wrapper.find('canvas').element
  const ctx = contexts.at(-1)

  canvas.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: 720, clientY: 540, pointerId: 43, bubbles: true, ctrlKey: true }),
  )
  canvas.dispatchEvent(
    new PointerEvent('pointermove', { clientX: 760, clientY: 580, pointerId: 43, bubbles: true, ctrlKey: true }),
  )
  const callsBeforeUp = ctx.calls.length
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 760, clientY: 580, pointerId: 43, bubbles: true }))

  assert.ok(ctx.calls.length > callsBeforeUp)
  wrapper.destroy()
})
```

- [x] **Step 2: Run shell test to verify failure**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: pan test fails because current implementation renders immediately on every pointermove.

- [x] **Step 3: Wire scheduler and quality in Minimap.vue**

In `src/minimap/Minimap.vue`:

- Import `createRenderScheduler` and `resolveRenderQuality`.
- Add `let renderScheduler = null`.
- Add helpers:

```js
function isHighFrequencyInteractionActive() {
  return !!(
    panState ||
    marqueeState?.active
  )
}

function currentRenderQuality(viewport = currentViewport()) {
  return resolveRenderQuality({
    scale: viewport.scale,
    interacting: isHighFrequencyInteractionActive(),
  })
}

function scheduleRender(reason) {
  if (!renderScheduler) {
    renderCurrent()
    return
  }
  renderScheduler.schedule(reason)
}

function flushScheduledRender() {
  renderScheduler?.flush()
}

function cancelScheduledRender() {
  renderScheduler?.cancel()
}
```

- In `renderCurrent`, pass `quality: currentRenderQuality(renderViewport)` to `renderScene`.
- In `onMounted`, create scheduler after `ctx` is initialized:

```js
renderScheduler = createRenderScheduler({ render: () => renderCurrent() })
```

- Replace first-round high-frequency `renderCurrent()` calls with `scheduleRender(...)` in:
  - pan move;
  - marquee move.
- Keep scrollbar hover/drag and node drag target move on immediate `renderCurrent()` in this slice. They rely on fine-grained preview feedback and remain candidates for a later dynamic-layer/cache slice.
- In `handlePointerUp`, before clearing interaction states that require a final draw, call `flushScheduledRender()`.
- In `cancelPointerInteractions` and `onUnmounted`, call `cancelScheduledRender()`.

- [x] **Step 4: Verify shell test passes**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: shell tests pass.

## Task 5: Roadmap and Full Verification

**Files:**
- Modify: `ROADMAP.md`

- [x] **Step 1: Update roadmap**

Under the fifth-stage or follow-up performance section, add:

```md
- [x] 性能优化切片 1：大图交互合帧与缩放降级渲染（新增 `render-scheduler.js`、`render-quality.js`；平移/框选高频路径合帧；缩小时减少文字和分组子项绘制；拖拽合帧留给后续动态层/缓存切片；[spec](docs/superpowers/specs/2026-06-21-large-graph-performance.md)，[plan](docs/superpowers/plans/2026-06-21-large-graph-performance.md)）
```

- [x] **Step 2: Run focused tests**

Run:

```bash
npm test -- test/minimap-render-scheduler.test.js test/minimap-render-quality.test.js test/minimap-renderer.test.js test/minimap-shell.test.js
```

Expected: all focused tests pass.

- [x] **Step 3: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: all tests pass and build succeeds.

## Self-Review

- Spec coverage: covers A coalescing, B quality degradation, and C/D architecture boundaries for spatial index and cache.
- Scope: this plan implements A and B first; C and cache remain intentionally designed but not implemented in this first plan.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: `createRenderScheduler`, `resolveRenderQuality`, `quality.showText`, and `quality.showGroupChildren` are named consistently across tasks.
