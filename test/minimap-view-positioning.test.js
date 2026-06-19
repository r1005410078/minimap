import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubAnimationFrame, stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, childRectInGroup, scrollTopToReveal } from '../src/minimap/layout.js'
import { centerViewportOn, fitViewportToBounds } from '../src/minimap/viewport.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

function settle() {
  frames.runNext(0)
  frames.runNext(200)
}

function referenceLayout() {
  return computeLayout(createDemoGraph(), { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
}

function renderedRectForLabel(ctx, label) {
  const lastClear = ctx.calls.map((call) => call.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  const labelIndex = calls.findIndex((call) => call.method === 'fillText' && call.args[0] === label)
  assert.notEqual(labelIndex, -1)
  const rectCall = calls.slice(0, labelIndex).findLast((call) => call.method === 'strokeRect')
  assert.ok(rectCall)
  const [x, y, width, height] = rectCall.args
  return { x, y, width, height }
}

test('fitToScreen fits the demo graph bounds into the viewport with padding', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.fitToScreen()
  settle()

  const expected = fitViewportToBounds(referenceLayout().bounds, 800, 600, null)
  assert.deepEqual(wrapper.vm.getViewport(), expected)
  wrapper.destroy()
})

test('fitToScreen on an empty graph is a no-op', () => {
  const graph = { version: 1, nodes: new Map(), rootIds: [], edges: [] }
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.fitToScreen()
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('centerOnNode centers a plain node and preserves current scale', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnNode('feeder-1')
  settle()

  const rect = referenceLayout().nodes.get('feeder-1')
  const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  wrapper.destroy()
})

test('centerOnNode centers a group box by its chrome rect', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnNode('heap-1::g0')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const target = { x: group.x + group.width / 2, y: group.y + group.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  wrapper.destroy()
})

test('centerOnNode scrolls a collapsed group to reveal a hidden child without expanding it', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnNode('cluster-24')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const index = group.children.indexOf('cluster-24')
  const scrollTop = scrollTopToReveal(group, index)
  const rect = childRectInGroup({ ...group, scrollTop }, 'cluster-24')
  const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))

  const groupStates = wrapper.emitted('group-state-change').at(-1)[0]
  assert.deepEqual(groupStates['heap-1::g0'], { scrollTop })
  wrapper.destroy()
})

test('centerOnNode on an unknown id is a no-op', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnNode('does-not-exist')
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('centerOnSelection centers the true bounding box of mixed selections and preserves scale', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  wrapper.vm.setViewport({ x: 0, y: 0, scale: 2.5 })
  wrapper.vm.select(['feeder-1', 'heap-1::g0'])

  wrapper.vm.centerOnSelection()
  settle()

  const layout = referenceLayout()
  const feeder = layout.nodes.get('feeder-1')
  const group = layout.groups.find((g) => g.id === 'heap-1::g0')
  const minX = Math.min(feeder.x, group.x)
  const maxX = Math.max(feeder.x + feeder.width, group.x + group.width)
  const minY = Math.min(feeder.y, group.y)
  const maxY = Math.max(feeder.y + feeder.height, group.y + group.height)
  const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 2.5 }, 800, 600))
  wrapper.destroy()
})

test('centerOnSelection with an empty selection is a no-op', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnSelection()
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('zoomTo without a center keeps the current screen center fixed', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  wrapper.vm.setViewport({ x: 50, y: 20, scale: 1 })

  wrapper.vm.zoomTo(2)
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: -300, y: -260, scale: 2 })
  wrapper.destroy()
})

test('zoomTo with an explicit world point keeps that point at its current screen position', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  wrapper.vm.setViewport({ x: 50, y: 20, scale: 1 })

  wrapper.vm.zoomTo(2, { x: 10, y: 10 })
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 40, y: 10, scale: 2 })
  wrapper.destroy()
})

test('zoomTo clamps scale to options bounds', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, options: { minScale: 0.25, maxScale: 3 } } })
  wrapper.vm.setViewport({ x: 50, y: 20, scale: 1 })

  wrapper.vm.zoomTo(10, { x: 10, y: 10 })
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 30, y: 0, scale: 3 })
  wrapper.destroy()
})

test('setViewport applies immediately without scheduling an animation frame', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const scheduledBefore = frames.scheduled.length

  wrapper.vm.setViewport({ x: 12, y: 34, scale: 1.5 })

  assert.deepEqual(wrapper.vm.getViewport(), { x: 12, y: 34, scale: 1.5 })
  assert.equal(frames.scheduled.length, scheduledBefore)
  wrapper.destroy()
})

test('select supports replace/add/remove/toggle modes and clearSelection empties it', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])

  wrapper.vm.select(['feeder-2'], 'add')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1', 'feeder-2'])

  wrapper.vm.select(['feeder-1'], 'remove')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-2'])

  wrapper.vm.select(['feeder-2', 'feeder-3'], 'toggle')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-3'])

  wrapper.vm.clearSelection()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])
  wrapper.destroy()
})

test('controlled viewport mode: centerOnNode only emits, never mutates the rendered scene', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, viewport: { x: 0, y: 0, scale: 1 } } })
  const ctx = contexts.at(-1)
  const before = renderedRectForLabel(ctx, 'Feeder 1')

  wrapper.vm.centerOnNode('feeder-1')
  settle()

  const after = renderedRectForLabel(ctx, 'Feeder 1')
  assert.deepEqual(after, before)
  assert.ok(wrapper.emitted('viewport-change').length > 0)
  wrapper.destroy()
})

test('controlled groupStates: centerOnNode emits the scrollTop patch but targets the unrevealed position', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: { graph, groupStates: { 'heap-1::g0': { scrollTop: 0 } } },
  })

  wrapper.vm.centerOnNode('cluster-24')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const index = group.children.indexOf('cluster-24')
  const expectedScrollTop = scrollTopToReveal(group, index)
  assert.equal(wrapper.emitted('group-state-change').at(-1)[0]['heap-1::g0'].scrollTop, expectedScrollTop)

  // 父级没有真正回写 prop，组件内部不会持久化这次滚动；centerOnNode 实际算出的
  // 目标位置仍然是 group.scrollTop 维持在 0（未揭示）时 cluster-24 所在的矩形——
  // 这一点本身也证明了控制权确实交给了父级，而不是组件自己悄悄应用了这次滚动。
  const staleRect = childRectInGroup(group, 'cluster-24')
  const target = { x: staleRect.x + staleRect.width / 2, y: staleRect.y + staleRect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  wrapper.destroy()
})

test('calling a navigation method mid-pan cancels the pan interaction', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: -10000, clientY: -10000, pointerId: 1, bubbles: true }),
  )

  wrapper.vm.fitToScreen()
  settle()
  const emittedBeforeMove = wrapper.emitted('viewport-change')?.length ?? 0

  canvasEl.dispatchEvent(
    new PointerEvent('pointermove', { clientX: -9900, clientY: -10040, pointerId: 1, bubbles: true }),
  )

  assert.equal(wrapper.emitted('viewport-change')?.length ?? 0, emittedBeforeMove)
  wrapper.destroy()
})
