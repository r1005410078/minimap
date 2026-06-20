import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, GROUP } from '../src/minimap/layout.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

const LAYOUT_OPTS = { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 }

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

function dispatchPointerUp(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerup', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
}

function nodeCenter(layout, nodeId) {
  const rect = layout.nodes.get(nodeId)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function firstItemCenter(group) {
  return {
    x: group.x + GROUP.padding + GROUP.itemW / 2,
    y: group.y + GROUP.header + GROUP.padding + GROUP.itemH / 2,
  }
}

test('dragging a plain node onto another plain node makes it the new parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'feeder-2')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(graph.nodes.get('feeder-2').children.includes('feeder-1'), true)
  assert.equal(wrapper.emitted('node-move').length, 1)
  assert.equal(wrapper.emitted('node-move')[0][0].nodeId, 'feeder-1')
  assert.equal(wrapper.emitted('node-move')[0][0].fromParentId, 'grid-tie')
  assert.equal(wrapper.emitted('node-move')[0][0].toParentId, 'feeder-2')
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'move-node')

  wrapper.vm.undo()
  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  wrapper.destroy()
})

test('dragging a node into a different group than its origin moves it under that group real parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const targetGroup = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = firstItemCenter(targetGroup)

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'heap-1')
  assert.equal(graph.nodes.get('heap-1').children[0], 'feeder-1')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(wrapper.emitted('node-move').length, 1)
  wrapper.destroy()
})

test('dragging an ungrouped child onto its own real parent reorders within that parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'grid-tie')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-3', 'feeder-1'])
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('node-move'), undefined)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'reorder-group-child')
  wrapper.destroy()
})

test('dragging a node onto its own descendant does not move it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'grid-tie')
  const to = nodeCenter(layout, 'feeder-1')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('grid-tie').parentId, 'energy-root')
  assert.equal(wrapper.emitted('node-move'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('readonly and beforeNodeMove block cross-parent moves', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const readonlyWrapper = mount(Minimap, { propsData: { graph, readonly: true } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(readonlyWrapper, from)
  dispatchPointerMove(readonlyWrapper, to)
  dispatchPointerUp(readonlyWrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  readonlyWrapper.destroy()

  const blockedGraph = createDemoGraph()
  const blockedWrapper = mount(Minimap, {
    propsData: { graph: blockedGraph, beforeNodeMove: () => false },
  })
  const blockedFrom = nodeCenter(layout, 'feeder-1')
  const blockedTo = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(blockedWrapper, blockedFrom)
  dispatchPointerMove(blockedWrapper, blockedTo)
  dispatchPointerUp(blockedWrapper, blockedTo)

  assert.equal(blockedGraph.nodes.get('feeder-1').parentId, 'grid-tie')
  blockedWrapper.destroy()
})

test('clicking a plain node without moving still selects it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const point = nodeCenter(layout, 'feeder-1')
  dispatchPointerDown(wrapper, point)
  dispatchPointerUp(wrapper, point)

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])
  assert.equal(wrapper.emitted('node-move'), undefined)
  wrapper.destroy()
})
