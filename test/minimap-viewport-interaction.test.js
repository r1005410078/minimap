import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubAnimationFrame, stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, GROUP } from '../src/minimap/layout.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

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
    new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
}

function dispatchPointerMove(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointermove', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
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
