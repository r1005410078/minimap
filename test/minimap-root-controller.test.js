import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { computeLayout } from '../src/minimap/graph/layout.js'
import { createMinimapController } from '../src/minimap/controllers/minimap-controller.js'
import { defaultTheme } from '../src/minimap/render/theme.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()
stubAnimationFrame()

const LAYOUT_OPTS = { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 }

function createElements() {
  const canvas = document.createElement('canvas')
  const container = document.createElement('div')
  container.appendChild(canvas)
  return { canvas, container }
}

function nodeCenter(layout, nodeId) {
  const rect = layout.nodes.get(nodeId)
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function createDeps(overrides = {}) {
  // 缓存单个 graph 实例并始终返回同一个引用——跟真实 Vue 用法里 props.graph 是同一个稳定
  // 引用的语义一致。
  const graph = createDemoGraph()
  return {
    getGraph: () => graph,
    getLayoutDirection: () => 'horizontal',
    getOptions: () => ({ disableInitialCenter: true }),
    getTheme: () => defaultTheme,
    getRenderers: () => ({}),
    getViewportProp: () => null,
    getGroupStatesProp: () => null,
    getSelectedIdsProp: () => null,
    emitSelect: () => {},
    getReadonly: () => false,
    getBeforeDelete: () => null,
    getBeforeCopy: () => null,
    getBeforeImport: () => null,
    getBeforePaste: () => null,
    getBeforeNodeDrop: () => null,
    getBeforeGroupReorder: () => null,
    getBeforeNodeMove: () => null,
    emitDelete: () => {},
    emitCopy: () => {},
    emitPaste: () => {},
    emitImport: () => {},
    emitExport: () => {},
    emitChange: () => {},
    emitNodeDrop: () => {},
    emitGroupReorder: () => {},
    emitNodeMove: () => {},
    emitSearch: () => {},
    onSearchStateChange: () => {},
    emitConfigChange: () => {},
    emitContextMenuAction: () => {},
    getContextMenuItemsProp: () => null,
    getMenuEl: () => null,
    onMenuStateChange: () => {},
    emitViewportChange: () => {},
    emitGroupStateChange: () => {},
    onRenderStats: () => {},
    onOverviewRender: () => {},
    ...overrides,
  }
}

test('camera and layout methods forward to the underlying core-controller', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  assert.deepEqual(controller.getViewport(), { x: 0, y: 0, scale: 1 })
  assert.ok(controller.getLayout())
  controller.applyViewport({ x: 1, y: 1, scale: 1 }, { render: false })
  assert.deepEqual(controller.getViewport(), { x: 1, y: 1, scale: 1 })

  controller.destroy()
})

test('selection methods forward to the real selection-controller and core renders use it', () => {
  const selected = []
  const controller = createMinimapController(createDeps({ emitSelect: (ids) => selected.push(ids) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  controller.setSelected(['feeder-1'])

  assert.deepEqual(controller.getSelectedIds(), ['feeder-1'])
  assert.deepEqual(selected, [['feeder-1']])

  controller.destroy()
})

test('edit methods forward to the real edit-controller sharing the same selection-controller', () => {
  const deleted = []
  const controller = createMinimapController(createDeps({ emitDelete: (p) => deleted.push(p) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.setSelected(['feeder-1'])

  const result = controller.deleteSelection()

  assert.equal(result.applied, true)
  assert.equal(deleted.length, 1)
  assert.equal(controller.canUndo(), true)

  controller.undo()
  assert.equal(controller.canUndo(), false)

  controller.destroy()
})

test('onGraphReplaced resets the edit-controller history', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.setSelected(['feeder-1'])
  controller.deleteSelection()
  assert.equal(controller.canUndo(), true)

  controller.onGraphReplaced()

  assert.equal(controller.canUndo(), false)

  controller.destroy()
})

test('applyOperation forwards to the real edit-controller, sharing its undo history with the named edit methods', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const result = controller.applyOperation({
    type: 'reorder-group-child',
    payload: { groupId: null, parentId: 'grid-tie', childId: 'feeder-1', index: 1 },
  })

  assert.equal(result.applied, true)
  assert.equal(controller.canUndo(), true)
  controller.undo()
  assert.equal(controller.canUndo(), false)

  controller.destroy()
})

test('search methods forward to the real search-controller and jump using the real camera composition', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const payload = controller.search('feeder')

  assert.deepEqual(payload.matches, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.deepEqual(controller.getSelectedIds(), ['feeder-1'])

  controller.destroy()
})

test('right-click pointerdown and pointerup dispatch to the context-menu-controller, not through deps', () => {
  const menuStates = []
  const controller = createMinimapController(createDeps({ onMenuStateChange: (state) => menuStates.push(state) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 140,
    button: 2,
    pointerId: 3,
    pointerType: 'mouse',
  }))
  assert.equal(menuStates.at(-1), undefined)

  canvas.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 140,
    button: 2,
    pointerId: 3,
    pointerType: 'mouse',
  }))

  assert.ok(menuStates.at(-1))
  assert.equal(menuStates.at(-1).context.targetType, 'canvas')

  controller.runContextMenuItem({ id: 'fit-to-screen', action: 'fit-to-screen', disabled: false })
  assert.equal(menuStates.at(-1), null)

  controller.destroy()
})

test('contextmenu alone is suppressed and does not open the menu', () => {
  const menuStates = []
  const controller = createMinimapController(createDeps({ onMenuStateChange: (state) => menuStates.push(state) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 140 })
  canvas.dispatchEvent(event)

  assert.equal(menuStates.length, 0)
  assert.equal(event.defaultPrevented, true)

  controller.destroy()
})

test('right-drag on blank canvas marquee-selects nodes and does not open the context menu', () => {
  const menuStates = []
  const deps = createDeps({ onMenuStateChange: (state) => menuStates.push(state) })
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const start = { x: 380, y: -10 }
  const end = { x: 540, y: 170 }

  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    clientX: start.x,
    clientY: start.y,
    button: 2,
    pointerId: 5,
    pointerType: 'mouse',
  }))
  canvas.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    cancelable: true,
    clientX: end.x,
    clientY: end.y,
    pointerId: 5,
    pointerType: 'mouse',
  }))
  canvas.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    clientX: end.x,
    clientY: end.y,
    button: 2,
    pointerId: 5,
    pointerType: 'mouse',
  }))

  assert.deepEqual(controller.getSelectedIds().sort(), ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.equal(menuStates.length, 0)

  controller.destroy()
})

test('pointerdown and pointerup without moving dispatch to the real drag-controller and select the clicked node', () => {
  const deps = createDeps()
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const point = nodeCenter(layout, 'feeder-1')

  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true, cancelable: true }))

  assert.deepEqual(controller.getSelectedIds(), ['feeder-1'])

  controller.destroy()
})

test('pointerdown, pointermove, and pointerup dispatch to the real drag-controller and commit a cross-parent move', () => {
  const calls = { nodeMove: [] }
  const deps = createDeps({ emitNodeMove: (payload) => calls.nodeMove.push(payload) })
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: from.x, clientY: from.y, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: to.x, clientY: to.y, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: to.x, clientY: to.y, pointerId: 1, bubbles: true, cancelable: true }))

  assert.equal(deps.getGraph().nodes.get('feeder-1').parentId, 'cluster-25')
  assert.equal(calls.nodeMove.length, 1)
  assert.equal(calls.nodeMove[0].toParentId, 'cluster-25')

  controller.destroy()
})

test('keydown Escape dispatches to the real keydown handler and clears the selection', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.setSelected(['feeder-1'])

  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

  assert.deepEqual(controller.getSelectedIds(), [])

  controller.destroy()
})

test('keydown Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo edits', () => {
  const deps = createDeps()
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const graph = deps.getGraph()

  controller.setSelected(['grid-tie'])
  controller.deleteSelection()
  assert.equal(graph.nodes.has('grid-tie'), false)

  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }))
  assert.equal(graph.nodes.has('grid-tie'), true)

  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }))
  assert.equal(graph.nodes.has('grid-tie'), false)

  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', metaKey: true, bubbles: true, cancelable: true }))
  assert.equal(graph.nodes.has('grid-tie'), false)

  controller.destroy()
})

test('keydown Ctrl+Z undo works when metaKey is not set', () => {
  const deps = createDeps()
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const graph = deps.getGraph()

  controller.setSelected(['grid-tie'])
  controller.deleteSelection()
  assert.equal(graph.nodes.has('grid-tie'), false)

  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
  assert.equal(graph.nodes.has('grid-tie'), true)

  controller.destroy()
})

test('wheel over blank canvas dispatches to the real drag-controller and zooms the viewport', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const before = controller.getViewport().scale

  const event = new WheelEvent('wheel', { clientX: 780, clientY: 580, deltaY: -100, bubbles: true, cancelable: true })
  canvas.dispatchEvent(event)

  assert.notEqual(controller.getViewport().scale, before)

  controller.destroy()
})

test('dragover prevents the default and drop dispatches to the real drag-controller, committing a dropped resource', () => {
  const calls = { nodeDrop: [] }
  const deps = createDeps({ emitNodeDrop: (payload) => calls.nodeDrop.push(payload) })
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const point = nodeCenter(layout, 'grid-tie')

  const overEvent = new Event('dragover', { bubbles: true, cancelable: true })
  canvas.dispatchEvent(overEvent)
  assert.equal(overEvent.defaultPrevented, true)

  const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(dropEvent, 'dataTransfer', { value: { getData: () => JSON.stringify({ id: 'sensor', label: 'Sensor' }) } })
  Object.defineProperty(dropEvent, 'clientX', { value: point.x, configurable: true })
  Object.defineProperty(dropEvent, 'clientY', { value: point.y, configurable: true })
  canvas.dispatchEvent(dropEvent)

  assert.equal(calls.nodeDrop.length, 1)
  assert.equal(calls.nodeDrop[0].parentId, 'grid-tie')

  controller.destroy()
})

test('cancelPointerInteractions is forwarded to the real drag-controller and clears an in-progress pan', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 780, clientY: 580, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 760, clientY: 560, pointerId: 1, bubbles: true, cancelable: true }))

  controller.cancelPointerInteractions()
  const before = controller.getViewport()
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 760, clientY: 560, pointerId: 1, bubbles: true, cancelable: true }))

  assert.deepEqual(controller.getViewport(), before) // pointerup after cancel does not flush/commit the pan

  controller.destroy()
})

test('fitToScreen cancels an in-progress node drag before recentering the viewport', () => {
  const deps = createDeps()
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const point = nodeCenter(layout, 'feeder-1')
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: point.x + 200, clientY: point.y + 200, pointerId: 1, bubbles: true, cancelable: true }))

  controller.fitToScreen()
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: point.x + 200, clientY: point.y + 200, pointerId: 1, bubbles: true, cancelable: true }))

  // the drag was cancelled by fitToScreen, so the pointerup above is a no-op: feeder-1 stays put
  assert.equal(deps.getGraph().nodes.get('grid-tie').children.includes('feeder-1'), true)

  controller.destroy()
})

test('destroy removes every canvas DOM listener', () => {
  const deps = createDeps()
  const controller = createMinimapController(deps)
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.destroy()

  const layout = computeLayout(deps.getGraph(), LAYOUT_OPTS)
  const point = nodeCenter(layout, 'feeder-1')
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, button: 0, pointerId: 1, bubbles: true, cancelable: true }))
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true, cancelable: true }))

  assert.deepEqual(controller.getSelectedIds(), [])
})
