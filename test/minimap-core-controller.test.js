import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { createCoreController } from '../src/minimap/controllers/core-controller.js'
import { defaultTheme } from '../src/minimap/render/theme.js'

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
    getOptions: () => ({ disableInitialCenter: true }),
    getTheme: () => defaultTheme,
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
  controller.updateLayout({ animate: false })
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
  const group = controller.getLayout().groups.find((g) => g.parentId === 'heap-1')
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
  const group = ctrl.getLayout().groups.find((g) => g.parentId === 'heap-1')
  const scrollTopBefore = group.scrollTop

  ctrl.scrollGroup(group, 40)

  assert.equal(group.scrollTop, scrollTopBefore)
  assert.equal(emitted.at(-1)[group.id].scrollTop, 40)
  ctrl.destroy()
})

test('setGroupExpanded toggles expanded state and relayouts', () => {
  const frames = stubAnimationFrame()
  const { controller } = mountController()
  const before = controller.getLayout().groups.find((g) => g.parentId === 'heap-1')
  assert.equal(before.expanded, false)
  const heightBefore = before.height

  controller.setGroupExpanded(before.id, true)
  let time = 0
  while (frames.runNext((time += 16))) {
    // complete layout animation
  }

  const after = controller.getLayout().groups.find((g) => g.parentId === 'heap-1')
  assert.equal(after.expanded, true)
  assert.ok(after.height > heightBefore, 'expanded group should have greater height')
  controller.destroy()
})

test('resolveTargetRect returns a group box, a node rect, or a rect inside a collapsed group', () => {
  const { controller } = mountController()
  const group = controller.getLayout().groups.find((g) => g.parentId === 'heap-1')

  const groupRect = controller.resolveTargetRect(group.id)
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
  const group = controller.getLayout().groups.find((g) => g.parentId === 'heap-1')
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
  assert.equal(stats[0].nodeCount, deps.getGraph().nodes.size)
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

test('updateLayout animates between the previous and next layout, settling on the final one', () => {
  const frames = stubAnimationFrame()
  const { controller } = mountController()

  const targetGroup = controller.getLayout().groups.find((g) => g.parentId === 'heap-1')
  controller.setGroupExpanded(targetGroup.id, true)
  const midLayout = controller.getLayout()
  const midGroup = midLayout.groups.find((g) => g.parentId === 'heap-1')
  assert.ok(midGroup, 'animation has not started yet, group should still be present')
  assert.equal(midGroup.expanded, false, 'before animation, group should be collapsed')

  let time = 0
  while (frames.runNext((time += 16))) {
    // 推进所有排队的动画帧直到结束
  }

  const finalLayout = controller.getLayout()
  const finalGroup = finalLayout.groups.find((g) => g.parentId === 'heap-1')
  assert.ok(finalGroup, 'after animation, group should still exist')
  assert.equal(finalGroup.expanded, true, 'after animation, group should be expanded')
  controller.destroy()
})

test('fitToScreen tweens the viewport to fit the layout bounds', () => {
  const frames = stubAnimationFrame()
  const { controller } = mountController()

  controller.fitToScreen()
  let time = 0
  while (frames.runNext((time += 16))) {
    // 推进 viewport tween
  }
  assert.notDeepEqual(controller.getViewport(), { x: 0, y: 0, scale: 1 })
  controller.destroy()
})

test('centerOnNode reveals a collapsed-group child and centers the viewport on it', () => {
  const frames = stubAnimationFrame()
  const { controller } = mountController()

  controller.centerOnNode('cluster-20')
  let time = 0
  while (frames.runNext((time += 16))) {
    // 推进 viewport tween
  }

  const group = controller.getLayout().groups.find((g) => g.parentId === 'heap-1')
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
  let time = 0
  while (frames.runNext((time += 16))) {
    // 推进 viewport tween
  }

  assert.notDeepEqual(ctrl.getViewport(), { x: 0, y: 0, scale: 1 })
  ctrl.destroy()
})

test('zoomTo sets an exact scale anchored on a world point', () => {
  const frames = stubAnimationFrame()
  const { controller } = mountController()

  controller.zoomTo(2, { x: 0, y: 0 })
  let time = 0
  while (frames.runNext((time += 16))) {
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
