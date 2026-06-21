# Controller 抽取切片 1：根 Controller + Core-Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `Minimap.vue` 里 canvas 挂载/resize、layout 状态、分组展开/滚动受控态、布局切换动画、viewport + tween、渲染调度/降级这些编排逻辑迁到两个新的框架无关模块（`core-controller.js` + 根 `minimap-controller.js`），`Minimap.vue` 对外行为完全不变。

**Architecture:** `core-controller.js` 是一个工厂函数 `createCoreController(deps)`，`deps` 全部是只读 getter（转发 Vue props/computed）或跨 controller 契约（本切片由 `Minimap.vue` 本地闭包临时实现）。`minimap-controller.js` 是根工厂 `createMinimapController(deps)`，内部创建 core，在 `mount(canvas, container)` 时挂载全部 canvas DOM 监听（回调指向注入的占位函数），并把 core 的相机/布局/渲染方法转发出去。详见 [docs/superpowers/specs/2026-06-21-controller-extraction-design.md](../specs/2026-06-21-controller-extraction-design.md)。

**Tech Stack:** Vue 2.7 `<script setup>`，Canvas 2D，Node 内置 `node --test`，现有 `test/helpers/dom-env.js` + `test/helpers/canvas-env.js` jsdom 打桩。

## Global Constraints

- 不引入新的运行时第三方依赖。
- `Minimap.vue` 对外 props/emits/`defineExpose` 方法名和参数形状必须保持不变。
- `core-controller.js`/`minimap-controller.js` 不直接持有 Vue ref 或 Vue 组件实例，只通过 deps 里的回调跟外部交互。
- 每个任务完成后跑一次相关测试；最后一个任务跑全量 `npm test` + `npm run build`。

---

## File Structure

- Create `src/minimap/core-controller.js` —— canvas 挂载/resize、layout 状态、分组受控态、viewport + tween、布局切换动画、渲染调度/降级、`renderCurrent`。
- Create `src/minimap/minimap-controller.js` —— 根：组装 core，挂载/卸载 canvas DOM 监听，转发方法。
- Create `test/minimap-core-controller.test.js` —— core-controller 的纯 jsdom 测试（不用 Vue Test Utils）。
- Create `test/minimap-root-controller.test.js` —— minimap-controller 的 DOM 挂载/转发测试。
- Modify `src/minimap/Minimap.vue` —— 改用 controller，删除已迁出的本地实现。
- Modify `ROADMAP.md` —— 勾选 Controller 抽取切片 1。

---

## Task 1: core-controller 同步基础（挂载/resize、layout 状态、分组受控态、viewport 状态、渲染调度）

**Files:**
- Create: `src/minimap/core-controller.js`
- Create: `test/minimap-core-controller.test.js`

**Interfaces:**
- Produces：
  ```js
  createCoreController(deps) -> {
    mount(canvas, container), destroy(),
    getCssSize(), screenPointFromClient(clientX, clientY), pointFromClient(clientX, clientY),
    getLayout(), updateLayout({ animate, preserveAnchor } = {}),
    scrollGroup(group, rawScrollTop), setGroupExpanded(groupId, expanded),
    resolveTargetRect(id), resolveCenterTarget(id),
    getViewport(), applyViewport(next, { emitChange, render } = {}), zoomAt(screenPoint, deltaY), panBy(delta),
    renderCurrent(), scheduleRender(reason), flushScheduledRender(), cancelScheduledRender(),
  }
  ```
  本任务里 `updateLayout`/`applyViewport` 还没有动画/补动（下一任务加），`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`cancelViewportTween` 还不存在（下一任务加）。
- `deps` 形状（本任务用到的字段）：`getGraph`、`getLayoutDirection`、`getOptions`、`getTheme`、`getRenderers`、`getViewportProp`、`getGroupStatesProp`、`getSelectedIds`、`getInteractionRenderState`、`emitViewportChange`、`emitGroupStateChange`、`onRenderStats`、`onOverviewRender`。

- [ ] **Step 1: 写失败测试**

Create `test/minimap-core-controller.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { createCoreController } from '../src/minimap/core-controller.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
const observers = stubResizeObserver()
stubAnimationFrame()

function createElements() {
  const canvas = document.createElement('canvas')
  const container = document.createElement('div')
  container.appendChild(canvas)
  return { canvas, container }
}

function createDeps(overrides = {}) {
  return {
    getGraph: () => createDemoGraph(),
    getLayoutDirection: () => 'horizontal',
    getOptions: () => ({}),
    getTheme: () => ({}),
    getRenderers: () => ({}),
    getViewportProp: () => null,
    getGroupStatesProp: () => null,
    getSelectedIds: () => [],
    getInteractionRenderState: () => ({
      dragging: false,
      interacting: false,
      groupDrag: null,
      selectionRect: null,
      groupScrollbarHoverId: null,
      attachPreview: null,
    }),
    emitViewportChange: () => {},
    emitGroupStateChange: () => {},
    onRenderStats: () => {},
    onOverviewRender: () => {},
    ...overrides,
  }
}

function mountController(deps = createDeps()) {
  const { canvas, container } = createElements()
  const controller = createCoreController(deps)
  controller.mount(canvas, container)
  return { controller, canvas, container, ctx: contexts.at(-1) }
}

test('mount sizes the canvas to the container with DPR scaling and renders the initial layout', () => {
  globalThis.devicePixelRatio = 2
  const { controller, canvas, ctx } = mountController()

  assert.equal(canvas.width, 1600)
  assert.equal(canvas.height, 1200)
  assert.equal(canvas.style.width, '800px')
  assert.equal(canvas.style.height, '600px')
  assert.deepEqual(controller.getCssSize(), { width: 800, height: 600 })
  assert.ok(controller.getLayout())
  assert.ok(ctx.calls.some((call) => call.method === 'clearRect'))

  controller.destroy()
  delete globalThis.devicePixelRatio
})

test('resize observer callback re-syncs canvas size and relayouts', () => {
  const { controller, container } = mountController()
  const layoutBefore = controller.getLayout()

  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
  observers.at(-1).trigger()

  assert.deepEqual(controller.getCssSize(), { width: 400, height: 300 })
  assert.notEqual(controller.getLayout(), layoutBefore)
  controller.destroy()
})

test('destroy disconnects the resize observer', () => {
  const { controller } = mountController()
  const observer = observers.at(-1)
  controller.destroy()
  assert.equal(observer.disconnected, true)
})

test('screenPointFromClient converts client coordinates using the canvas bounding rect', () => {
  const { controller, canvas } = mountController()
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 })
  assert.deepEqual(controller.screenPointFromClient(50, 70), { x: 40, y: 50 })
  controller.destroy()
})

test('pointFromClient converts client coordinates to world coordinates through the current viewport', () => {
  const { controller, canvas } = mountController()
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 })
  controller.applyViewport({ x: 10, y: 20, scale: 2 }, { render: false })
  assert.deepEqual(controller.pointFromClient(30, 40), { x: 10, y: 10 })
  controller.destroy()
})

test('updateLayout recomputes layout from getGraph/getLayoutDirection and renders', () => {
  const { controller, ctx } = mountController()
  const callsBefore = ctx.calls.length
  controller.updateLayout()
  assert.ok(controller.getLayout())
  assert.ok(ctx.calls.length > callsBefore)
  controller.destroy()
})

test('getViewport defaults to DEFAULT_VIEWPORT and reflects controlled viewport prop', () => {
  const { controller } = mountController()
  assert.deepEqual(controller.getViewport(), { x: 0, y: 0, scale: 1 })
  controller.destroy()

  let viewportProp = { x: 5, y: 6, scale: 1.5 }
  const controlled = createCoreController(createDeps({ getViewportProp: () => viewportProp }))
  const { canvas, container } = createElements()
  controlled.mount(canvas, container)
  assert.deepEqual(controlled.getViewport(), { x: 5, y: 6, scale: 1.5 })
  controlled.destroy()
})

test('applyViewport updates uncontrolled viewport, emits change, and re-renders by default', () => {
  const changes = []
  const deps = createDeps({ emitViewportChange: (next) => changes.push(next) })
  const ctrl = createCoreController(deps)
  const { canvas, container } = createElements()
  ctrl.mount(canvas, container)
  const freshCtx = contexts.at(-1)
  const callsBefore = freshCtx.calls.length

  const applied = ctrl.applyViewport({ x: 1, y: 2, scale: 1 })

  assert.equal(applied, true)
  assert.deepEqual(ctrl.getViewport(), { x: 1, y: 2, scale: 1 })
  assert.deepEqual(changes, [{ x: 1, y: 2, scale: 1 }])
  assert.ok(freshCtx.calls.length > callsBefore)
  ctrl.destroy()
})

test('applyViewport in controlled mode emits but does not mutate internal viewport', () => {
  const changes = []
  const viewportProp = { x: 0, y: 0, scale: 1 }
  const deps = createDeps({ getViewportProp: () => viewportProp, emitViewportChange: (next) => changes.push(next) })
  const ctrl = createCoreController(deps)
  const { canvas, container } = createElements()
  ctrl.mount(canvas, container)

  const applied = ctrl.applyViewport({ x: 9, y: 9, scale: 1 })

  assert.equal(applied, true)
  assert.deepEqual(changes, [{ x: 9, y: 9, scale: 1 }])
  assert.deepEqual(ctrl.getViewport(), { x: 0, y: 0, scale: 1 })
  ctrl.destroy()
})

test('panBy moves the viewport without rendering immediately', () => {
  const { controller, ctx } = mountController()
  const callsBefore = ctx.calls.length
  controller.panBy({ x: 10, y: -5 })
  assert.deepEqual(controller.getViewport(), { x: 10, y: -5, scale: 1 })
  assert.equal(ctx.calls.length, callsBefore)
  controller.destroy()
})

test('zoomAt changes scale around the screen point and renders', () => {
  const { controller, ctx } = mountController()
  const callsBefore = ctx.calls.length
  controller.zoomAt({ x: 400, y: 300 }, -100)
  assert.notEqual(controller.getViewport().scale, 1)
  assert.ok(ctx.calls.length > callsBefore)
  controller.destroy()
})

test('scrollGroup clamps scroll position, mutates the group in uncontrolled mode, and re-renders', () => {
  const { controller } = mountController()
  const group = controller.getLayout().groups.find((g) => g.id === 'heap-1')
  assert.ok(group, 'demo graph heap-1 should collapse into a group')

  controller.scrollGroup(group, -50)
  assert.equal(group.scrollTop, 0)

  controller.scrollGroup(group, 999999)
  assert.equal(group.scrollTop, group.contentHeight - group.height)
  controller.destroy()
})

test('scrollGroup in controlled groupStates mode does not mutate the group directly and relayouts', () => {
  let groupStates = {}
  const emitted = []
  const deps = createDeps({
    getGroupStatesProp: () => groupStates,
    emitGroupStateChange: (next) => {
      groupStates = next
      emitted.push(next)
    },
  })
  const ctrl = createCoreController(deps)
  const { canvas, container } = createElements()
  ctrl.mount(canvas, container)
  const group = ctrl.getLayout().groups.find((g) => g.id === 'heap-1')
  const scrollTopBefore = group.scrollTop

  ctrl.scrollGroup(group, 40)

  assert.equal(group.scrollTop, scrollTopBefore)
  assert.equal(emitted.at(-1)['heap-1'].scrollTop, 40)
  ctrl.destroy()
})

test('setGroupExpanded toggles expanded state and relayouts', () => {
  const { controller } = mountController()
  const before = controller.getLayout().groups.find((g) => g.id === 'heap-1')
  assert.equal(before.expanded, false)

  controller.setGroupExpanded('heap-1', true)

  const after = controller.getLayout().groups.find((g) => g.id === 'heap-1')
  assert.equal(after, undefined)
  controller.destroy()
})

test('resolveTargetRect returns a group box, a node rect, or a rect inside a collapsed group', () => {
  const { controller } = mountController()
  const group = controller.getLayout().groups.find((g) => g.id === 'heap-1')

  const groupRect = controller.resolveTargetRect('heap-1')
  assert.deepEqual(groupRect, { x: group.x, y: group.y, width: group.width, height: group.height })

  const childRect = controller.resolveTargetRect('cluster-1')
  assert.ok(childRect)
  assert.equal(controller.resolveTargetRect('does-not-exist'), null)
  controller.destroy()
})

test('resolveCenterTarget scrolls the owning group to reveal the child and returns its center', () => {
  const { controller } = mountController()
  const center = controller.resolveCenterTarget('cluster-20')
  assert.ok(center)
  const group = controller.getLayout().groups.find((g) => g.id === 'heap-1')
  assert.ok(group.scrollTop > 0)
  controller.destroy()
})

test('renderCurrent forwards stats and overview scene through the injected callbacks', () => {
  const stats = []
  const overviewScenes = []
  const deps = createDeps({
    onRenderStats: (s) => stats.push(s),
    onOverviewRender: (scene) => overviewScenes.push(scene),
  })
  const ctrl = createCoreController(deps)
  const { canvas, container } = createElements()
  ctrl.mount(canvas, container)

  assert.equal(stats.length, 1)
  assert.equal(overviewScenes.length, 1)
  assert.equal(overviewScenes[0].mainWidth, 800)
  ctrl.destroy()
})

test('scheduleRender coalesces repeated calls into a single animation frame', () => {
  const frames = stubAnimationFrame()
  const { controller, ctx } = mountController()
  const callsBefore = ctx.calls.length

  controller.scheduleRender('pan')
  controller.scheduleRender('pan')
  assert.equal(ctx.calls.length, callsBefore)

  assert.equal(frames.runNext(16), true)
  assert.ok(ctx.calls.length > callsBefore)
  controller.destroy()
})

test('flushScheduledRender renders immediately and cancelScheduledRender drops a pending render', () => {
  const { controller, ctx } = mountController()

  controller.scheduleRender('pan')
  const callsBeforeFlush = ctx.calls.length
  controller.flushScheduledRender()
  assert.ok(ctx.calls.length > callsBeforeFlush)

  controller.scheduleRender('pan')
  const callsBeforeCancel = ctx.calls.length
  controller.cancelScheduledRender()
  assert.equal(ctx.calls.length, callsBeforeCancel)
  controller.destroy()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-core-controller.test.js`
Expected: 失败，因为 `src/minimap/core-controller.js` 不存在。

- [ ] **Step 3: 实现 core-controller.js（同步基础部分）**

Create `src/minimap/core-controller.js`:

```js
import { computeLayout, clampGroupScroll, locateChildGroup, childRectInGroup, scrollTopToReveal } from './layout.js'
import {
  DEFAULT_VIEWPORT,
  normalizeViewport,
  sameViewport,
  viewportOptions,
  zoomViewportAt,
  panViewportBy,
} from './viewport.js'
import { screenToWorld } from './coords.js'
import { renderScene, worldRectToScreen } from './renderer.js'
import { buildSelectionRelations } from './selection.js'
import { createRenderScheduler } from './render-scheduler.js'
import { resolveRenderQuality } from './render-quality.js'

export function createCoreController(deps) {
  let canvasEl = null
  let containerEl = null
  let ctx = null
  let resizeObserver = null
  let cssWidth = 0
  let cssHeight = 0

  let layout = null
  let internalGroupStates = {}
  let internalViewport = { ...DEFAULT_VIEWPORT }
  let renderScheduler = null

  function currentOptions() {
    return deps.getOptions() ?? {}
  }

  function isGroupStatesControlled() {
    return deps.getGroupStatesProp() != null
  }

  function currentGroupStates() {
    return deps.getGroupStatesProp() ?? internalGroupStates
  }

  function isViewportControlled() {
    return deps.getViewportProp() != null
  }

  function getViewport() {
    return normalizeViewport(deps.getViewportProp() ?? internalViewport, viewportOptions(currentOptions()))
  }

  function applyViewport(nextViewport, { emitChange = true, render = true } = {}) {
    const next = normalizeViewport(nextViewport, viewportOptions(currentOptions()))
    const previous = getViewport()
    if (sameViewport(previous, next)) return false
    if (emitChange) deps.emitViewportChange(next)
    if (isViewportControlled()) return true
    internalViewport = next
    if (render) renderCurrent(layout, next)
    return true
  }

  function updateGroupState(groupId, patch) {
    const current = currentGroupStates()
    const next = { ...current, [groupId]: { ...current[groupId], ...patch } }
    if (!isGroupStatesControlled()) internalGroupStates = next
    deps.emitGroupStateChange(next)
  }

  function scrollGroup(group, rawScrollTop) {
    const nextScrollTop = clampGroupScroll(group, rawScrollTop)
    if (!isGroupStatesControlled()) group.scrollTop = nextScrollTop
    updateGroupState(group.id, { scrollTop: nextScrollTop })
    if (isGroupStatesControlled()) updateLayout({ animate: false, preserveAnchor: false })
    else renderCurrent()
  }

  function setGroupExpanded(groupId, expanded) {
    updateGroupState(groupId, { expanded })
    updateLayout()
  }

  function resolveTargetRect(id) {
    if (!layout) return null
    const group = layout.groups.find((g) => g.id === id)
    if (group) return { x: group.x, y: group.y, width: group.width, height: group.height }
    const nodeRect = layout.nodes.get(id)
    if (nodeRect) return nodeRect
    const located = locateChildGroup(layout, id)
    if (!located) return null
    return childRectInGroup(located.group, id)
  }

  function rectCenter(rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }

  function resolveCenterTarget(id) {
    if (!layout) return null
    const located = locateChildGroup(layout, id)
    if (located) {
      const scrollTop = scrollTopToReveal(located.group, located.index)
      if (!isGroupStatesControlled()) located.group.scrollTop = scrollTop
      updateGroupState(located.group.id, { scrollTop })
      if (isGroupStatesControlled()) updateLayout({ animate: false, preserveAnchor: false })
    }
    const rect = resolveTargetRect(id)
    return rect ? rectCenter(rect) : null
  }

  function updateLayout({ animate = true, preserveAnchor = true } = {}) {
    if (!ctx) return
    const nextLayout = computeLayout(deps.getGraph(), {
      direction: deps.getLayoutDirection(),
      viewportWidth: cssWidth,
      viewportHeight: cssHeight,
      groupThreshold: currentOptions().groupThreshold,
      groupStates: new Map(Object.entries(currentGroupStates())),
    })
    layout = nextLayout
    renderCurrent(layout, getViewport())
  }

  function renderCurrent(currentLayout = layout, renderViewport = getViewport()) {
    if (!ctx || !currentLayout) return
    const interaction = deps.getInteractionRenderState()
    const relations = interaction.dragging
      ? buildSelectionRelations(deps.getGraph(), currentLayout, [])
      : buildSelectionRelations(deps.getGraph(), currentLayout, deps.getSelectedIds())
    const attachPreview = interaction.attachPreview
      ? {
          rect: worldRectToScreen(interaction.attachPreview.rect, renderViewport),
          parentRect: interaction.attachPreview.parentRect
            ? worldRectToScreen(interaction.attachPreview.parentRect, renderViewport)
            : null,
        }
      : null
    const stats = renderScene(ctx, {
      layout: currentLayout,
      graph: deps.getGraph(),
      layoutDirection: deps.getLayoutDirection(),
      viewport: renderViewport,
      width: cssWidth,
      height: cssHeight,
      theme: deps.getTheme(),
      state: {
        selectedIds: relations.selectedIds,
        highlightedIds: relations.highlightedIds,
        dimmedIds: relations.dimmedIds,
        highlightedEdgeIds: relations.highlightedEdgeIds,
        dimmedEdgeIds: relations.dimmedEdgeIds,
        groupDrag: interaction.groupDrag ?? null,
        groupScrollbarHoverId: interaction.groupScrollbarHoverId ?? null,
        selectionRect: interaction.selectionRect ?? null,
        attachPreview,
      },
      quality: resolveRenderQuality({
        scale: renderViewport.scale,
        interacting: currentOptions().hideTextDuringInteraction === true && interaction.interacting === true,
      }),
      renderers: deps.getRenderers(),
    })
    deps.onRenderStats(stats)
    deps.onOverviewRender({
      layout: currentLayout,
      viewport: renderViewport,
      mainWidth: cssWidth,
      mainHeight: cssHeight,
      theme: deps.getTheme(),
    })
  }

  function scheduleRender(reason) {
    renderScheduler.schedule(reason)
  }

  function flushScheduledRender() {
    renderScheduler.flush()
  }

  function cancelScheduledRender() {
    renderScheduler.cancel()
  }

  function syncCanvasSize() {
    if (!containerEl || !canvasEl || !ctx) return
    cssWidth = containerEl.clientWidth
    cssHeight = containerEl.clientHeight
    const dpr = globalThis.devicePixelRatio || 1
    canvasEl.width = Math.max(1, Math.round(cssWidth * dpr))
    canvasEl.height = Math.max(1, Math.round(cssHeight * dpr))
    canvasEl.style.width = `${cssWidth}px`
    canvasEl.style.height = `${cssHeight}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function mount(canvas, container) {
    if (!canvas) return
    canvasEl = canvas
    containerEl = container
    ctx = canvas.getContext('2d')
    renderScheduler = createRenderScheduler({ render: () => renderCurrent() })
    syncCanvasSize()
    resizeObserver = new ResizeObserver(() => {
      syncCanvasSize()
      updateLayout({ animate: false, preserveAnchor: false })
    })
    if (container) resizeObserver.observe(container)
    updateLayout({ animate: false, preserveAnchor: false })
  }

  function destroy() {
    cancelScheduledRender()
    resizeObserver?.disconnect()
    resizeObserver = null
  }

  function getCssSize() {
    return { width: cssWidth, height: cssHeight }
  }

  function screenPointFromClient(clientX, clientY) {
    if (!canvasEl) return { x: clientX, y: clientY }
    const rect = canvasEl.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  function pointFromClient(clientX, clientY) {
    return screenToWorld(screenPointFromClient(clientX, clientY), getViewport())
  }

  function zoomAt(screenPoint, deltaY) {
    return applyViewport(zoomViewportAt(getViewport(), screenPoint, deltaY, viewportOptions(currentOptions())))
  }

  function panBy(delta) {
    return applyViewport(panViewportBy(getViewport(), delta, viewportOptions(currentOptions())), { render: false })
  }

  function getLayout() {
    return layout
  }

  return {
    mount,
    destroy,
    getCssSize,
    screenPointFromClient,
    pointFromClient,
    getLayout,
    updateLayout,
    scrollGroup,
    setGroupExpanded,
    resolveTargetRect,
    resolveCenterTarget,
    getViewport,
    applyViewport,
    zoomAt,
    panBy,
    renderCurrent,
    scheduleRender,
    flushScheduledRender,
    cancelScheduledRender,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-core-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/core-controller.js test/minimap-core-controller.test.js
git commit -m "feat: add core-controller sync foundation (mount/layout/viewport/render scheduling)"
```

---

## Task 2: core-controller 动画层（布局切换动画、viewport 补动、相机方法）

**Files:**
- Modify: `src/minimap/core-controller.js`
- Modify: `test/minimap-core-controller.test.js`

**Interfaces:**
- Produces（新增到 Task 1 的返回对象上）：`fitToScreen()`、`centerOnNode(id)`、`centerOnSelection()`、`zoomTo(scale, center)`、`setViewport(viewport)`、`cancelViewportTween()`、`settleAnimation()`、`cancelAnimation()`。
- `updateLayout` 行为变化：`animate: true`（默认）时跑布局插值动画，动画期间 `getLayout()`/`getViewport()` 反映插值中间帧；`animate: false` 保持瞬时切换。

- [ ] **Step 1: 写失败测试**

Append to `test/minimap-core-controller.test.js` (复用文件顶部已经 import 的 `createDemoGraph`/`createCoreController` 等，不用新增 import):

```js
test('updateLayout animates between the previous and next layout, settling on the final one', () => {
  const frames = stubAnimationFrame()
  const { controller } = mountController()

  controller.setGroupExpanded('heap-1', true)
  const midLayout = controller.getLayout()
  assert.ok(midLayout.groups.find((g) => g.id === 'heap-1'), 'animation has not started yet, old collapsed group should still be present')

  while (frames.runNext(16)) {
    // 推进所有排队的动画帧直到结束
  }

  const finalLayout = controller.getLayout()
  assert.equal(finalLayout.groups.find((g) => g.id === 'heap-1'), undefined)
  controller.destroy()
})

test('fitToScreen tweens the viewport to fit the layout bounds', () => {
  const frames = stubAnimationFrame()
  const { controller } = mountController()

  controller.fitToScreen()
  while (frames.runNext(16)) {
    // 推进 viewport tween
  }
  assert.notDeepEqual(controller.getViewport(), { x: 0, y: 0, scale: 1 })
  controller.destroy()
})

test('centerOnNode reveals a collapsed-group child and centers the viewport on it', () => {
  const frames = stubAnimationFrame()
  const { controller } = mountController()

  controller.centerOnNode('cluster-20')
  while (frames.runNext(16)) {
    // 推进 viewport tween
  }

  const group = controller.getLayout().groups.find((g) => g.id === 'heap-1')
  assert.ok(group.scrollTop > 0)
  controller.destroy()
})

test('centerOnSelection centers on the bounding box of multiple targets', () => {
  const frames = stubAnimationFrame()
  const deps = createDeps({ getSelectedIds: () => ['feeder-1', 'feeder-2'] })
  const ctrl = createCoreController(deps)
  const { canvas, container } = createElements()
  ctrl.mount(canvas, container)

  ctrl.centerOnSelection()
  while (frames.runNext(16)) {
    // 推进 viewport tween
  }

  assert.notDeepEqual(ctrl.getViewport(), { x: 0, y: 0, scale: 1 })
  ctrl.destroy()
})

test('zoomTo sets an exact scale anchored on a world point', () => {
  const frames = stubAnimationFrame()
  const { controller } = mountController()

  controller.zoomTo(2, { x: 0, y: 0 })
  while (frames.runNext(16)) {
    // 推进 viewport tween
  }

  assert.equal(controller.getViewport().scale, 2)
  controller.destroy()
})

test('setViewport settles any in-flight animation and applies the viewport immediately', () => {
  const frames = stubAnimationFrame()
  const { controller, ctx } = mountController()

  controller.fitToScreen()
  const callsBefore = ctx.calls.length
  controller.setViewport({ x: 3, y: 4, scale: 1 })

  assert.deepEqual(controller.getViewport(), { x: 3, y: 4, scale: 1 })
  assert.ok(ctx.calls.length > callsBefore)
  assert.equal(frames.runNext(16), false, 'the fitToScreen tween should have been cancelled')
  controller.destroy()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-core-controller.test.js`
Expected: 新增用例失败（`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport` 不存在；`updateLayout` 还没有动画）。

- [ ] **Step 3: 实现动画层**

在 `src/minimap/core-controller.js` 顶部的 import 里加入：

```js
import { createLayoutTransition, layoutAt, resolveAnchorCenter } from './layout-transition.js'
import { clampScale, fitViewportToBounds, centerViewportOn, tweenViewport } from './viewport.js'
```

在闭包状态区（`let layout = null` 附近）新增：

```js
  let settledLayout = null
  let animationFrameId = null
  let activeTransition = null
  let lastRenderedLayout = null
  let lastRenderedViewport = { ...DEFAULT_VIEWPORT }
  let activeViewportTween = null
  let viewportTweenFrameId = null

  const ANIMATION_DURATION_MS = 200
```

把 `renderCurrent` 函数体最前面两行改成记录最近一次渲染的 layout/viewport（供动画锚点计算用）：

```js
  function renderCurrent(currentLayout = layout, renderViewport = getViewport()) {
    if (!ctx || !currentLayout) return
    lastRenderedLayout = currentLayout
    lastRenderedViewport = { ...renderViewport }
    const interaction = deps.getInteractionRenderState()
```

把 `applyViewport` 里 `internalViewport = next` 之后的渲染调用保持不变，但渲染时改用 `renderCurrent(layout, next)`（已经是这样，不用改）。

在 `updateLayout` 之前新增动画相关函数，并把 `updateLayout` 整体替换成动画版本：

```js
  function cancelAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
    activeTransition = null
  }

  function commitViewportSilently(nextViewport) {
    const next = normalizeViewport(nextViewport, viewportOptions(currentOptions()))
    if (!isViewportControlled()) internalViewport = next
  }

  function finishLayout(nextLayout, nextViewport) {
    layout = nextLayout
    settledLayout = nextLayout
    commitViewportSilently(nextViewport)
    renderCurrent(layout, getViewport())
  }

  function settleAnimation() {
    if (!activeTransition) return
    const { nextLayout, nextViewport } = activeTransition
    cancelAnimation()
    finishLayout(nextLayout, nextViewport)
  }

  function chooseAnchorId(startLayout, nextLayout) {
    const selected = deps.getSelectedIds()[0]
    if (selected && resolveAnchorCenter(startLayout, selected) && resolveAnchorCenter(nextLayout, selected)) return selected
    const root = deps.getGraph().rootIds[0]
    if (root && resolveAnchorCenter(startLayout, root) && resolveAnchorCenter(nextLayout, root)) return root
    return null
  }

  function targetViewportFor(startLayout, nextLayout, preserveAnchor) {
    const viewport = getViewport()
    if (!preserveAnchor || !startLayout) return viewport
    const anchorId = chooseAnchorId(startLayout, nextLayout)
    if (!anchorId) return viewport
    const before = resolveAnchorCenter(startLayout, anchorId)
    const after = resolveAnchorCenter(nextLayout, anchorId)
    return keepAnchorStable(viewport, before, after)
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
      commitViewportSilently(frame.viewport)
      renderCurrent(layout, getViewport())

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
    const nextLayout = computeLayout(deps.getGraph(), {
      direction: deps.getLayoutDirection(),
      viewportWidth: cssWidth,
      viewportHeight: cssHeight,
      groupThreshold: currentOptions().groupThreshold,
      groupStates: new Map(Object.entries(currentGroupStates())),
    })

    const startLayout = lastRenderedLayout || settledLayout || layout
    const startViewport = lastRenderedViewport || getViewport()
    const nextViewport = targetViewportFor(startLayout, nextLayout, preserveAnchor)
    const canAnimate = animate && typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function'

    cancelAnimation()

    if (!startLayout || !canAnimate || ANIMATION_DURATION_MS <= 0) {
      finishLayout(nextLayout, nextViewport)
      return
    }

    commitViewportSilently(startViewport)
    startAnimation(startLayout, nextLayout, startViewport, nextViewport)
  }
```

> 注意：`chooseAnchorId`/`targetViewportFor`/`startAnimation`/`updateLayout` 要用到 `layout.js` 的 `keepAnchorStable`，记得把它加进文件顶部已有的 `layout.js` import 列表里（跟 `computeLayout`/`clampGroupScroll`/`locateChildGroup`/`childRectInGroup`/`scrollTopToReveal` 放一起）。

viewport tween 和相机方法，新增在 `panBy`/`zoomAt` 附近：

```js
  function cancelViewportTween() {
    if (viewportTweenFrameId !== null) {
      cancelAnimationFrame(viewportTweenFrameId)
      viewportTweenFrameId = null
    }
    activeViewportTween = null
  }

  function runViewportTween(toViewport, { durationMs = 200 } = {}) {
    settleAnimation()
    cancelViewportTween()

    const next = normalizeViewport(toViewport, viewportOptions(currentOptions()))
    const fromViewport = getViewport()
    if (sameViewport(fromViewport, next)) return

    if (isViewportControlled()) {
      deps.emitViewportChange(next)
      return
    }

    activeViewportTween = { fromViewport, toViewport: next, durationMs, startedAt: null }
    const tick = (time) => {
      if (!activeViewportTween) return
      if (activeViewportTween.startedAt === null) activeViewportTween.startedAt = time
      const progress = (time - activeViewportTween.startedAt) / activeViewportTween.durationMs
      if (progress >= 1) {
        viewportTweenFrameId = null
        const finalViewport = activeViewportTween.toViewport
        activeViewportTween = null
        internalViewport = finalViewport
        renderCurrent(layout, finalViewport)
        deps.emitViewportChange(finalViewport)
        return
      }
      internalViewport = tweenViewport(activeViewportTween.fromViewport, activeViewportTween.toViewport, progress)
      renderCurrent(layout, internalViewport)
      viewportTweenFrameId = requestAnimationFrame(tick)
    }
    viewportTweenFrameId = requestAnimationFrame(tick)
  }

  function fitToScreen() {
    if (!layout) return
    runViewportTween(fitViewportToBounds(layout.bounds, cssWidth, cssHeight, currentOptions()))
  }

  function centerOnNode(id) {
    const target = resolveCenterTarget(id)
    if (!target) return
    runViewportTween(centerViewportOn(target, getViewport(), cssWidth, cssHeight))
  }

  function centerOnSelection() {
    const ids = deps.getSelectedIds()
    if (ids.length === 0) return
    const rects = ids.map(resolveTargetRect).filter(Boolean)
    if (rects.length === 0) return
    const minX = Math.min(...rects.map((r) => r.x))
    const maxX = Math.max(...rects.map((r) => r.x + r.width))
    const minY = Math.min(...rects.map((r) => r.y))
    const maxY = Math.max(...rects.map((r) => r.y + r.height))
    const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    runViewportTween(centerViewportOn(target, getViewport(), cssWidth, cssHeight))
  }

  function zoomTo(scale, center = null) {
    const viewport = getViewport()
    const worldCenter = center ?? screenToWorld({ x: cssWidth / 2, y: cssHeight / 2 }, viewport)
    const nextScale = clampScale(scale, viewportOptions(currentOptions()))
    runViewportTween({
      x: worldCenter.x * (viewport.scale - nextScale) + viewport.x,
      y: worldCenter.y * (viewport.scale - nextScale) + viewport.y,
      scale: nextScale,
    })
  }

  function setViewport(viewport) {
    settleAnimation()
    cancelViewportTween()
    applyViewport(viewport)
  }
```

把 `destroy()` 改成同时取消动画和 tween：

```js
  function destroy() {
    cancelScheduledRender()
    cancelAnimation()
    cancelViewportTween()
    resizeObserver?.disconnect()
    resizeObserver = null
  }
```

最后把这些新函数加进 `return { ... }`：`fitToScreen`、`centerOnNode`、`centerOnSelection`、`zoomTo`、`setViewport`、`cancelViewportTween`、`settleAnimation`、`cancelAnimation`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-core-controller.test.js`
Expected: 全部通过（包括 Task 1 的用例，确认没有回归）。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/core-controller.js test/minimap-core-controller.test.js
git commit -m "feat: add layout transition animation and viewport tween to core-controller"
```

---

## Task 3: minimap-controller.js 根——DOM 监听挂载与方法转发

**Files:**
- Create: `src/minimap/minimap-controller.js`
- Create: `test/minimap-root-controller.test.js`

**Interfaces:**
- Consumes：Task 1/2 的 `createCoreController`。
- Produces：
  ```js
  createMinimapController(deps) -> {
    mount(canvas, container), destroy(),
    getCssSize(), screenPointFromClient, pointFromClient,
    getLayout(), updateLayout,
    scrollGroup(group, rawScrollTop), setGroupExpanded(groupId, expanded), resolveTargetRect(id), resolveCenterTarget(id),
    getViewport(), applyViewport, zoomAt, panBy,
    fitToScreen(), centerOnNode(id), centerOnSelection(), zoomTo(scale, center), setViewport(viewport), cancelViewportTween(), settleAnimation(), cancelAnimation(),
    renderCurrent(), scheduleRender(reason), flushScheduledRender(), cancelScheduledRender(),
  }
  ```
  `deps` = core 需要的全部 deps（同 Task 1/2）+ `onPointerDown`、`onPointerMove`、`onPointerUp`、`onPointerLeave`、`onPointerCancel`、`onLostPointerCapture`、`onKeyDown`、`onWheel`、`onContextMenu`、`onDragOver`、`onDrop`（每个签名都是 `(event) => void`，本切片由 `Minimap.vue` 本地函数提供）。

- [ ] **Step 1: 写失败测试**

Create `test/minimap-root-controller.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { createMinimapController } from '../src/minimap/minimap-controller.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()
stubAnimationFrame()

function createElements() {
  const canvas = document.createElement('canvas')
  const container = document.createElement('div')
  container.appendChild(canvas)
  return { canvas, container }
}

function createDeps(overrides = {}) {
  return {
    getGraph: () => createDemoGraph(),
    getLayoutDirection: () => 'horizontal',
    getOptions: () => ({}),
    getTheme: () => ({}),
    getRenderers: () => ({}),
    getViewportProp: () => null,
    getGroupStatesProp: () => null,
    getSelectedIds: () => [],
    getInteractionRenderState: () => ({
      dragging: false,
      interacting: false,
      groupDrag: null,
      selectionRect: null,
      groupScrollbarHoverId: null,
      attachPreview: null,
    }),
    emitViewportChange: () => {},
    emitGroupStateChange: () => {},
    onRenderStats: () => {},
    onOverviewRender: () => {},
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    onPointerLeave: () => {},
    onPointerCancel: () => {},
    onLostPointerCapture: () => {},
    onKeyDown: () => {},
    onWheel: () => {},
    onContextMenu: () => {},
    onDragOver: () => {},
    onDrop: () => {},
    ...overrides,
  }
}

const POINTER_EVENTS = [
  ['pointerdown', 'onPointerDown'],
  ['pointermove', 'onPointerMove'],
  ['pointerup', 'onPointerUp'],
  ['pointerleave', 'onPointerLeave'],
  ['pointercancel', 'onPointerCancel'],
  ['lostpointercapture', 'onLostPointerCapture'],
  ['keydown', 'onKeyDown'],
  ['wheel', 'onWheel'],
  ['contextmenu', 'onContextMenu'],
  ['dragover', 'onDragOver'],
  ['drop', 'onDrop'],
]

test('mount attaches every canvas DOM listener and forwards events to the injected handlers', () => {
  const received = {}
  const overrides = {}
  for (const [, depName] of POINTER_EVENTS) {
    overrides[depName] = (event) => {
      received[depName] = event
    }
  }
  const controller = createMinimapController(createDeps(overrides))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  for (const [eventName, depName] of POINTER_EVENTS) {
    const EventCtor = eventName === 'wheel' || eventName === 'contextmenu' ? MouseEvent : Event
    canvas.dispatchEvent(new EventCtor(eventName, { bubbles: true, cancelable: true }))
    assert.ok(received[depName], `expected ${depName} to be called for ${eventName}`)
  }

  controller.destroy()
})

test('destroy removes every canvas DOM listener', () => {
  let calls = 0
  const controller = createMinimapController(createDeps({ onPointerDown: () => { calls += 1 } }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.destroy()

  canvas.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
  assert.equal(calls, 0)
})

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-root-controller.test.js`
Expected: 失败，因为 `src/minimap/minimap-controller.js` 不存在。

- [ ] **Step 3: 实现 minimap-controller.js**

Create `src/minimap/minimap-controller.js`:

```js
import { createCoreController } from './core-controller.js'

const POINTER_EVENT_BINDINGS = [
  ['pointerdown', 'onPointerDown'],
  ['pointermove', 'onPointerMove'],
  ['pointerup', 'onPointerUp'],
  ['pointerleave', 'onPointerLeave'],
  ['pointercancel', 'onPointerCancel'],
  ['lostpointercapture', 'onLostPointerCapture'],
  ['keydown', 'onKeyDown'],
  ['contextmenu', 'onContextMenu'],
  ['dragover', 'onDragOver'],
  ['drop', 'onDrop'],
]

export function createMinimapController(deps) {
  const core = createCoreController(deps)
  let canvasEl = null
  const listeners = []

  function addListener(eventName, handler, options) {
    listeners.push({ eventName, handler, options })
  }

  function handleWheel(event) {
    deps.onWheel(event)
  }

  function mount(canvas, container) {
    canvasEl = canvas
    core.mount(canvas, container)
    if (!canvasEl) return

    for (const [eventName, depName] of POINTER_EVENT_BINDINGS) {
      const handler = (event) => deps[depName](event)
      addListener(eventName, handler)
      canvasEl.addEventListener(eventName, handler)
    }
    addListener('wheel', handleWheel, { passive: false })
    canvasEl.addEventListener('wheel', handleWheel, { passive: false })
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
    fitToScreen: core.fitToScreen,
    centerOnNode: core.centerOnNode,
    centerOnSelection: core.centerOnSelection,
    zoomTo: core.zoomTo,
    setViewport: core.setViewport,
    cancelViewportTween: core.cancelViewportTween,
    settleAnimation: core.settleAnimation,
    cancelAnimation: core.cancelAnimation,
    renderCurrent: core.renderCurrent,
    scheduleRender: core.scheduleRender,
    flushScheduledRender: core.flushScheduledRender,
    cancelScheduledRender: core.cancelScheduledRender,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-root-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/minimap-controller.js test/minimap-root-controller.test.js
git commit -m "feat: add root minimap-controller (DOM listener mounting + method forwarding)"
```

---

## Task 4: Minimap.vue 接入 controller，删除已迁出的本地实现

**Files:**
- Modify: `src/minimap/Minimap.vue`

**Interfaces:**
- Consumes：`createMinimapController` from Task 3。
- 对外 props/emits/`defineExpose` 方法名和参数形状不变；不新增测试文件，靠现有全部测试回归。

- [ ] **Step 1: 确认基线——现有全部测试先跑一遍**

Run: `npm test`
Expected: 全部通过（记录当前测试数量，等任务结束后再跑一遍对比，确认没有少测试）。

- [ ] **Step 2: 在 `Minimap.vue` 顶部把直接 import 的纯模块函数换成 controller import**

在 `<script setup>` 的 import 区，删除以下几行（这些函数全部迁进了 core-controller，`Minimap.vue` 不再直接调用）：

```js
import {
  computeLayout,
  keepAnchorStable,
  GROUP,
  clampGroupScroll,
  childRectInGroup,
  locateChildGroup,
  scrollTopToReveal,
} from './layout.js'
import {
  createLayoutTransition,
  layoutAt,
  resolveAnchorCenter,
} from './layout-transition.js'
import { renderScene, worldRectToScreen } from './renderer.js'
import {
  DEFAULT_VIEWPORT,
  centerViewportOn,
  clampScale,
  fitViewportToBounds,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  tweenViewport,
  viewportOptions,
  zoomViewportAt,
} from './viewport.js'
```

改成：

```js
import { GROUP, clampGroupScroll } from './layout.js'
import { worldRectToScreen } from './renderer.js'
import { createMinimapController } from './minimap-controller.js'
```

> 保留 `GROUP`/`clampGroupScroll`——它们还被滚动条命中检测（`scrollbarMetrics`/`hitScrollbarThumb`）和拖拽相关代码使用，这些逻辑本切片不迁移。保留 `worldRectToScreen`——`ghostRectForPoint`（拖拽 ghost 矩形，本切片不迁移）还要用它把世界坐标矩形转屏幕坐标；`renderScene` 本身删掉，因为只有旧 `renderCurrent()` 调用它，而 `renderCurrent` 整个迁进了 core。`screenToWorld`（来自 `./coords.js`）和 `createRenderScheduler`/`resolveRenderQuality` 的 import 也一并删除，因为坐标转换和渲染调度现在全部经过 controller。

- [ ] **Step 3: 删除已经迁出 core-controller 的本地变量和函数**

删除以下本地变量声明（在 `let ctx = null` 一带）：`ctx`、`layout`、`settledLayout`、`animationFrameId`、`activeTransition`、`lastRenderedLayout`、`lastRenderedViewport`、`activeViewportTween`、`viewportTweenFrameId`、`renderScheduler`、`internalViewport`、`internalGroupStates`。改成：

```js
let controller = null
let dragState = null
let scrollbarDragState = null
let panState = null
let marqueeState = null
let hoveredScrollbarGroupId = null
let operationManager = null
let contextMenuDocumentListener = null
const contextMenuState = ref(null)
```

删除整段函数：`currentViewport`、`applyViewport`、`cancelViewportTween`、`runViewportTween`、`currentGroupStates`、`updateGroupState`、`currentRenderQuality`、`scheduleRender`、`flushScheduledRender`、`cancelScheduledRender`、`renderCurrent`、`cancelAnimation`、`settleAnimation`、`chooseAnchorId`、`targetViewportFor`、`commitViewportSilently`、`finishLayout`、`startAnimation`、`updateLayout`、`canvasElement`、`containerElement`、`screenPointFromEvent`、`pointFromEvent`、`resolveTargetRect`、`rectCenter`、`resolveCenterTarget`、`fitToScreen`、`centerOnNode`、`centerOnSelection`、`zoomTo`、`setViewport`、`getViewport`、`syncCanvasSize`。

> `internalGroupStates`/`currentGroupStates()` 在原代码里只有一个读者（`updateLayout` 组装 `groupStates` Map）和一个写者（`updateGroupState`），两者都迁进了 core——core 自己内部持有等价的 `internalGroupStates` 闭包变量（见 Task 1）。`Minimap.vue` 不需要保留本地副本：哪里用到"是否非受控"，直接判 `props.groupStates === null`，不需要经过一个 helper 函数。

保留 `currentSelectedIds`（选中态本切片不迁移，仍由 `Minimap.vue` 自己管理）。`syncConfigFromProps` 保留。

- [ ] **Step 4: 把还留在 `Minimap.vue` 里的函数体改成调用 `controller.xxx()`**

逐个替换以下调用点（保持函数名和外部行为不变，只换内部实现）：

`dragRenderContext()`（约在原 `dragState` 渲染上下文构建处）不再单独存在——它的产出现在要通过 `getInteractionRenderState()` 提供给 controller。在文件里新增一个函数，放在 `dragState`/`marqueeState`/`hoveredScrollbarGroupId` 声明之后：

```js
function interactionRenderState() {
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
  const layout = controller.getLayout()
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
```

> 这个函数原样保留了旧 `dragRenderContext()`/`renderCurrent()` 里组装 `groupDrag`/`selectionRect`/`attachPreview` 的逻辑，只是把"调用 `renderScene`"那部分留给 core，自己只负责产出 `getInteractionRenderState()` 要的形状。`shouldAutoScroll`、`buildVirtualOrder`、`currentShiftRects`、`dragShiftEasedProgress`、`normalizeRect`、`now` 都是已有的本地函数/已导入的纯函数，原样保留不动。

在 `onMounted` 之前新增 controller 的创建逻辑：

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
    getSelectedIds: () => currentSelectedIds(),
    getInteractionRenderState: () => interactionRenderState(),
    emitViewportChange: (next) => emit('viewport-change', next),
    emitGroupStateChange: (next) => emit('group-state-change', next),
    onRenderStats: (stats) => { renderStats.value = stats },
    onOverviewRender: (scene) => overviewRef.value?.render(scene),
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerLeave: clearScrollbarHover,
    onPointerCancel: cancelPointerInteractions,
    onLostPointerCapture: cancelPointerInteractions,
    onKeyDown: handleKeyDown,
    onWheel: handleWheel,
    onContextMenu: openContextMenu,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  })
}
```

把 `onMounted`/`onUnmounted` 改成：

```js
onMounted(() => {
  controller = createInteractionController()
  controller.mount(canvasRef.value, containerRef.value)
})

onUnmounted(() => {
  controller?.destroy()
  controller = null
  closeContextMenu()
})
```

逐处替换函数体内的旧调用：

- `handlePointerDown`/`handlePointerMove`/`handlePointerUp`/`handleWheel`/`handleDrop`/`resolveResourceDropTarget`/`hitScrollbarThumb`/`scrollbarMetrics`/`ghostRectForPoint`/`openContextMenu`/`contextFromHit` 等里所有 `layout`（裸变量）替换成 `controller.getLayout()`。
- `pointFromEvent(event)` 替换成 `controller.pointFromClient(event.clientX, event.clientY)`；`screenPointFromEvent(event)` 替换成 `controller.screenPointFromClient(event.clientX, event.clientY)`。
- `renderCurrent()` 调用替换成 `controller.renderCurrent()`；`scheduleRender(reason)`/`flushScheduledRender()`/`cancelScheduledRender()` 同理加 `controller.` 前缀。
- `updateLayout(opts)` 替换成 `controller.updateLayout(opts)`。
- `settleAnimation()` 替换成 `controller.settleAnimation()`。
- `applyViewport(next, opts)` 替换成 `controller.applyViewport(next, opts)`；`currentViewport()` 替换成 `controller.getViewport()`。
- 分组滚动/展开有 5 个调用点，分两类区别对待——**不要**把它们一刀切地全改成 `controller.scrollGroup`：
  1. `handlePointerMove` 的滚动条**拖拽中**分支（`scrollbarDragState` 存在时）：这是逐帧的实时预览，原代码不经过 `updateGroupState`、直接无条件改 `group.scrollTop`（哪怕受控也先改本地对象，等松手才提交）。**保留这个直接赋值**，只把 `layout`/`currentViewport()`/`renderCurrent()` 换成 `controller.getLayout()`/`controller.getViewport()`/`controller.renderCurrent()`：
     ```js
     if (scrollbarDragState) {
       const group = controller.getLayout().groups.find((g) => g.id === scrollbarDragState.groupId)
       if (!group) return
       const deltaScreenY = event.clientY - scrollbarDragState.startScreenY
       const viewport = controller.getViewport()
       const scrollDelta = (deltaScreenY / (scrollbarDragState.metrics.maxThumbOffset * viewport.scale)) * scrollbarDragState.metrics.maxScroll
       const rawScrollTop = scrollbarDragState.startScrollTop + scrollDelta
       const nextScrollTop = clampGroupScroll(group, rawScrollTop)
       group.scrollTop = nextScrollTop
       controller.renderCurrent()
       return
     }
     ```
  2. `handlePointerUp` 的滚动条**松手提交**分支：原代码在这里才真正调用 `updateGroupState` + 条件 `updateLayout`/`renderCurrent`，这一步整段换成 `controller.scrollGroup`：
     ```js
     if (scrollbarDragState) {
       controller.flushScheduledRender()
       const group = controller.getLayout().groups.find((g) => g.id === scrollbarDragState.groupId)
       if (group) controller.scrollGroup(group, group.scrollTop)
       scrollbarDragState = null
       return
     }
     ```
  3. `cancelScrollbarDrag()`（指针丢失/取消时回滚预览）：原代码直接判 `props.groupStates === null` 决定要不要把 `group.scrollTop` 改回 `scrollbarDragState.startScrollTop`，不经过任何 controller 方法，保持原样，只换 `layout`/`updateLayout`/`renderCurrent`：
     ```js
     function cancelScrollbarDrag() {
       if (!scrollbarDragState) return
       const group = controller.getLayout()?.groups.find((g) => g.id === scrollbarDragState.groupId)
       if (group && props.groupStates === null) group.scrollTop = scrollbarDragState.startScrollTop
       hoveredScrollbarGroupId = null
       scrollbarDragState = null
       if (props.groupStates !== null) controller.updateLayout({ animate: false, preserveAnchor: false })
       else controller.renderCurrent()
     }
     ```
  4. `handleWheel` 的分组滚动分支（每个 wheel 事件本来就是即时提交，跟 `scrollGroup` 语义一致）：
     ```js
     if (hit?.type === 'group') {
       const group = controller.getLayout().groups.find((g) => g.id === hit.id)
       if (group?.overflowY) {
         event.preventDefault()
         controller.scrollGroup(group, group.scrollTop + event.deltaY)
         return
       }
     }
     ```
  5. `handlePointerDown` 的分组表头点击（展开/折叠）：
     ```js
     if (hit?.type === 'group' && hit.zone === 'header') {
       const group = controller.getLayout().groups.find((g) => g.id === hit.id)
       controller.setGroupExpanded(hit.id, !group.expanded)
       return
     }
     ```
- `resolveTargetRect(id)`/`resolveCenterTarget(id)` 调用改成 `controller.resolveTargetRect(id)`/`controller.resolveCenterTarget(id)`。
- `defineExpose` 里的 `fitToScreen`、`centerOnNode`、`centerOnSelection`、`zoomTo`、`setViewport`、`getViewport` 改成：

```js
defineExpose({
  fitToScreen: () => controller.fitToScreen(),
  centerOnNode: (id) => controller.centerOnNode(id),
  centerOnSelection: () => controller.centerOnSelection(),
  zoomTo: (scale, center) => controller.zoomTo(scale, center),
  setViewport: (viewport) => controller.setViewport(viewport),
  getViewport: () => controller.getViewport(),
  select,
  clearSelection,
  search,
  searchNext,
  searchPrevious,
  undo,
  redo,
  canUndo,
  canRedo,
  deleteSelection,
  copySelection,
  paste,
  exportGraph,
  importGraph,
})
```

- 各处 `watch(...)` 回调里调用的 `updateLayout()`/`renderCurrent()` 都加上 `controller.` 前缀；`watch(() => props.viewport, () => renderCurrent())` 改成 `watch(() => props.viewport, () => controller.renderCurrent())`。

- [ ] **Step 4: 运行完整测试套件**

Run: `npm test`
Expected: 全部通过，且测试总数跟 Step 1 记录的基线一致或更多（新增了 core-controller/root-controller 测试，原有 Vue 集成测试数量不变）。

- [ ] **Step 5: 跑 build**

Run: `npm run build`
Expected: 构建成功，无类型/语法错误。

- [ ] **Step 6: Commit**

```bash
git add src/minimap/Minimap.vue
git commit -m "refactor: wire Minimap.vue to minimap-controller, drop migrated local orchestration"
```

---

## Task 5: 全量验证与 ROADMAP 收尾

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: 跑全量测试**

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 3: 手动验收（开发服务器）**

Run: `npm run dev`，在浏览器打开示例图，依次验证：平移、滚轮缩放、容器 resize、点击分组表头展开/折叠、拖动分组框滚动条、`window.__minimapRef?.fitToScreen()`/`centerOnNode(id)`（或页面上已有的调用入口）。行为应跟切片前一致。

- [ ] **Step 4: 更新 ROADMAP.md**

把 `ROADMAP.md` 里：

```md
  - [ ] 切片 1：根 controller + core-controller（canvas/resize/layout 状态/布局切换动画/viewport+tween/渲染调度降级）
```

改成：

```md
  - [x] 切片 1：根 controller + core-controller（canvas/resize/layout 状态/布局切换动画/viewport+tween/渲染调度降级；新增 `core-controller.js`/`minimap-controller.js` + 测试；[design](docs/superpowers/specs/2026-06-21-controller-extraction-design.md)，[plan](docs/superpowers/plans/2026-06-21-controller-extraction-slice-1.md)，`npm test` 全过，`npm run build` 通过）
```

把"当前阶段"那几行改成指向切片 2：

```md
- **当前阶段**：Controller 抽取切片 2 —— selection + edit + search + context-menu
- **当前阶段 Spec**：待头脑风暴产出后补充
- **当前阶段计划**：待头脑风暴产出后补充
```

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark controller extraction slice 1 done"
```

## Self-Review

- **Spec coverage**：spec 里切片 1 范围内列出的 canvas 挂载/resize、layout 状态、分组受控态、viewport+tween、布局切换动画、渲染调度/降级、坐标转换全部在 Task 1-3 落地；`Minimap.vue` 的 `defineExpose`/`onMounted`/`onUnmounted` 收口在 Task 4；测试策略和验收标准对应 Task 1-3 的测试文件与 Task 5 的全量验证。
- **Placeholder 扫描**：无 TBD/TODO；Task 4 里两处"先这样声明，下一步改成……"的说明都在同一任务内给出了最终代码，不是留给后续任务的占位。
- **类型一致性**：`createCoreController`/`createMinimapController` 的方法名在 Task 1→2→3→4 之间保持一致（`getLayout`、`getViewport`、`applyViewport`、`scrollGroup`、`setGroupExpanded`、`resolveTargetRect`、`resolveCenterTarget`、`fitToScreen`、`centerOnNode`、`centerOnSelection`、`zoomTo`、`setViewport`、`renderCurrent`、`scheduleRender`/`flushScheduledRender`/`cancelScheduledRender`），`getInteractionRenderState()` 返回形状（`dragging`/`interacting`/`groupDrag`/`selectionRect`/`groupScrollbarHoverId`/`attachPreview`）在 core-controller 消费侧和 `Minimap.vue` 的 `interactionRenderState()` 产出侧字段名完全对应。
