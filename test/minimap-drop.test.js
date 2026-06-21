import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { computeLayout } from '../src/minimap/graph/layout.js'
import { defaultTheme } from '../src/minimap/render/theme.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()

const { mountMinimap } = await import('./helpers/mount-minimap.js')

function dispatchPointerDown(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, bubbles: true }),
  )
}

function dispatchPointerUp(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerup', { clientX: point.x, clientY: point.y, bubbles: true }),
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

function dispatchDragOver(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  const evt = new Event('dragover', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'clientX', { value: point.x, configurable: true })
  Object.defineProperty(evt, 'clientY', { value: point.y, configurable: true })
  canvasEl.dispatchEvent(evt)
}

function dropSlotDrawn(ctx, theme) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  return calls.some((call) => call.method === 'set:fillStyle' && call.args[0] === theme.group.dropSlot.fill)
}

function attachLineDrawn(ctx, theme) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  return calls.some((call, i) => {
    if (call.method !== 'moveTo') return false
    for (let j = i - 1; j >= 0; j -= 1) {
      if (calls[j].method === 'set:strokeStyle') return calls[j].args[0] === theme.group.dropSlot.stroke
    }
    return false
  })
}

function nodeCenter(layout, nodeId) {
  const rect = layout.nodes.get(nodeId)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

test('dropping with no selection adds a child under graph.rootIds[0]', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })
  const sizeBefore = graph.nodes.size

  dispatchDrop(wrapper, { id: 'solar-array', label: 'Solar Array' }, { x: 0, y: -100000 })

  assert.equal(graph.nodes.size, sizeBefore + 1)
  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'energy-root')
  assert.equal(payload.index, 0)
  const root = graph.nodes.get('energy-root')
  assert.equal(root.children.length, 4)
  assert.ok(root.children[0].startsWith('res-solar-array-'))
  const change = wrapper.emitted('change')[0][0]
  assert.equal(change.type, 'drop-node')
  assert.equal(change.operation.type, 'drop-node')
  assert.equal(change.operation.payload.parentId, 'energy-root')
  assert.equal(change.operation.payload.index, 0)
  assert.equal(change.nextGraph, graph)
  assert.equal(change.reason, null)
  wrapper.destroy()
})

test('dropping onto a plain node adds the resource as that node child', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mountMinimap( { propsData: { graph } })
  const targetPoint = nodeCenter(layout, 'feeder-2')

  dispatchDrop(wrapper, { id: 'battery-bank', label: 'Battery Bank' }, targetPoint)

  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'feeder-2')
  assert.equal(payload.index, 0)
  const feeder2 = graph.nodes.get('feeder-2')
  assert.equal(feeder2.children.length, 1)
  assert.ok(feeder2.children[0].startsWith('res-battery-bank-'))
  assert.equal(graph.nodes.get(feeder2.children[0]).parentId, 'feeder-2')
  wrapper.destroy()
})

test('dragover a plain node from the resource tree shows an attach preview before drop', async () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mountMinimap({ propsData: { graph } })
  const targetPoint = nodeCenter(layout, 'feeder-2')

  dispatchDragOver(wrapper, targetPoint)
  await wrapper.vm.$nextTick()

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)
  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), true)

  wrapper.destroy()
})

test('dropping onto a plain node takes precedence over the current selection', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mountMinimap( { propsData: { graph, selectedIds: ['grid-tie'] } })
  const targetPoint = nodeCenter(layout, 'feeder-2')

  dispatchDrop(wrapper, { id: 'pcs-device', label: 'PCS Device' }, targetPoint)

  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'feeder-2')
  assert.equal(graph.nodes.get('feeder-2').children.length, 1)
  assert.equal(graph.nodes.get('grid-tie').children.some((id) => id.startsWith('res-pcs-device-')), false)
  wrapper.destroy()
})

test('dropping with a selection adds a child under the selected node, at the dropped position', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mountMinimap( { propsData: { graph } })

  const gridTieRect = layout.nodes.get('grid-tie')
  const gridTiePoint = {
    x: gridTieRect.x + gridTieRect.width / 2,
    y: gridTieRect.y + gridTieRect.height / 2,
  }
  dispatchPointerDown(wrapper, gridTiePoint)
  dispatchPointerUp(wrapper, gridTiePoint)

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
  const wrapper = mountMinimap( { propsData: { graph, selectedIds: ['heap-1'] } })
  const heap = graph.nodes.get('heap-1')
  const sizeBefore = heap.children.length

  dispatchDrop(wrapper, { id: 'battery-bank', label: 'Battery Bank' }, { x: 0, y: 0 })

  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'heap-1')
  assert.equal(payload.index, sizeBefore)
  assert.equal(heap.children.length, sizeBefore + 1)
  wrapper.destroy()
})

test('readonly prevents dropping a resource into the graph', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph, readonly: true } })
  const beforeSize = graph.nodes.size
  const beforeChildren = graph.nodes.get('energy-root').children.slice()

  dispatchDrop(wrapper, { id: 'blocked', label: 'Blocked' }, { x: 0, y: 0 })

  assert.equal(graph.nodes.size, beforeSize)
  assert.deepEqual(graph.nodes.get('energy-root').children, beforeChildren)
  assert.equal(wrapper.emitted('node-drop'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('beforeNodeDrop can block the default drop mutation', () => {
  const graph = createDemoGraph()
  const calls = []
  const wrapper = mountMinimap( {
    propsData: {
      graph,
      beforeNodeDrop(payload) {
        calls.push(payload)
        return false
      },
    },
  })
  const beforeSize = graph.nodes.size

  dispatchDrop(wrapper, { id: 'blocked-hook', label: 'Blocked Hook' }, { x: 0, y: 0 })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].parentId, 'energy-root')
  assert.equal(wrapper.emitted('node-drop'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('dropping multiple resources onto a node creates consecutive children and emits node-drop batch metadata', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap({ propsData: { graph } })
  const calls = []
  wrapper.vm.$on('node-drop', (payload) => calls.push(payload))

  const canvas = wrapper.find('canvas').element
  const target = wrapper.vm.controller.getLayout().nodes.get('grid-tie')
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'clientX', { value: target.x + 10, configurable: true })
  Object.defineProperty(evt, 'clientY', { value: target.y + 10, configurable: true })
  Object.defineProperty(evt, 'dataTransfer', {
    value: {
      getData: () => JSON.stringify({
        resources: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      }),
    },
  })

  canvas.dispatchEvent(evt)

  const children = graph.nodes.get('grid-tie').children
  const added = children.slice(-2)
  assert.equal(graph.nodes.get(added[0]).data.resourceId, 'a')
  assert.equal(graph.nodes.get(added[1]).data.resourceId, 'b')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].batchSize, 2)
  assert.equal(calls[1].batchIndex, 1)
  wrapper.destroy()
})
