import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, keepAnchorStable } from '../src/minimap/layout.js'
import { easeOutCubic } from '../src/minimap/layout-transition.js'
import { resolveEdges } from '../src/minimap/renderer.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
const observers = stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

test('renders the dark workbench toolbar shell without removing canvas, search, or overview', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })

  assert.equal(wrapper.find('.minimap-toolbar').exists(), true)
  assert.equal(wrapper.findAll('.minimap-toolbar-button').length >= 9, true)
  assert.equal(wrapper.find('.minimap-toolbar-button[aria-label="撤销"]').attributes('disabled'), 'disabled')
  assert.equal(wrapper.find('canvas').attributes('tabindex'), '0')
  assert.equal(wrapper.find('.minimap-search').exists(), true)
  assert.equal(wrapper.find('.minimap-overview-panel').exists(), true)

  wrapper.destroy()
})

test('search and overview options still hide their panels in the polished shell', () => {
  const wrapper = mount(Minimap, {
    propsData: {
      graph: createDemoGraph(),
      options: { enableSearch: false, enableOverview: false },
    },
  })

  assert.equal(wrapper.find('.minimap-search').exists(), false)
  assert.equal(wrapper.find('.minimap-overview-panel').exists(), false)
  assert.equal(wrapper.find('.minimap-toolbar').exists(), true)

  wrapper.destroy()
})

function dispatchDrop(wrapper, payload, point) {
  const canvasEl = wrapper.find('canvas').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'dataTransfer', { value: { getData: () => JSON.stringify(payload) } })
  Object.defineProperty(evt, 'clientX', { value: point.x, configurable: true })
  Object.defineProperty(evt, 'clientY', { value: point.y, configurable: true })
  canvasEl.dispatchEvent(evt)
}

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
    .findLast((call) => call.method === 'strokeRect')
  assert.ok(rectCall)
  const [x, y, width, height] = rectCall.args
  return { x, y, width, height }
}

function centerOf(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }
}

function interpolateRect(from, to, progress) {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    width: from.width + (to.width - from.width) * progress,
    height: from.height + (to.height - from.height) * progress,
  }
}

function interpolateViewport(from, to, progress) {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    scale: from.scale,
  }
}

function screenRect(rect, viewport) {
  return {
    x: rect.x * viewport.scale + viewport.x,
    y: rect.y * viewport.scale + viewport.y,
    width: rect.width * viewport.scale,
    height: rect.height * viewport.scale,
  }
}

function assertApprox(actual, expected, tolerance = 0.001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)
}

function assertRectApprox(actual, expected, tolerance = 0.001) {
  assertApprox(actual.x, expected.x, tolerance)
  assertApprox(actual.y, expected.y, tolerance)
  assertApprox(actual.width, expected.width, tolerance)
  assertApprox(actual.height, expected.height, tolerance)
}

test('mounting draws the initial graph onto the canvas', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'clearRect'))
  assert.ok(ctx.calls.some((call) => call.method === 'fillRect'))
  wrapper.destroy()
})

test('a ResizeObserver callback re-syncs canvas size and re-renders', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length
  observers.at(-1).trigger()
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('changing layoutDirection animates through requestAnimationFrame', async () => {
  const graph = createDemoGraph()
  const horizontalLayout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const verticalLayout = computeLayout(graph, { direction: 'vertical', viewportWidth: 800, viewportHeight: 600 })
  const startViewport = { x: 0, y: 0, scale: 1 }
  const targetViewport = keepAnchorStable(
    startViewport,
    centerOf(horizontalLayout.nodes.get('energy-root')),
    centerOf(verticalLayout.nodes.get('energy-root')),
  )
  const progress = easeOutCubic(0.5)
  const wrapper = mount(Minimap, {
    propsData: { graph, layoutDirection: 'horizontal' },
  })
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()

  assert.ok(frames.scheduled.length > 0)
  assert.equal(frames.runNext(1000), true)
  assert.equal(frames.runNext(1100), true)
  assert.ok(ctx.calls.length > callsBefore)

  const actual = renderedRectForLabel(ctx, 'Storage Heap 1')
  const oldScreen = screenRect(horizontalLayout.nodes.get('heap-1'), startViewport)
  const finalScreen = screenRect(verticalLayout.nodes.get('heap-1'), targetViewport)
  const expected = screenRect(
    interpolateRect(horizontalLayout.nodes.get('heap-1'), verticalLayout.nodes.get('heap-1'), progress),
    interpolateViewport(startViewport, targetViewport, progress),
  )
  assert.ok(Math.abs(actual.x - oldScreen.x) > 1)
  assert.ok(Math.abs(actual.y - finalScreen.y) > 1)
  assertRectApprox(actual, expected)
  wrapper.destroy()
})

test('replacing graph prop animates through requestAnimationFrame', async () => {
  const graph = createDemoGraph()
  const nextGraph = createDemoGraph()
  nextGraph.nodes.set('aux-root', { id: 'aux-root', label: 'Aux Root', parentId: 'energy-root', children: [] })
  nextGraph.nodes.get('energy-root').children.push('aux-root')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const scheduledBefore = frames.scheduled.length
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length

  await wrapper.setProps({ graph: nextGraph })
  await wrapper.vm.$nextTick()

  assert.ok(frames.scheduled.length > scheduledBefore)
  assert.equal(frames.runNext(1000), true)
  assert.equal(frames.runNext(1100), true)
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('completed layout animation does not schedule another frame', async () => {
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  assert.equal(frames.runNext(1000), true)
  const scheduledAfterFirstTick = frames.scheduled.length

  assert.equal(frames.runNext(1200), true)
  assert.equal(frames.scheduled.length, scheduledAfterFirstTick)
  wrapper.destroy()
})

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
  const graph = createDemoGraph()
  const horizontalLayout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const verticalLayout = computeLayout(graph, { direction: 'vertical', viewportWidth: 800, viewportHeight: 600 })
  const startViewport = { x: 0, y: 0, scale: 1 }
  const targetViewport = keepAnchorStable(
    startViewport,
    centerOf(horizontalLayout.nodes.get('heap-1')),
    centerOf(verticalLayout.nodes.get('heap-1')),
  )
  const progress = easeOutCubic(0.5)
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      layoutDirection: 'horizontal',
      selectedIds: ['heap-1'],
    },
  })
  const ctx = contexts.at(-1)

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  frames.runNext(1000)
  frames.runNext(1100)

  const latestCalls = callsSinceLastClear(ctx)
  const gridFill = latestCalls
    .filter((call) => call.method === 'fillRect')
    .find((call) => call.args[0] === 0 && call.args[1] === 0 && call.args[2] === 800 && call.args[3] === 600)
  const verticalGridLine = latestCalls.find((call) => call.method === 'moveTo' && call.args[0] < 0)

  assert.ok(gridFill)
  assert.ok(verticalGridLine)
  assert.notEqual(verticalGridLine.args[0], 0)

  const actualCenter = centerOf(renderedRectForLabel(ctx, 'Storage Heap 1'))
  const expectedCenter = centerOf(
    screenRect(
      interpolateRect(horizontalLayout.nodes.get('heap-1'), verticalLayout.nodes.get('heap-1'), progress),
      interpolateViewport(startViewport, targetViewport, progress),
    ),
  )
  const originalCenter = centerOf(screenRect(horizontalLayout.nodes.get('heap-1'), startViewport))
  assertApprox(actualCenter.x, expectedCenter.x)
  assertApprox(actualCenter.y, expectedCenter.y)
  assertApprox(actualCenter.x, originalCenter.x)
  assertApprox(actualCenter.y, originalCenter.y)
  wrapper.destroy()
})

test('drop during layout animation settles before computing insertion index', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      layoutDirection: 'horizontal',
      selectedIds: ['energy-root'],
    },
  })

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  const activeFrame = frames.scheduled.at(-1).id

  dispatchDrop(wrapper, { id: 'inverter', label: 'Inverter' }, { x: 191, y: 0 })

  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'energy-root')
  assert.equal(payload.index, 2)
  assert.ok(frames.cancelled.includes(activeFrame))
  wrapper.destroy()
})

test('unmounting disconnects the ResizeObserver', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const observer = observers.at(-1)
  wrapper.destroy()
  assert.equal(observer.disconnected, true)
})

test('nodeRenderer prop replaces default node drawing', () => {
  let calls = 0
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), nodeRenderer: () => { calls++ } },
  })
  const ctx = contexts.at(-1)
  assert.ok(calls > 0)
  assert.equal(
    ctx.calls.some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'),
    false,
  )
  wrapper.destroy()
})

test('groupRenderer prop replaces default group drawing', () => {
  let calls = 0
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), groupRenderer: () => { calls++ } },
  })
  const ctx = contexts.at(-1)
  assert.ok(calls > 0)
  assert.equal(
    ctx.calls.some(
      (call) => call.method === 'fillText' && typeof call.args[0] === 'string' && call.args[0].startsWith('heap-1'),
    ),
    false,
  )
  wrapper.destroy()
})

test('edgeRenderer prop replaces default edge drawing', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const expectedEdgeCount = resolveEdges(graph, layout).length
  const payloads = []
  const wrapper = mount(Minimap, {
    propsData: { graph, edgeRenderer: (_ctx, payload) => payloads.push(payload) },
  })
  assert.equal(payloads.length, expectedEdgeCount)
  wrapper.destroy()
})

test('renderer props default to null and do not affect default drawing', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'))
  wrapper.destroy()
})
