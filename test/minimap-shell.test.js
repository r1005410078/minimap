import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
const observers = stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

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
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()

  assert.ok(frames.scheduled.length > 0)
  assert.equal(frames.runNext(1000), true)
  assert.equal(frames.runNext(1100), true)
  assert.ok(ctx.calls.length > callsBefore)
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
  frames.runNext(1100)

  const latestCalls = callsSinceLastClear(ctx)
  const gridFill = latestCalls
    .filter((call) => call.method === 'fillRect')
    .find((call) => call.args[0] === 0 && call.args[1] === 0 && call.args[2] === 800 && call.args[3] === 600)
  const verticalGridLine = latestCalls.find((call) => call.method === 'moveTo' && call.args[0] < 0)

  assert.ok(gridFill)
  assert.ok(verticalGridLine)
  assert.notEqual(verticalGridLine.args[0], 0)
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
