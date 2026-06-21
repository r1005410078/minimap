import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { computeLayout, GROUP } from '../src/minimap/graph/layout.js'
import { defaultTheme } from '../src/minimap/render/theme.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mountMinimap } = await import('./helpers/mount-minimap.js')

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

function clientPoint(point, offset = { left: 0, top: 0 }) {
  return { x: point.x + offset.left, y: point.y + offset.top }
}

function firstItemCenter(group) {
  return {
    x: group.x + GROUP.padding + GROUP.itemW / 2,
    y: group.y + GROUP.header + GROUP.padding + GROUP.itemH / 2,
  }
}

function itemCenterAt(group, index) {
  const rowHeight = GROUP.itemH + GROUP.itemGap
  const colWidth = GROUP.itemW + GROUP.itemGap
  const columns = Math.max(1, group.columns)
  const row = Math.floor(index / columns)
  const col = index % columns
  return {
    x: group.x + GROUP.padding + col * colWidth + GROUP.itemW / 2,
    y: group.y + GROUP.header + GROUP.padding + row * rowHeight - (group.scrollTop ?? 0) + GROUP.itemH / 2,
  }
}

function nodePoint(layout, nodeId, offset = {}) {
  const rect = layout.nodes.get(nodeId)
  return {
    x: rect.x + (offset.x ?? rect.width / 2),
    y: rect.y + (offset.y ?? rect.height / 2),
  }
}

test('dragging a plain node onto a non-sibling plain node makes it the new parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'cluster-25')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(graph.nodes.get('cluster-25').children.includes('feeder-1'), true)
  assert.equal(wrapper.emitted('node-move').length, 1)
  assert.equal(wrapper.emitted('node-move')[0][0].nodeId, 'feeder-1')
  assert.equal(wrapper.emitted('node-move')[0][0].fromParentId, 'grid-tie')
  assert.equal(wrapper.emitted('node-move')[0][0].toParentId, 'cluster-25')
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'move-node')

  wrapper.vm.undo()
  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  wrapper.destroy()
})

test('dragging a node onto the leading edge of a non-sibling inserts it as that node\'s sibling', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodePoint(layout, 'cluster-25', { y: 2 })

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'energy-root')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(graph.nodes.get('cluster-25').children.includes('feeder-1'), false)
  assert.ok(
    graph.nodes.get('energy-root').children.indexOf('feeder-1')
      < graph.nodes.get('energy-root').children.indexOf('cluster-25'),
  )
  assert.equal(wrapper.emitted('node-move').length, 1)
  assert.equal(wrapper.emitted('node-move')[0][0].toParentId, 'energy-root')
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'move-node')

  wrapper.destroy()
})

test('multi-selected nodes drag together and the ghost shows the selected count', async () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  wrapper.vm.select(['feeder-1', 'feeder-2', 'feeder-3'])
  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  await wrapper.vm.$nextTick()

  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'fillText' && call.args[0] === '3'))

  dispatchPointerUp(wrapper, to)

  for (const id of ['feeder-1', 'feeder-2', 'feeder-3']) {
    assert.equal(graph.nodes.get(id).parentId, 'cluster-25')
  }
  assert.equal(wrapper.emitted('node-move').length, 1)
  assert.deepEqual(wrapper.emitted('node-move')[0][0].nodeIds, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'move-nodes')

  wrapper.destroy()
})

test('dragging a sibling onto the upper half of another sibling inserts before it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-3')
  const to = nodePoint(layout, 'feeder-2', { y: 2 })

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-3').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-1', 'feeder-3', 'feeder-2'])
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('node-move'), undefined)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'reorder-group-child')
  wrapper.destroy()
})

test('dragging a sibling onto the lower half of another sibling inserts after it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const feeder2 = layout.nodes.get('feeder-2')
  const to = nodePoint(layout, 'feeder-2', { y: feeder2.height - 2 })

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-1', 'feeder-3'])
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('node-move'), undefined)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'reorder-group-child')
  wrapper.destroy()
})

test('vertical layout sibling reorder uses left and right halves of the target node', () => {
  const graph = createDemoGraph()
  const verticalOpts = { ...LAYOUT_OPTS, direction: 'vertical' }
  const layout = computeLayout(graph, verticalOpts)
  const wrapper = mountMinimap( { propsData: { graph, layoutDirection: 'vertical' } })

  const from = nodeCenter(layout, 'feeder-1')
  const feeder2 = layout.nodes.get('feeder-2')
  const to = nodePoint(layout, 'feeder-2', { x: feeder2.width - 2 })

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-1', 'feeder-3'])
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('node-move'), undefined)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'reorder-group-child')
  wrapper.destroy()
})

test('dragging a node into a different group than its origin moves it under that group real parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const targetGroup = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mountMinimap( { propsData: { graph } })

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
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'grid-tie')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)
  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), true)

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
  const wrapper = mountMinimap( { propsData: { graph } })

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
  const readonlyWrapper = mountMinimap( { propsData: { graph, readonly: true } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(readonlyWrapper, from)
  dispatchPointerMove(readonlyWrapper, to)
  dispatchPointerUp(readonlyWrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  readonlyWrapper.destroy()

  const blockedGraph = createDemoGraph()
  const blockedWrapper = mountMinimap( {
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

test('blocked cross-parent moves clear the plain-node drop target highlight', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( {
    propsData: { graph, beforeNodeMove: () => false },
  })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  assert.equal(highlightedLabels(contexts.at(-1), defaultTheme).includes('Feeder 2'), false)
  wrapper.destroy()
})

test('clicking a plain node without moving still selects it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const point = nodeCenter(layout, 'feeder-1')
  dispatchPointerDown(wrapper, point)
  dispatchPointerUp(wrapper, point)

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])
  assert.equal(wrapper.emitted('node-move'), undefined)
  wrapper.destroy()
})

// Helper to check if a node is rendered with highlighted stroke style
function highlightedLabels(ctx, theme) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  const labels = []
  calls.forEach((call, i) => {
    if (call.method !== 'fillText') return
    for (let j = i - 1; j >= 0; j--) {
      if (calls[j].method === 'set:strokeStyle') {
        if (calls[j].args[0] === theme.group.header) labels.push(call.args[0])
        break
      }
    }
  })
  return labels
}

// Helper to check if an insert-preview drop-slot box was drawn in the current frame
function dropSlotDrawn(ctx, theme) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  return calls.some((call) => call.method === 'set:fillStyle' && call.args[0] === theme.group.dropSlot.fill)
}

// Helper to check if an attach-preview connector line was drawn in the current frame.
// 连接线用 moveTo/lineTo 画路径，drawDropSlot 的方框边框走 roundedRect（测试环境里
// 走 ctx.roundRect，不会产生 moveTo 调用），两者不会混淆。
function attachLineDrawn(ctx, theme) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  return calls.some((call, i) => {
    if (call.method !== 'moveTo') return false
    for (let j = i - 1; j >= 0; j--) {
      if (calls[j].method === 'set:strokeStyle') return calls[j].args[0] === theme.group.dropSlot.stroke
    }
    return false
  })
}

test('plain node drop target shows an attach preview and can be dropped on', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  // Start drag on feeder-1
  dispatchPointerDown(wrapper, from)
  // Hover over a non-sibling plain node WITHOUT releasing yet - this should show an
  // attach preview (box + connector line), not a whole-node highlight
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)
  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), true)
  assert.deepEqual(highlightedLabels(contexts.at(-1), defaultTheme), [])

  // Complete the drag by releasing
  dispatchPointerUp(wrapper, to)

  // Verify the drop succeeded - feeder-1 should now be a child of cluster-25
  assert.equal(graph.nodes.get('feeder-1').parentId, 'cluster-25',
    'feeder-1 should have been moved to be a child of cluster-25')

  wrapper.destroy()
})

test('dragging an already-selected node shows the live attach preview, not the stale selection relation', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  // feeder-1 is selected before the drag starts (e.g. from an earlier click), so
  // buildSelectionRelations would normally highlight its parent (grid-tie) and dim
  // everything else - that must not fight with the live drag-target attach preview.
  wrapper.vm.select(['feeder-1'])

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)
  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), true)
  assert.deepEqual(
    highlightedLabels(contexts.at(-1), defaultTheme),
    [],
    'no node should show the stale selection-relation highlight while dragging',
  )

  dispatchPointerUp(wrapper, to)
  wrapper.destroy()
})

test('dragging near the canvas edge pans the viewport', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, { x: 795, y: 300 })

  // handlePointerMove schedules both the existing auto-scroll/slot-fade RAF loop
  // and the new edge-pan RAF loop on this first move past the drag threshold;
  // drain several frames so the edge-pan tick (whichever order it lands in) runs.
  for (let i = 0; i < 5; i++) frames.runNext(16 * (i + 1))

  assert.equal(wrapper.emitted('viewport-change').length > 0, true)
  const lastViewport = wrapper.emitted('viewport-change').at(-1)[0]
  assert.notEqual(lastViewport.x, 0)

  dispatchPointerUp(wrapper, { x: 795, y: 300 })
  wrapper.destroy()
})

test('dragging near an offset canvas edge uses canvas-local coordinates for edge pan', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })
  const canvasEl = wrapper.find('canvas').element
  const offset = { left: 360, top: 24 }
  canvasEl.getBoundingClientRect = () => ({
    left: offset.left,
    top: offset.top,
    right: offset.left + 800,
    bottom: offset.top + 600,
    width: 800,
    height: 600,
  })

  const from = clientPoint(nodeCenter(layout, 'feeder-1'), offset)
  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, clientPoint({ x: 10, y: 300 }, offset))

  for (let i = 0; i < 5; i++) frames.runNext(16 * (i + 1))

  assert.equal(wrapper.emitted('viewport-change').length > 0, true)
  const lastViewport = wrapper.emitted('viewport-change').at(-1)[0]
  assert.notEqual(lastViewport.x, 0)

  dispatchPointerUp(wrapper, clientPoint({ x: 10, y: 300 }, offset))
  wrapper.destroy()
})

test('dragging a sibling into the gap between two other siblings shows an insert preview and inserts it between them', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const feeder2 = layout.nodes.get('feeder-2')
  const feeder3 = layout.nodes.get('feeder-3')
  const to = { x: feeder2.x + feeder2.width / 2, y: (feeder2.y + feeder2.height + feeder3.y) / 2 }

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)

  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-1', 'feeder-3'])
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('node-move'), undefined)
  wrapper.destroy()
})

test('dragging a sibling onto the leading edge of the first remaining sibling inserts before it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-2')
  const to = nodePoint(layout, 'feeder-1', { y: 2 })

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-2').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-1', 'feeder-3'])
  wrapper.destroy()
})

test('dragging a sibling onto the trailing edge of the last remaining sibling inserts after it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-2')
  const feeder3 = layout.nodes.get('feeder-3')
  const to = nodePoint(layout, 'feeder-3', { y: feeder3.height - 2 })

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-2').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-1', 'feeder-3', 'feeder-2'])
  wrapper.destroy()
})

test('dragging a sibling onto the middle of another sibling shows an attach preview, not a highlight', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)
  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), true)
  assert.deepEqual(highlightedLabels(contexts.at(-1), defaultTheme), [])

  dispatchPointerUp(wrapper, to)

  // The drop should succeed, making feeder-1 a child of feeder-2
  assert.equal(graph.nodes.get('feeder-1').parentId, 'feeder-2')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(graph.nodes.get('feeder-2').children.includes('feeder-1'), true)
  wrapper.destroy()
})

test('dragging a node within a group does not draw an attach preview connector line', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const targetGroup = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mountMinimap( { propsData: { graph } })

  const from = itemCenterAt(targetGroup, 0)
  const to = itemCenterAt(targetGroup, 1)

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), false)

  dispatchPointerUp(wrapper, to)
  wrapper.destroy()
})
