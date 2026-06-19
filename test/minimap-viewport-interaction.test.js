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
