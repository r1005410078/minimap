# Phase 1 布局切换动画 + 视口锚点稳定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 minimap 在布局方向切换和 graph 变化后平滑过渡，并用选中节点或 root 做视口锚点补偿，避免画布突然跳走。

**Architecture:** 新增纯 JS `layout-transition.js` 负责旧/新 layout 与 viewport 的插值，保持 renderer 不知道动画存在。`Minimap.vue` 负责计算新 layout、选择锚点、创建 transition、调度/取消 `requestAnimationFrame`，并把过渡 layout 和 viewport 交给现有 `renderScene`。

**Tech Stack:** Vue 2.7 + Vite + Canvas 2D；纯 JS ESM；Node 内置 `node --test`；现有 jsdom + mock Canvas ctx 测试环境。

---

## Source Spec

- Spec: `docs/superpowers/specs/2026-06-19-phase-1-layout-transition.md`
- Existing Vue shell contract: `docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md`
- Existing layout helpers: `src/minimap/layout.js`

## File Structure

- Create `src/minimap/layout-transition.js`: pure functions for transition creation, eased progress, item rect interpolation, bounds calculation, viewport interpolation, and anchor center resolution.
- Create `test/minimap-layout-transition.test.js`: pure function tests for nodes, groups, new items, visible order, bounds, viewport interpolation, and anchor center resolution.
- Modify `src/minimap/Minimap.vue`: replace direct synchronous `render()` layout recomputation with `updateLayout()`, raf-driven transition rendering, anchor compensation, resize no-animation path, and unmount cleanup.
- Modify `test/helpers/canvas-env.js`: add a small `stubAnimationFrame()` helper for deterministic component tests.
- Modify `test/minimap-shell.test.js`: update existing direction-change assertion and add tests for raf cancellation, resize no-animation, unmount cleanup, and anchor viewport compensation.
- Modify `ROADMAP.md`: mark the layout transition slice as implementation in progress, then complete after final verification.

## Global Constraints

- Do not add dependencies.
- Do not change Canvas renderer drawing contracts.
- Do not expose public viewport or animation props in this slice.
- Do not animate resize.
- Preserve existing click selection and resource drop behavior.
- Each task must run targeted tests, then `npm test` and `npm run build` before committing.

## Progress

- [ ] Task 1: Pure layout transition module + tests
- [ ] Task 2: Vue shell animation + anchor integration
- [ ] Task 3: Docs progress sync + full verification

---

### Task 1: Pure Layout Transition Module

**Files:**
- Create: `src/minimap/layout-transition.js`
- Create: `test/minimap-layout-transition.test.js`

**Interfaces:**
- `easeOutCubic(value) -> number`
- `createLayoutTransition({ fromLayout, toLayout, fromViewport, toViewport, durationMs }) -> transition`
- `layoutAt(transition, progress) -> { layout, viewport }`
- `resolveAnchorCenter(layout, id) -> { x, y } | null`

- [ ] **Step 1: Write the failing pure function tests**

Create `test/minimap-layout-transition.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createLayoutTransition,
  easeOutCubic,
  layoutAt,
  resolveAnchorCenter,
} from '../src/minimap/layout-transition.js'

function layoutOf({ nodes = [], groups = [], visibleItems = nodes.map(([id, rect]) => ({ type: 'node', id, ...rect })) }) {
  return {
    nodes: new Map(nodes),
    groups,
    visibleItems,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  }
}

test('layoutAt interpolates matching node rectangles with eased progress', () => {
  const transition = createLayoutTransition({
    fromLayout: layoutOf({ nodes: [['a', { x: 0, y: 10, width: 100, height: 40 }]] }),
    toLayout: layoutOf({ nodes: [['a', { x: 100, y: 50, width: 120, height: 60 }]] }),
    fromViewport: { x: 0, y: 0, scale: 1 },
    toViewport: { x: 0, y: 0, scale: 1 },
    durationMs: 200,
  })

  const { layout } = layoutAt(transition, 0.5)
  const eased = easeOutCubic(0.5)

  assert.deepEqual(layout.nodes.get('a'), {
    x: 0 + (100 - 0) * eased,
    y: 10 + (50 - 10) * eased,
    width: 100 + (120 - 100) * eased,
    height: 40 + (60 - 40) * eased,
  })
})

test('layoutAt interpolates matching group rectangles by parentId', () => {
  const fromGroup = { parentId: 'heap', children: ['a'], x: 0, y: 0, width: 200, height: 100 }
  const toGroup = { parentId: 'heap', children: ['a'], x: 80, y: 40, width: 260, height: 140 }
  const transition = createLayoutTransition({
    fromLayout: layoutOf({
      groups: [fromGroup],
      visibleItems: [{ type: 'group', parentId: 'heap', x: 0, y: 0, width: 200, height: 100 }],
    }),
    toLayout: layoutOf({
      groups: [toGroup],
      visibleItems: [{ type: 'group', parentId: 'heap', x: 80, y: 40, width: 260, height: 140 }],
    }),
    fromViewport: { x: 0, y: 0, scale: 1 },
    toViewport: { x: 0, y: 0, scale: 1 },
    durationMs: 200,
  })

  const { layout } = layoutAt(transition, 0.5)
  const group = layout.groups[0]

  assert.equal(group.parentId, 'heap')
  assert.ok(group.x > fromGroup.x && group.x < toGroup.x)
  assert.ok(group.width > fromGroup.width && group.width < toGroup.width)
  assert.deepEqual(layout.visibleItems[0], {
    type: 'group',
    parentId: 'heap',
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
  })
})

test('layoutAt uses target rectangles for newly visible items', () => {
  const transition = createLayoutTransition({
    fromLayout: layoutOf({ nodes: [['a', { x: 0, y: 0, width: 100, height: 40 }]] }),
    toLayout: layoutOf({
      nodes: [
        ['a', { x: 100, y: 0, width: 100, height: 40 }],
        ['b', { x: 240, y: 80, width: 100, height: 40 }],
      ],
    }),
    fromViewport: { x: 0, y: 0, scale: 1 },
    toViewport: { x: 0, y: 0, scale: 1 },
    durationMs: 200,
  })

  const { layout } = layoutAt(transition, 0.25)

  assert.deepEqual(layout.nodes.get('b'), { x: 240, y: 80, width: 100, height: 40 })
  assert.deepEqual(layout.visibleItems.map((item) => item.id), ['a', 'b'])
})

test('layoutAt calculates bounds from transition visible items', () => {
  const transition = createLayoutTransition({
    fromLayout: layoutOf({ nodes: [['a', { x: 0, y: 0, width: 100, height: 40 }]] }),
    toLayout: layoutOf({
      nodes: [
        ['a', { x: 100, y: 80, width: 100, height: 40 }],
        ['b', { x: 300, y: -20, width: 50, height: 30 }],
      ],
    }),
    fromViewport: { x: 0, y: 0, scale: 1 },
    toViewport: { x: 0, y: 0, scale: 1 },
    durationMs: 200,
  })

  const { layout } = layoutAt(transition, 1)

  assert.deepEqual(layout.bounds, { minX: 100, minY: -20, maxX: 350, maxY: 120 })
})

test('layoutAt interpolates viewport x and y while preserving scale', () => {
  const transition = createLayoutTransition({
    fromLayout: layoutOf({ nodes: [['a', { x: 0, y: 0, width: 100, height: 40 }]] }),
    toLayout: layoutOf({ nodes: [['a', { x: 100, y: 80, width: 100, height: 40 }]] }),
    fromViewport: { x: 10, y: 20, scale: 2 },
    toViewport: { x: -90, y: -60, scale: 2 },
    durationMs: 200,
  })

  const { viewport } = layoutAt(transition, 0.5)
  const eased = easeOutCubic(0.5)

  assert.deepEqual(viewport, {
    x: 10 + (-90 - 10) * eased,
    y: 20 + (-60 - 20) * eased,
    scale: 2,
  })
})

test('resolveAnchorCenter returns the visible node center or null', () => {
  const layout = layoutOf({ nodes: [['a', { x: 10, y: 20, width: 100, height: 40 }]] })

  assert.deepEqual(resolveAnchorCenter(layout, 'a'), { x: 60, y: 40 })
  assert.equal(resolveAnchorCenter(layout, 'missing'), null)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test -- test/minimap-layout-transition.test.js
```

Expected: FAIL with a module-not-found error for `../src/minimap/layout-transition.js`.

- [ ] **Step 3: Implement the pure transition module**

Create `src/minimap/layout-transition.js`:

```js
// Phase 1 布局切换动画：纯 layout / viewport 插值逻辑。
// 不依赖 Vue、Canvas 或 DOM。见 docs/superpowers/specs/2026-06-19-phase-1-layout-transition.md

const DEFAULT_DURATION_MS = 200

function clamp01(value) {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function easeOutCubic(value) {
  const t = clamp01(value)
  return 1 - Math.pow(1 - t, 3)
}

function itemKey(item) {
  return item.type === 'group' ? `group:${item.parentId}` : `node:${item.id}`
}

function rectOf(item) {
  return {
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  }
}

function interpolateNumber(from, to, progress) {
  return from + (to - from) * progress
}

function interpolateRect(from, to, progress) {
  return {
    x: interpolateNumber(from.x, to.x, progress),
    y: interpolateNumber(from.y, to.y, progress),
    width: interpolateNumber(from.width, to.width, progress),
    height: interpolateNumber(from.height, to.height, progress),
  }
}

function indexVisibleItems(layout) {
  const byKey = new Map()
  for (const item of layout.visibleItems || []) byKey.set(itemKey(item), rectOf(item))
  return byKey
}

function transitionRect(fromItems, targetItem, progress) {
  const target = rectOf(targetItem)
  const from = fromItems.get(itemKey(targetItem))
  return from ? interpolateRect(from, target, progress) : target
}

function calculateBounds(visibleItems, fallback) {
  if (!visibleItems.length) return fallback
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of visibleItems) {
    minX = Math.min(minX, item.x)
    minY = Math.min(minY, item.y)
    maxX = Math.max(maxX, item.x + item.width)
    maxY = Math.max(maxY, item.y + item.height)
  }
  return { minX, minY, maxX, maxY }
}

function interpolateViewport(from, to, progress) {
  return {
    x: interpolateNumber(from.x, to.x, progress),
    y: interpolateNumber(from.y, to.y, progress),
    scale: from.scale,
  }
}

export function createLayoutTransition({
  fromLayout,
  toLayout,
  fromViewport,
  toViewport,
  durationMs = DEFAULT_DURATION_MS,
}) {
  return {
    fromItems: indexVisibleItems(fromLayout),
    toLayout,
    fromViewport: { ...fromViewport },
    toViewport: { ...toViewport },
    durationMs,
  }
}

export function layoutAt(transition, progress) {
  const eased = easeOutCubic(progress)
  const visibleItems = transition.toLayout.visibleItems.map((item) => ({
    ...item,
    ...transitionRect(transition.fromItems, item, eased),
  }))

  const rectByKey = new Map(visibleItems.map((item) => [itemKey(item), rectOf(item)]))
  const nodes = new Map()
  for (const [id, rect] of transition.toLayout.nodes.entries()) {
    nodes.set(id, rectByKey.get(`node:${id}`) || { ...rect })
  }

  const groups = transition.toLayout.groups.map((group) => ({
    ...group,
    ...(rectByKey.get(`group:${group.parentId}`) || rectOf(group)),
  }))

  return {
    layout: {
      nodes,
      groups,
      visibleItems,
      bounds: calculateBounds(visibleItems, transition.toLayout.bounds),
    },
    viewport: interpolateViewport(transition.fromViewport, transition.toViewport, eased),
  }
}

export function resolveAnchorCenter(layout, id) {
  if (!id) return null
  const rect = layout.nodes.get(id)
  if (!rect) return null
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }
}
```

- [ ] **Step 4: Run the pure transition tests**

Run:

```bash
npm test -- test/minimap-layout-transition.test.js
```

Expected: PASS. All tests in `test/minimap-layout-transition.test.js` pass.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/minimap/layout-transition.js test/minimap-layout-transition.test.js
git commit -m "feat: add layout transition interpolation"
```

---

### Task 2: Vue Shell Animation and Anchor Integration

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/helpers/canvas-env.js`
- Modify: `test/minimap-shell.test.js`

**Interfaces:**
- Internal `updateLayout({ animate = true, preserveAnchor = true } = {})`
- Internal `renderCurrent(currentLayout = layout, currentViewport = viewport)`
- Internal `cancelAnimation()`

- [ ] **Step 1: Add deterministic raf test helper**

Modify `test/helpers/canvas-env.js` by appending:

```js
export function stubAnimationFrame() {
  const scheduled = []
  const cancelled = []
  let nextId = 1

  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId++
    scheduled.push({ id, callback, cancelled: false })
    return id
  }
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id)
    const frame = scheduled.find((item) => item.id === id)
    if (frame) frame.cancelled = true
  }

  return {
    scheduled,
    cancelled,
    runNext(time = 0) {
      const frame = scheduled.find((item) => !item.cancelled && !item.ran)
      if (!frame) return false
      frame.ran = true
      frame.callback(time)
      return true
    },
  }
}
```

- [ ] **Step 2: Write failing component animation tests**

Modify `test/minimap-shell.test.js` to import the new helper and add tests below the existing resize test:

```js
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
```

After `const observers = stubResizeObserver()` add:

```js
const frames = stubAnimationFrame()
```

Replace the existing `changing layoutDirection triggers a re-render` test with:

```js
test('changing layoutDirection animates through requestAnimationFrame', async () => {
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()

  assert.ok(frames.scheduled.length > 0)
  assert.equal(frames.runNext(1000), true)
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})
```

Append these tests:

```js
test('resize re-renders without starting a layout animation', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const scheduledBefore = frames.scheduled.length
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length

  observers.at(-1).trigger()

  assert.equal(frames.scheduled.length, scheduledBefore)
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('new layout changes cancel the previous animation frame', async () => {
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  const firstFrame = frames.scheduled.at(-1).id

  await wrapper.setProps({ layoutDirection: 'horizontal' })
  await wrapper.vm.$nextTick()

  assert.ok(frames.cancelled.includes(firstFrame))
  wrapper.destroy()
})

test('unmounting cancels an active layout animation frame', async () => {
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  const frame = frames.scheduled.at(-1).id

  wrapper.destroy()

  assert.ok(frames.cancelled.includes(frame))
})

test('selected anchor contributes a compensated viewport during layout animation', async () => {
  const wrapper = mount(Minimap, {
    propsData: {
      graph: createDemoGraph(),
      layoutDirection: 'horizontal',
      selectedIds: ['heap-1'],
    },
  })
  const ctx = contexts.at(-1)

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  frames.runNext(1000)

  const gridFill = ctx.calls
    .filter((call) => call.method === 'fillRect')
    .find((call) => call.args[0] === 0 && call.args[1] === 0 && call.args[2] === 800 && call.args[3] === 600)
  const verticalGridLine = ctx.calls.find((call) => call.method === 'moveTo' && call.args[0] !== 0)

  assert.ok(gridFill)
  assert.ok(verticalGridLine)
  assert.notEqual(verticalGridLine.args[0], 0)
  wrapper.destroy()
})
```

- [ ] **Step 3: Run component tests to verify they fail**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: FAIL because `Minimap.vue` still renders synchronously, does not schedule raf, and does not cancel animation frames.

- [ ] **Step 4: Implement animation plumbing in `Minimap.vue`**

Modify imports at the top of `src/minimap/Minimap.vue`:

```js
import { computeLayout, keepAnchorStable } from './layout.js'
import {
  createLayoutTransition,
  layoutAt,
  resolveAnchorCenter,
} from './layout-transition.js'
```

Replace the viewport declaration and add animation state:

```js
const ANIMATION_DURATION_MS = 200

let viewport = { x: 0, y: 0, scale: 1 }
let settledLayout = null
let animationFrameId = null
let activeTransition = null
let lastRenderedLayout = null
let lastRenderedViewport = viewport
```

Replace the existing `render()` function with these helpers:

```js
function renderCurrent(currentLayout = layout, currentViewport = viewport) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...currentViewport }
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: currentViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: { selectedIds: new Set(currentSelectedIds()) },
  })
}

function cancelAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  activeTransition = null
}

function chooseAnchorId(startLayout, nextLayout) {
  const selected = currentSelectedIds()[0]
  if (selected && resolveAnchorCenter(startLayout, selected) && resolveAnchorCenter(nextLayout, selected)) return selected
  const root = props.graph.rootIds[0]
  if (root && resolveAnchorCenter(startLayout, root) && resolveAnchorCenter(nextLayout, root)) return root
  return null
}

function targetViewportFor(startLayout, nextLayout, preserveAnchor) {
  if (!preserveAnchor || !startLayout) return viewport
  const anchorId = chooseAnchorId(startLayout, nextLayout)
  if (!anchorId) return viewport
  const before = resolveAnchorCenter(startLayout, anchorId)
  const after = resolveAnchorCenter(nextLayout, anchorId)
  return keepAnchorStable(viewport, before, after)
}

function finishLayout(nextLayout, nextViewport) {
  layout = nextLayout
  settledLayout = nextLayout
  viewport = { ...nextViewport }
  renderCurrent(layout, viewport)
}

function startAnimation(startLayout, nextLayout, startViewport, nextViewport) {
  const transition = createLayoutTransition({
    fromLayout: startLayout,
    toLayout: nextLayout,
    fromViewport: startViewport,
    toViewport: nextViewport,
    durationMs: ANIMATION_DURATION_MS,
  })
  activeTransition = { transition, startedAt: null, nextLayout, nextViewport }

  const tick = (time) => {
    if (!activeTransition) return
    if (activeTransition.startedAt === null) activeTransition.startedAt = time
    const elapsed = time - activeTransition.startedAt
    const progress = elapsed / activeTransition.transition.durationMs
    const frame = layoutAt(activeTransition.transition, progress)
    layout = frame.layout
    viewport = { ...frame.viewport }
    renderCurrent(layout, viewport)

    if (progress >= 1) {
      animationFrameId = null
      const finished = activeTransition
      activeTransition = null
      finishLayout(finished.nextLayout, finished.nextViewport)
      return
    }

    animationFrameId = requestAnimationFrame(tick)
  }

  animationFrameId = requestAnimationFrame(tick)
}

function updateLayout({ animate = true, preserveAnchor = true } = {}) {
  if (!ctx) return
  const nextLayout = computeLayout(props.graph, {
    direction: props.layoutDirection,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
  })

  const startLayout = lastRenderedLayout || settledLayout || layout
  const startViewport = lastRenderedViewport || viewport
  const nextViewport = targetViewportFor(startLayout, nextLayout, preserveAnchor)

  cancelAnimation()

  if (!startLayout || !animate || ANIMATION_DURATION_MS <= 0) {
    finishLayout(nextLayout, nextViewport)
    return
  }

  viewport = { ...startViewport }
  startAnimation(startLayout, nextLayout, startViewport, nextViewport)
}
```

Update `setSelected()` to render the current layout without recomputing:

```js
function setSelected(ids) {
  if (props.selectedIds === null) internalSelectedId = ids[0] ?? null
  emit('select', ids)
  renderCurrent()
}
```

Update `handleDrop()` to call `updateLayout()` instead of `render()`:

```js
  updateLayout()
  emit('node-drop', { resource, parentId, index })
  emit('change', props.graph)
```

Update `onMounted()` and resize handling:

```js
onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  syncCanvasSize()
  resizeObserver = new ResizeObserver(() => {
    syncCanvasSize()
    updateLayout({ animate: false, preserveAnchor: false })
  })
  resizeObserver.observe(containerRef.value)
  canvasRef.value.addEventListener('pointerdown', handlePointerDown)
  canvasRef.value.addEventListener('dragover', handleDragOver)
  canvasRef.value.addEventListener('drop', handleDrop)
  updateLayout({ animate: false, preserveAnchor: false })
})
```

Update `onUnmounted()` and watchers:

```js
onUnmounted(() => {
  cancelAnimation()
  if (resizeObserver) resizeObserver.disconnect()
})

watch(() => props.layoutDirection, () => updateLayout())
watch(() => props.selectedIds, () => renderCurrent())
```

- [ ] **Step 5: Run component tests**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: PASS. The shell tests confirm raf scheduling, cancellation, no resize animation, and anchor-influenced viewport rendering.

- [ ] **Step 6: Run interaction/drop/select regression tests**

Run:

```bash
npm test -- test/minimap-select.test.js test/minimap-drop.test.js test/minimap-interaction.test.js
```

Expected: PASS. Selection and resource drop behavior still works.

- [ ] **Step 7: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/minimap/Minimap.vue test/helpers/canvas-env.js test/minimap-shell.test.js
git commit -m "feat: animate minimap layout changes"
```

---

### Task 3: Docs Progress Sync and Final Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-06-19-phase-1-layout-transition.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Update plan progress**

In `docs/superpowers/plans/2026-06-19-phase-1-layout-transition.md`, update:

```md
## Progress

- [x] Task 1: Pure layout transition module + tests
- [x] Task 2: Vue shell animation + anchor integration
- [ ] Task 3: Docs progress sync + full verification
```

- [ ] **Step 2: Find the implementation commit range**

Run:

```bash
git log --oneline --reverse be05cc3..HEAD
```

Expected: output includes the Task 1 and Task 2 commits. Use the first hash from this output as the range start and the last hash as the range end when editing the docs in the next steps. The range format is two concrete short hashes separated by `..`.

- [ ] **Step 3: Update ROADMAP current progress**

Modify the `ROADMAP.md` current progress block. In the layout-transition bullet, replace the words after `commit` with the two concrete short hashes from Step 2, separated by `..`:

```md
- **已完成切片**：
  - 逻辑层 `graph` / `layout` / `coords` + 测试（commit `893b6b7`）
  - Canvas 渲染器 `renderer` / `theme` + 测试（commit `1caccd8`，`npm test` 22 全过）
  - Vue 组件壳 `Minimap.vue` / `ResourceTree.vue` / `interaction.js` + 资源树拖入 + 测试（commit `0c50895`..`e4c451b`，`npm test` 49 全过，浏览器手动验收通过）
  - 正交连线 `orthogonalPath` / `resolveEdges` endpoint boxes / 折线 + 箭头绘制 + 测试（commit `7902000`..`0d4b711`，`npm test` 与 `npm run build` 通过）
  - 布局切换动画 + 视口锚点稳定 `layout-transition` / `Minimap.vue` raf 动画 + 测试（commit 两个真实短 hash，中间用两个点连接，`npm test` 与 `npm run build` 通过）
- **下一步**：第一阶段验收回归；验收点全绿后勾「第一阶段」，再进入第二阶段「分组框能力」
- **待办切片**：第一阶段验收回归
```

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 5: Update plan completion note**

In this plan file, change progress to:

```md
## Progress

- [x] Task 1: Pure layout transition module + tests
- [x] Task 2: Vue shell animation + anchor integration
- [x] Task 3: Docs progress sync + full verification

切片完成：commit 两个真实短 hash，中间用两个点连接，`npm test` 全过、`npm run build` 通过。
```

- [ ] **Step 6: Commit docs**

```bash
git add docs/superpowers/plans/2026-06-19-phase-1-layout-transition.md ROADMAP.md
git commit -m "docs: mark layout transition slice complete"
```

- [ ] **Step 7: Final status check**

Run:

```bash
git status --short
```

Expected: no modified tracked files. Untracked local config such as `.claude/` may remain if it existed before this slice.
