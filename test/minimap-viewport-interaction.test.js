import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubAnimationFrame, stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { computeLayout, GROUP } from '../src/minimap/graph/layout.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/components/Minimap.vue')).default

function callsSinceLastClear(ctx) {
  const lastClear = ctx.calls.map((call) => call.method).lastIndexOf('clearRect')
  return ctx.calls.slice(lastClear + 1)
}

function renderedRectForLabel(ctx, label) {
  const calls = callsSinceLastClear(ctx)
  const labelIndex = calls.findIndex((call) => call.method === 'fillText' && call.args[0] === label)
  assert.notEqual(labelIndex, -1)
  const rectCall = calls
    .slice(0, labelIndex)
    .findLast((call) => call.method === 'roundRect' || call.method === 'strokeRect')
  assert.ok(rectCall)
  const [x, y, width, height] = rectCall.args
  return { x, y, width, height }
}

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

function nextPendingFrameId() {
  return frames.scheduled.find((frame) => !frame.ran && !frame.cancelled)?.id
}

function groupCenterForParent(parentId) {
  const layout = computeLayout(createDemoGraph(), { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const group = layout.groups.find((item) => item.parentId === parentId)
  return { x: group.x + group.width / 2, y: group.y + group.height / 2, groupId: group.id }
}

function groupForParent(parentId) {
  const layout = computeLayout(createDemoGraph(), { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  return layout.groups.find((item) => item.parentId === parentId)
}

function firstItemCenter(group) {
  return {
    x: group.x + GROUP.padding + GROUP.itemW / 2,
    y: group.y + GROUP.header + GROUP.padding + GROUP.itemH / 2,
  }
}

function scrollbarThumbCenter(group) {
  const trackHeight = group.height - GROUP.header
  const thumbHeight = (group.height / group.contentHeight) * trackHeight
  return {
    x: group.x + group.width - 4,
    y: group.y + GROUP.header + thumbHeight / 2,
  }
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
  const scheduledFrameCount = frames.scheduled.length

  // Controlled viewport updates should be visually applied only from prop changes.
  // Later pan/zoom gestures may emit proposed viewports, but controlled mode must
  // not schedule layout work or render a proposed viewport without this prop update.
  await wrapper.setProps({ viewport: { x: 80, y: 20, scale: 1 } })
  await wrapper.vm.$nextTick()

  const after = renderedRectForLabel(ctx, 'Grid Tie')
  assert.equal(after.x, before.x + 80)
  assert.equal(after.y, before.y + 20)
  assert.equal(frames.scheduled.length, scheduledFrameCount)
  wrapper.destroy()
})

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

test('wheel during active scrollbar drag does not emit viewport-change', () => {
  const graph = createDemoGraph()
  const group = groupForParent('heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, scrollbarThumbCenter(group))
  dispatchWheel(wrapper, { x: 20, y: 20 }, -200)

  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('wheel during active group item drag does not emit viewport-change', () => {
  const graph = createDemoGraph()
  const group = groupForParent('heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const start = firstItemCenter(group)

  dispatchPointerDown(wrapper, start)
  dispatchPointerMove(wrapper, { x: start.x, y: start.y + GROUP.itemH + GROUP.itemGap })
  dispatchWheel(wrapper, { x: 20, y: 20 }, -200)

  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

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

test('panning preserves custom viewport scale bounds', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: { graph, viewport: { x: 0, y: 0, scale: 5 }, options: { minScale: 0.1, maxScale: 10 } },
  })

  dispatchPointerDown(wrapper, { x: -10000, y: -10000 })
  dispatchPointerMove(wrapper, { x: -9900, y: -10040 })
  dispatchPointerUp(wrapper, { x: -9900, y: -10040 })

  assert.deepEqual(wrapper.emitted('viewport-change').at(-1)[0], { x: 100, y: -40, scale: 5 })
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

test('wheel zoom settles active layout animation before applying viewport', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, layoutDirection: 'horizontal' } })

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  assert.equal(frames.runNext(1000), true)
  const pendingFrameId = nextPendingFrameId()

  dispatchWheel(wrapper, { x: 300, y: 240 }, -200)
  const emitted = wrapper.emitted('viewport-change').at(-1)[0]

  assert.ok(frames.cancelled.includes(pendingFrameId))
  frames.runNext(1100)
  assert.deepEqual(wrapper.emitted('viewport-change').at(-1)[0], emitted)
  wrapper.destroy()
})

test('blank pan settles active layout animation before applying viewport', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, layoutDirection: 'horizontal' } })

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  assert.equal(frames.runNext(2000), true)
  const pendingFrameId = nextPendingFrameId()

  dispatchPointerDown(wrapper, { x: -10000, y: -10000 })
  dispatchPointerMove(wrapper, { x: -9900, y: -10040 })
  const emitted = wrapper.emitted('viewport-change').at(-1)[0]

  assert.ok(frames.cancelled.includes(pendingFrameId))
  frames.runNext(2100)
  assert.deepEqual(wrapper.emitted('viewport-change').at(-1)[0], emitted)
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
