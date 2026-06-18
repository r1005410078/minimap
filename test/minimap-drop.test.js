import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

function dispatchPointerDown(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, bubbles: true }),
  )
}

function dispatchDrop(wrapper, payload, point) {
  const canvasEl = wrapper.find('canvas').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'dataTransfer', { value: { getData: () => JSON.stringify(payload) } })
  Object.defineProperty(evt, 'clientX', { value: point.x, configurable: true })
  Object.defineProperty(evt, 'clientY', { value: point.y, configurable: true })
  canvasEl.dispatchEvent(evt)
}

test('dropping with no selection adds a child under graph.rootIds[0]', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const sizeBefore = graph.nodes.size

  dispatchDrop(wrapper, { id: 'solar-array', label: 'Solar Array' }, { x: 0, y: -100000 })

  assert.equal(graph.nodes.size, sizeBefore + 1)
  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'energy-root')
  assert.equal(payload.index, 0)
  const root = graph.nodes.get('energy-root')
  assert.equal(root.children.length, 4)
  assert.ok(root.children[0].startsWith('res-solar-array-'))
  assert.ok(wrapper.emitted('change'))
  assert.equal(wrapper.emitted('change')[0][0], graph)
  wrapper.destroy()
})

test('dropping with a selection adds a child under the selected node, at the dropped position', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mount(Minimap, { propsData: { graph } })

  const gridTieRect = layout.nodes.get('grid-tie')
  dispatchPointerDown(wrapper, {
    x: gridTieRect.x + gridTieRect.width / 2,
    y: gridTieRect.y + gridTieRect.height / 2,
  })

  const feeder1 = layout.nodes.get('feeder-1')
  const feeder2 = layout.nodes.get('feeder-2')
  const between = {
    x: feeder1.x,
    y: (feeder1.y + feeder1.height / 2 + feeder2.y + feeder2.height / 2) / 2,
  }
  dispatchDrop(wrapper, { id: 'wind-turbine', label: 'Wind Turbine' }, between)

  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'grid-tie')
  assert.equal(payload.index, 1)
  const gridTie = graph.nodes.get('grid-tie')
  assert.ok(gridTie.children[1].startsWith('res-wind-turbine-'))
  wrapper.destroy()
})

test('dropping onto a folded group appends the new node at the end', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, selectedIds: ['heap-1'] } })
  const heap = graph.nodes.get('heap-1')
  const sizeBefore = heap.children.length

  dispatchDrop(wrapper, { id: 'battery-bank', label: 'Battery Bank' }, { x: 0, y: 0 })

  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'heap-1')
  assert.equal(payload.index, sizeBefore)
  assert.equal(heap.children.length, sizeBefore + 1)
  wrapper.destroy()
})
