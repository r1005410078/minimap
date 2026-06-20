import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, GROUP } from '../src/minimap/layout.js'
import { defaultTheme } from '../src/minimap/theme.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
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

function dispatchPointerCancel(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointercancel', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
}

function dispatchLostPointerCapture(wrapper, pointerId = 1) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId, bubbles: true }))
}

function dispatchWheel(wrapper, point, deltaY) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new WheelEvent('wheel', { clientX: point.x, clientY: point.y, deltaY, bubbles: true, cancelable: true }),
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

function callsSinceLastClear(ctx) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  return ctx.calls.slice(lastClear + 1)
}

function finishPendingAnimation() {
  frames.runNext(0)
  frames.runNext(100000)
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

function scrollbarThumbCenterAtBottom(group) {
  const trackHeight = group.height - GROUP.header
  const thumbHeight = (group.height / group.contentHeight) * trackHeight
  return {
    x: group.x + group.width - 4,
    y: group.y + group.height - thumbHeight / 2,
  }
}

test('clicking a group header toggles expanded and does not emit select', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const headerPoint = { x: group.x + group.width / 2, y: group.y + GROUP.header / 2 }
  dispatchPointerDown(wrapper, headerPoint)

  assert.equal(wrapper.emitted('select'), undefined)
  assert.deepEqual(wrapper.emitted('group-state-change')[0][0], { [group.id]: { expanded: true } })
  wrapper.destroy()
})

test('clicking a child item inside a group without dragging selects the child', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const itemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, itemPoint)
  dispatchPointerUp(wrapper, itemPoint)

  assert.deepEqual(wrapper.emitted('select')[0][0], ['cluster-1'])
  wrapper.destroy()
})

test('clicking blank space inside a group box selects the group itself', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const bodyPoint = { x: group.x + 2, y: group.y + GROUP.header + 2 }
  dispatchPointerDown(wrapper, bodyPoint)

  assert.deepEqual(wrapper.emitted('select')[0][0], [group.id])
  wrapper.destroy()
})

test('a small movement after pressing on an item does not trigger reorder', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const heap = graph.nodes.get('heap-1')
  const childrenBefore = [...heap.children]

  const itemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, itemPoint)
  dispatchPointerMove(wrapper, { x: itemPoint.x + 2, y: itemPoint.y + 2 })
  dispatchPointerUp(wrapper, { x: itemPoint.x + 2, y: itemPoint.y + 2 })

  assert.deepEqual(wrapper.emitted('select')[0][0], ['cluster-1'])
  assert.equal(wrapper.emitted('group-reorder'), undefined)
  assert.deepEqual(heap.children, childrenBefore)
  wrapper.destroy()
})

test('dragging an item past the threshold reorders the group children in the graph', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const heap = graph.nodes.get('heap-1')

  const firstItemPoint = firstItemCenter(group)
  const targetPoint = { x: firstItemPoint.x, y: firstItemPoint.y + 2 * (GROUP.itemH + GROUP.itemGap) }

  dispatchPointerDown(wrapper, firstItemPoint)
  dispatchPointerMove(wrapper, targetPoint)
  dispatchPointerUp(wrapper, targetPoint)
  finishPendingAnimation()

  assert.equal(heap.children[4], 'cluster-1')
  assert.equal(heap.children.length, 24)
  assert.equal(new Set(heap.children).size, 24)
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('change').length, 1)
  const change = wrapper.emitted('change')[0][0]
  assert.equal(change.type, 'reorder-group-child')
  assert.equal(change.operation.type, 'reorder-group-child')
  assert.equal(change.operation.payload.parentId, 'heap-1')
  assert.equal(change.operation.payload.childId, 'cluster-1')
  assert.equal(change.nextGraph, graph)
  wrapper.destroy()
})

test('readonly prevents dragging a group item from reordering graph children', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph, readonly: true } })
  const heap = graph.nodes.get('heap-1')
  const before = heap.children.slice()

  const firstItemPoint = firstItemCenter(group)
  const targetPoint = { x: firstItemPoint.x, y: firstItemPoint.y + 2 * (GROUP.itemH + GROUP.itemGap) }

  dispatchPointerDown(wrapper, firstItemPoint)
  dispatchPointerMove(wrapper, targetPoint)
  dispatchPointerUp(wrapper, targetPoint)
  finishPendingAnimation()

  assert.deepEqual(heap.children, before)
  assert.equal(wrapper.emitted('group-reorder'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('beforeGroupReorder can block group item reordering', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const calls = []
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      beforeGroupReorder(payload) {
        calls.push(payload)
        return false
      },
    },
  })
  const heap = graph.nodes.get('heap-1')
  const before = heap.children.slice()

  const firstItemPoint = firstItemCenter(group)
  const targetPoint = { x: firstItemPoint.x, y: firstItemPoint.y + 2 * (GROUP.itemH + GROUP.itemGap) }

  dispatchPointerDown(wrapper, firstItemPoint)
  dispatchPointerMove(wrapper, targetPoint)
  dispatchPointerUp(wrapper, targetPoint)
  finishPendingAnimation()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].parentId, 'heap-1')
  assert.equal(calls[0].childId, 'cluster-1')
  assert.deepEqual(heap.children, before)
  assert.equal(wrapper.emitted('group-reorder'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('dragging near the bottom edge of an overflowing group auto-scrolls it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  assert.equal(group.overflowY, true)
  const wrapper = mount(Minimap, { propsData: { graph } })
  const ctx = contexts.at(-1)

  const firstItemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, firstItemPoint)
  const bottomEdge = { x: firstItemPoint.x, y: group.y + group.height - 1 }
  dispatchPointerMove(wrapper, bottomEdge)

  for (let i = 0; i < 20; i++) frames.runNext(i * 16)

  const labelsAfter = callsSinceLastClear(ctx)
    .filter((c) => c.method === 'fillText')
    .map((c) => c.args[0])
  assert.equal(labelsAfter.includes('cluster-8'), true)
  assert.equal(labelsAfter.includes('cluster-2'), false)
  wrapper.destroy()
})

test('auto-scroll restarts when the pointer returns to an edge after leaving it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const ctx = contexts.at(-1)

  const firstItemPoint = firstItemCenter(group)
  const middle = { x: firstItemPoint.x, y: group.y + group.height / 2 }
  const bottomEdge = { x: firstItemPoint.x, y: group.y + group.height - 1 }

  dispatchPointerDown(wrapper, firstItemPoint)
  dispatchPointerMove(wrapper, middle)
  for (let i = 0; i < 12; i++) frames.runNext(i * 16)

  dispatchPointerMove(wrapper, bottomEdge)
  for (let i = 0; i < 20; i++) frames.runNext(200 + i * 16)

  const labelsAfter = callsSinceLastClear(ctx)
    .filter((c) => c.method === 'fillText')
    .map((c) => c.args[0])
  assert.equal(labelsAfter.includes('cluster-8'), true)
  assert.equal(labelsAfter.includes('cluster-2'), false)
  wrapper.destroy()
})

test('releasing after auto-scroll reorders using the scrolled insertion index', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const heap = graph.nodes.get('heap-1')

  const firstItemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, firstItemPoint)
  const bottomEdge = { x: firstItemPoint.x, y: group.y + group.height - 1 }
  dispatchPointerMove(wrapper, bottomEdge)

  for (let i = 0; i < 20; i++) frames.runNext(i * 16)
  dispatchPointerUp(wrapper, bottomEdge)
  finishPendingAnimation()

  assert.equal(heap.children[14], 'cluster-1')
  assert.equal(wrapper.emitted('group-reorder')[0][0].index, 14)
  wrapper.destroy()
})

test('pointercancel cancels an active group drag without selecting or reordering', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const heap = graph.nodes.get('heap-1')
  const childrenBefore = [...heap.children]
  const cancelledBefore = frames.cancelled.length

  const firstItemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, firstItemPoint)
  const bottomEdge = { x: firstItemPoint.x, y: group.y + group.height - 1 }
  dispatchPointerMove(wrapper, bottomEdge)
  dispatchPointerCancel(wrapper, bottomEdge)
  dispatchPointerUp(wrapper, bottomEdge)

  assert.deepEqual(heap.children, childrenBefore)
  assert.equal(wrapper.emitted('select'), undefined)
  assert.equal(wrapper.emitted('group-reorder'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  assert.ok(frames.cancelled.length > cancelledBefore)
  wrapper.destroy()
})

test('lost pointer capture cancels an active group drag without selecting or reordering', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const heap = graph.nodes.get('heap-1')
  const childrenBefore = [...heap.children]

  const firstItemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, firstItemPoint)
  const bottomEdge = { x: firstItemPoint.x, y: group.y + group.height - 1 }
  dispatchPointerMove(wrapper, bottomEdge)
  dispatchLostPointerCapture(wrapper)
  dispatchPointerUp(wrapper, bottomEdge)

  assert.deepEqual(heap.children, childrenBefore)
  assert.equal(wrapper.emitted('select'), undefined)
  assert.equal(wrapper.emitted('group-reorder'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('scrolling the wheel inside an overflowing group shifts the visible window and emits group-state-change', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const ctx = contexts.at(-1)

  const insidePoint = { x: group.x + group.width / 2, y: group.y + group.height / 2 }
  dispatchWheel(wrapper, insidePoint, 200)

  const labels = callsSinceLastClear(ctx)
    .filter((c) => c.method === 'fillText')
    .map((c) => c.args[0])
  assert.equal(labels.includes('cluster-1'), false)

  const stateChange = wrapper.emitted('group-state-change')
  assert.ok(stateChange.length > 0)
  assert.equal(stateChange.at(-1)[0][group.id].scrollTop, 200)
  wrapper.destroy()
})

test('dragging the scrollbar thumb scrolls an overflowing group', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const start = scrollbarThumbCenter(group)
  const end = scrollbarThumbCenterAtBottom(group)
  dispatchPointerDown(wrapper, start)
  dispatchPointerMove(wrapper, end)
  dispatchPointerUp(wrapper, end)

  const maxScroll = group.contentHeight - group.height
  const stateChange = wrapper.emitted('group-state-change')
  assert.equal(wrapper.emitted('select'), undefined)
  assert.ok(Math.abs(stateChange.at(-1)[0][group.id].scrollTop - maxScroll) < 0.000001)
  wrapper.destroy()
})

test('controlled groupStates does not internally persist wheel scrolling', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, {
    propsData: { graph, groupStates: { [group.id]: { scrollTop: 0 } } },
  })
  const ctx = contexts.at(-1)

  const insidePoint = { x: group.x + group.width / 2, y: group.y + group.height / 2 }
  dispatchWheel(wrapper, insidePoint, 200)

  const labels = callsSinceLastClear(ctx)
    .filter((c) => c.method === 'fillText')
    .map((c) => c.args[0])
  assert.ok(labels.includes('cluster-1'))
  assert.equal(wrapper.emitted('group-state-change').at(-1)[0][group.id].scrollTop, 200)
  wrapper.destroy()
})

test('wheel at a scroll boundary does not offset content', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const ctx = contexts.at(-1)

  const insidePoint = { x: group.x + group.width / 2, y: group.y + group.height / 2 }
  dispatchWheel(wrapper, insidePoint, -200)

  const labels = callsSinceLastClear(ctx).filter((c) => c.method === 'fillText')
  const first = labels.find((c) => c.args[0] === 'cluster-1')
  assert.equal(first.args[2], group.y + GROUP.header + GROUP.padding + GROUP.itemH / 2)
  assert.equal(frames.scheduled.some((frame) => !frame.ran && !frame.cancelled), false)
  wrapper.destroy()
})

test('pointercancel during scrollbar drag at a boundary does not leave content offset', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const ctx = contexts.at(-1)

  const start = scrollbarThumbCenter(group)
  const aboveTop = { x: start.x, y: start.y - 200 }
  dispatchPointerDown(wrapper, start)
  dispatchPointerMove(wrapper, aboveTop)
  dispatchPointerCancel(wrapper, aboveTop)

  const labelsAfterCancel = callsSinceLastClear(ctx).filter((c) => c.method === 'fillText')
  const firstAfterCancel = labelsAfterCancel.find((c) => c.args[0] === 'cluster-1')
  assert.equal(firstAfterCancel.args[2], group.y + GROUP.header + GROUP.padding + GROUP.itemH / 2)
  wrapper.destroy()
})

test('hovering over the scrollbar thumb redraws it with the hover color', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const ctx = contexts.at(-1)

  dispatchPointerMove(wrapper, scrollbarThumbCenter(group))

  assert.ok(
    callsSinceLastClear(ctx).some(
      (call) => call.method === 'set:fillStyle' && call.args[0] === defaultTheme.group.scrollbar.thumbHover,
    ),
  )
  wrapper.destroy()
})

test('controlled groupStates resets scrollbar drag changes on pointercancel', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, {
    propsData: { graph, groupStates: { [group.id]: { scrollTop: 0 } } },
  })
  const ctx = contexts.at(-1)

  const start = scrollbarThumbCenter(group)
  const end = scrollbarThumbCenterAtBottom(group)
  dispatchPointerDown(wrapper, start)
  dispatchPointerMove(wrapper, end)
  dispatchPointerCancel(wrapper, end)

  const labels = callsSinceLastClear(ctx)
    .filter((c) => c.method === 'fillText')
    .map((c) => c.args[0])
  assert.ok(labels.includes('cluster-1'))
  assert.equal(wrapper.emitted('group-state-change'), undefined)
  wrapper.destroy()
})

test('uncontrolled scrollbar drag cancel restores scroll and clears hover', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const ctx = contexts.at(-1)

  const start = scrollbarThumbCenter(group)
  const middle = { x: start.x, y: start.y + 48 }
  dispatchPointerDown(wrapper, start)
  dispatchPointerMove(wrapper, middle)
  dispatchPointerCancel(wrapper, middle)

  const calls = callsSinceLastClear(ctx)
  const labels = calls.filter((c) => c.method === 'fillText').map((c) => c.args[0])
  assert.ok(labels.includes('cluster-1'))
  assert.equal(calls.some((call) => call.method === 'set:fillStyle' && call.args[0] === '#7f95ad'), false)
  assert.equal(wrapper.emitted('group-state-change'), undefined)
  wrapper.destroy()
})

test('groupStates prop puts the component in controlled mode', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, {
    propsData: { graph, groupStates: { [group.id]: { expanded: false } } },
  })

  const headerPoint = { x: group.x + group.width / 2, y: group.y + GROUP.header / 2 }
  dispatchPointerDown(wrapper, headerPoint)
  assert.deepEqual(wrapper.emitted('group-state-change')[0][0], { [group.id]: { expanded: true } })

  // Controlled mode: if the prop is unchanged, the component must not persist expanded=true internally.
  dispatchPointerDown(wrapper, headerPoint)
  assert.deepEqual(wrapper.emitted('group-state-change')[1][0], { [group.id]: { expanded: true } })
  wrapper.destroy()
})

test('options.groupThreshold is passed through to the layout engine', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, options: { groupThreshold: 2 } } })
  const ctx = contexts.at(-1)

  const labels = ctx.methodsOf('fillText').map((c) => c.args[0])
  const headerLabel = labels.find((l) => typeof l === 'string' && l.includes('Grid Tie'))
  assert.ok(headerLabel)
  wrapper.destroy()
})

test('dropping a resource onto a selected child inside a group splits it out of the group', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const itemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, itemPoint)
  dispatchPointerUp(wrapper, itemPoint)
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['cluster-1'])

  dispatchDrop(wrapper, { id: 'sensor', label: 'Sensor' }, itemPoint)
  finishPendingAnimation()

  const clusterOne = graph.nodes.get('cluster-1')
  assert.equal(clusterOne.children.length, 1)

  const nextLayout = computeLayout(graph, LAYOUT_OPTS)
  const stillInAGroup = nextLayout.groups.some((g) => g.children.includes('cluster-1'))
  assert.equal(stillInAGroup, false)
  wrapper.destroy()
})
