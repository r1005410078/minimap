import test from 'node:test'
import assert from 'node:assert/strict'
import { stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { computeLayout } from '../src/minimap/graph/layout.js'
import { scrollbarMetrics } from '../src/minimap/interaction/interaction.js'
import { createGraphOperationManager } from '../src/minimap/graph/graph-operations.js'
import { createDragController } from '../src/minimap/controllers/drag-controller.js'

const raf = stubAnimationFrame()

function demoLayout() {
  return computeLayout(createDemoGraph(), { viewportWidth: 1200, viewportHeight: 760 })
}

function createDeps(graph, layout, overrides = {}) {
  const calls = {
    renderCurrent: 0,
    scheduleRender: [],
    flushScheduledRender: 0,
    cancelScheduledRender: 0,
    settleAnimation: 0,
    scrollGroup: [],
    setGroupExpanded: [],
    zoomAt: [],
    applyViewport: [],
    updateLayout: [],
    closeContextMenu: 0,
    emitNodeDrop: [],
    emitGroupReorder: [],
    emitNodeMove: [],
    change: [],
  }
  let selectedIds = []
  let viewport = { x: 0, y: 0, scale: 1 }
  const operationManager = createGraphOperationManager(graph)
  const canvasEl = {
    focusCalls: 0,
    captured: [],
    focus() { this.focusCalls += 1 },
    setPointerCapture(id) { this.captured.push(id) },
  }
  const deps = {
    getGraph: () => graph,
    getLayoutDirection: () => 'horizontal',
    getOptions: () => ({}),
    getGroupStatesProp: () => null,
    getBeforeNodeDrop: () => null,
    getBeforeGroupReorder: () => null,
    getBeforeNodeMove: () => null,
    getLayout: () => layout,
    getViewport: () => viewport,
    applyViewport: (next, opts) => { calls.applyViewport.push({ next, opts }); viewport = next; return true },
    updateLayout: (opts) => calls.updateLayout.push(opts),
    getCssSize: () => ({ width: 1200, height: 760 }),
    screenPointFromClient: (x, y) => ({ x, y }),
    pointFromClient: (x, y) => ({ x, y }),
    renderCurrent: () => { calls.renderCurrent += 1 },
    scheduleRender: (reason) => calls.scheduleRender.push(reason),
    flushScheduledRender: () => { calls.flushScheduledRender += 1 },
    cancelScheduledRender: () => { calls.cancelScheduledRender += 1 },
    settleAnimation: () => { calls.settleAnimation += 1 },
    scrollGroup: (group, scrollTop) => calls.scrollGroup.push({ groupId: group.id, scrollTop }),
    setGroupExpanded: (id, expanded) => calls.setGroupExpanded.push({ id, expanded }),
    zoomAt: (screenPoint, deltaY) => calls.zoomAt.push({ screenPoint, deltaY }),
    getCanvasEl: () => canvasEl,
    getSelectedIds: () => selectedIds,
    setSelected: (ids) => { selectedIds = ids },
    applyOperation: (operation, opts) => operationManager.apply(operation, { readonly: false, before: opts?.before }),
    emitChangeIfApplied: (result) => { if (result.applied) calls.change.push(result) },
    closeContextMenu: () => { calls.closeContextMenu += 1 },
    emitNodeDrop: (payload) => calls.emitNodeDrop.push(payload),
    emitGroupReorder: (payload) => calls.emitGroupReorder.push(payload),
    emitNodeMove: (payload) => calls.emitNodeMove.push(payload),
    ...overrides,
  }
  return { deps, calls, canvasEl }
}

function downEvent(point, extra = {}) {
  return { clientX: point.x, clientY: point.y, button: 0, pointerId: 1, ...extra }
}

function moveEvent(point, extra = {}) {
  return { clientX: point.x, clientY: point.y, ...extra }
}

test('clicking a node without moving selects it instead of starting a drag', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const point = { x: 460, y: 20 } // feeder-1 center

  drag.onPointerDown(downEvent(point))
  drag.onPointerUp(downEvent(point))

  assert.deepEqual(deps.getSelectedIds(), ['feeder-1'])
})

test('dragging a sibling into the gap between two other siblings reorders it within the same parent', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const from = { x: 460, y: 20 } // feeder-1 center
  const gap = { x: 460, y: 116 } // between feeder-2 (64-104) and feeder-3 (128-168)

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent(gap))
  drag.onPointerUp(moveEvent(gap))

  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-1', 'feeder-3'])
  assert.equal(calls.emitGroupReorder.length, 1)
  assert.deepEqual(calls.emitGroupReorder[0], { groupId: null, childId: 'feeder-1', index: 1 })
  assert.equal(calls.change.length, 1)
  assert.deepEqual(calls.updateLayout, [undefined])
})

test('dragging a node onto a node in a different subtree moves it as a new child appended at the end', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const from = { x: 460, y: 20 } // feeder-1
  const to = { x: 60, y: 351 } // energy-root, an ancestor's sibling subtree

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent(to))
  drag.onPointerUp(moveEvent(to))

  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.deepEqual(graph.nodes.get('energy-root').children, ['grid-tie', 'heap-1', 'cluster-25', 'feeder-1'])
  assert.equal(calls.emitNodeMove.length, 1)
  assert.deepEqual(calls.emitNodeMove[0], { nodeId: 'feeder-1', fromParentId: 'grid-tie', toParentId: 'energy-root', index: 3 })
  assert.equal(calls.change.length, 1)
})

test('readonly blocks a cross-parent move and leaves the graph untouched, but still re-renders', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const operationManager = createGraphOperationManager(graph)
  const { deps, calls } = createDeps(graph, layout, {
    applyOperation: (operation, opts) => operationManager.apply(operation, { readonly: true, before: opts?.before }),
  })
  const drag = createDragController(deps)
  const from = { x: 460, y: 20 }
  const to = { x: 60, y: 351 }

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent(to))
  drag.onPointerUp(moveEvent(to))

  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.equal(calls.emitNodeMove.length, 0)
  assert.equal(calls.renderCurrent, 2) // one from the move, one from the blocked drop re-render
})

test('dragging a node onto its own descendant does not move it', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const from = { x: 260, y: 84 } // grid-tie center
  const to = { x: 460, y: 20 } // feeder-1, grid-tie's own child

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent(to))
  drag.onPointerUp(moveEvent(to))

  assert.deepEqual(graph.nodes.get('energy-root').children, ['grid-tie', 'heap-1', 'cluster-25'])
  assert.equal(calls.emitNodeMove.length, 0)
  assert.equal(calls.emitGroupReorder.length, 0)
})

test('dragging a group scrollbar thumb updates scrollTop live and commits on release', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const group = layout.groups.find((g) => g.id === 'heap-1::g0')
  const metrics = scrollbarMetrics(group)
  const thumbPoint = { x: metrics.trackX + 1, y: metrics.thumbY + metrics.thumbHeight / 2 }

  drag.onPointerDown(downEvent(thumbPoint))
  drag.onPointerMove(moveEvent({ x: thumbPoint.x, y: thumbPoint.y + 50 }))
  drag.onPointerUp(moveEvent({ x: thumbPoint.x, y: thumbPoint.y + 50 }))

  assert.ok(group.scrollTop > 0)
  assert.deepEqual(calls.scrollGroup, [{ groupId: 'heap-1::g0', scrollTop: group.scrollTop }])
})

test('cancelPointerInteractions rolls back an in-progress uncontrolled scrollbar drag', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const group = layout.groups.find((g) => g.id === 'heap-1::g0')
  const metrics = scrollbarMetrics(group)
  const thumbPoint = { x: metrics.trackX + 1, y: metrics.thumbY + metrics.thumbHeight / 2 }
  const startScrollTop = group.scrollTop

  drag.onPointerDown(downEvent(thumbPoint))
  drag.onPointerMove(moveEvent({ x: thumbPoint.x, y: thumbPoint.y + 50 }))
  assert.notEqual(group.scrollTop, startScrollTop)

  drag.cancelPointerInteractions()

  assert.equal(group.scrollTop, startScrollTop)
})

test('Ctrl/Cmd-drag on blank canvas marquee-selects the nodes inside the rect on release', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const start = { x: 380, y: -10 }
  const end = { x: 540, y: 170 } // covers feeder-1/2/3, nothing else

  drag.onPointerDown(downEvent(start, { metaKey: true }))
  drag.onPointerMove(moveEvent(end, { metaKey: true }))
  drag.onPointerUp(moveEvent(end, { metaKey: true }))

  assert.deepEqual(deps.getSelectedIds().sort(), ['feeder-1', 'feeder-2', 'feeder-3'])
})

test('blank canvas pan applies the total displacement from the pointer-down viewport, not cumulative per-frame deltas', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const start = { x: 950, y: 700 } // blank area to the right of cluster-25 at 1200px viewport width

  drag.onPointerDown(downEvent(start))
  drag.onPointerMove(moveEvent({ x: start.x - 20, y: start.y - 10 }))
  drag.onPointerMove(moveEvent({ x: start.x - 50, y: start.y - 30 }))

  assert.deepEqual(calls.applyViewport.at(-1).next, { x: -50, y: -30, scale: 1 })
})

test('wheel over blank canvas zooms via the injected zoomAt, not group scrolling', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)

  drag.onWheel({ clientX: 700, clientY: 700, deltaY: -100, preventDefault: () => {} })

  assert.equal(calls.zoomAt.length, 1)
  assert.deepEqual(calls.zoomAt[0], { screenPoint: { x: 700, y: 700 }, deltaY: -100 })
  assert.equal(calls.scrollGroup.length, 0)
  assert.equal(calls.settleAnimation, 1)
  assert.equal(calls.closeContextMenu, 1)
})

test('wheel over a scrollable group scrolls it instead of zooming', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const group = layout.groups.find((g) => g.id === 'heap-1::g0') // x:400..934, y:192..511.2, header ends at 220

  drag.onWheel({ clientX: 410, clientY: 300, deltaY: 50, preventDefault: () => {} })

  assert.deepEqual(calls.scrollGroup, [{ groupId: group.id, scrollTop: 50 }])
  assert.equal(calls.zoomAt.length, 0)
})

test('wheel is ignored while a pan, node drag, or scrollbar drag is in progress', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  drag.onPointerDown(downEvent({ x: 950, y: 700 })) // starts a blank pan

  drag.onWheel({ clientX: 700, clientY: 700, deltaY: -100, preventDefault: () => {} })

  assert.equal(calls.zoomAt.length, 0)
  assert.equal(calls.scrollGroup.length, 0)
})

test('dropping a resource over a node appends it as that node\'s last child via drop-node', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const event = {
    preventDefault: () => {},
    clientX: 260,
    clientY: 84, // grid-tie center
    dataTransfer: { getData: () => JSON.stringify({ id: 'sensor', label: 'Sensor' }) },
  }

  drag.onDrop(event)

  const gridTie = graph.nodes.get('grid-tie')
  assert.equal(gridTie.children.length, 4)
  const newId = gridTie.children[3]
  assert.equal(graph.nodes.get(newId).label, 'Sensor')
  assert.equal(calls.emitNodeDrop.length, 1)
  assert.equal(calls.emitNodeDrop[0].parentId, 'grid-tie')
  assert.equal(calls.emitNodeDrop[0].index, 3)
  assert.equal(calls.change.length, 1)
})

test('beforeNodeDrop returning false blocks the drop and leaves the graph untouched', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout, { getBeforeNodeDrop: () => () => false })
  const drag = createDragController(deps)
  const event = {
    preventDefault: () => {},
    clientX: 260,
    clientY: 84,
    dataTransfer: { getData: () => JSON.stringify({ id: 'sensor', label: 'Sensor' }) },
  }

  drag.onDrop(event)

  assert.equal(graph.nodes.get('grid-tie').children.length, 3)
  assert.equal(calls.emitNodeDrop.length, 0)
})

test('cancelPointerInteractions clears an in-progress pan/marquee and cancels scheduled rendering', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  drag.onPointerDown(downEvent({ x: 950, y: 700 }))
  drag.onPointerMove(moveEvent({ x: 900, y: 650 }))

  drag.cancelPointerInteractions()

  assert.equal(calls.cancelScheduledRender, 1)
  const viewportCallsBefore = calls.applyViewport.length
  drag.onPointerUp(moveEvent({ x: 900, y: 650 }))
  assert.equal(calls.applyViewport.length, viewportCallsBefore) // pointerup after cancel is a no-op, not a completed pan
})

test('dragging near the canvas edge starts an edge-pan rAF loop that pans the viewport on each tick, and cancelPointerInteractions stops it', () => {
  const { scheduled } = raf
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps, calls } = createDeps(graph, layout)
  const drag = createDragController(deps)
  const from = { x: 460, y: 20 } // feeder-1

  drag.onPointerDown(downEvent(from))
  drag.onPointerMove(moveEvent({ x: 1195, y: 300 })) // inside the 24px edge zone on the right
  // slot-fade auto-scroll and edge-pan both schedule rAF on the first drag move; drain until edge-pan runs
  for (let i = 0; i < 5 && calls.applyViewport.length === 0; i++) {
    assert.ok(raf.runNext(16 * (i + 1)), 'expected an edge-pan rAF frame to be scheduled')
  }

  assert.equal(calls.applyViewport.length, 1)
  assert.ok(calls.applyViewport[0].next.x < 0)

  drag.cancelPointerInteractions()

  assert.equal(scheduled.some((frame) => !frame.cancelled && !frame.ran), false)
})

test('getInteractionRenderState reflects an in-progress marquee selection rect', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  drag.onPointerDown(downEvent({ x: 950, y: 700 }, { metaKey: true }))
  drag.onPointerMove(moveEvent({ x: 1000, y: 740 }, { metaKey: true }))

  const state = drag.getInteractionRenderState()

  assert.equal(state.dragging, false)
  assert.equal(state.interacting, true)
  assert.deepEqual(state.selectionRect, { x: 950, y: 700, width: 50, height: 40 })
})

test('getInteractionRenderState reports dragging true with a groupDrag descriptor while a plain-sibling drag is in progress', () => {
  const graph = createDemoGraph()
  const layout = demoLayout()
  const { deps } = createDeps(graph, layout)
  const drag = createDragController(deps)
  drag.onPointerDown(downEvent({ x: 460, y: 20 })) // feeder-1
  drag.onPointerMove(moveEvent({ x: 460, y: 116 })) // gap between feeder-2/3, no real group involved

  const state = drag.getInteractionRenderState()

  assert.equal(state.dragging, true)
  assert.equal(state.groupDrag.groupId, null)
  assert.equal(state.groupDrag.draggingChildId, 'feeder-1')
})
