import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { createMinimapController } from '../src/minimap/minimap-controller.js'
import { defaultTheme } from '../src/minimap/theme.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()
stubAnimationFrame()

function createElements() {
  const canvas = document.createElement('canvas')
  const container = document.createElement('div')
  container.appendChild(canvas)
  return { canvas, container }
}

function createDeps(overrides = {}) {
  // 缓存单个 graph 实例并始终返回同一个引用——跟真实 Vue 用法里 props.graph 是同一个稳定
  // 引用的语义一致。如果这里改成每次调用都 new 一个 createDemoGraph()，core/edit/search/
  // contextMenu 几个 controller 各自拿到的 getGraph() 就会是不同的对象实例：edit-controller
  // 内部 graph-operations.js 的撤销栈是在 edit 构造时绑定的某一个实例上做就地修改，
  // 如果 core 的 layout 是从另一个实例算出来的，两边会静默失配。
  const graph = createDemoGraph()
  return {
    getGraph: () => graph,
    getLayoutDirection: () => 'horizontal',
    getOptions: () => ({}),
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
    emitDelete: () => {},
    emitCopy: () => {},
    emitPaste: () => {},
    emitImport: () => {},
    emitExport: () => {},
    emitChange: () => {},
    centerOnNode: () => {},
    fitToScreen: () => {},
    centerOnSelection: () => {},
    emitSearch: () => {},
    onSearchStateChange: () => {},
    cancelPointerInteractions: () => {},
    emitConfigChange: () => {},
    emitContextMenuAction: () => {},
    getContextMenuItemsProp: () => null,
    getMenuEl: () => null,
    onMenuStateChange: () => {},
    getInteractionRenderState: () => ({
      dragging: false,
      interacting: false,
      groupDrag: null,
      selectionRect: null,
      groupScrollbarHoverId: null,
      attachPreview: null,
    }),
    emitViewportChange: () => {},
    emitGroupStateChange: () => {},
    onRenderStats: () => {},
    onOverviewRender: () => {},
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    onPointerLeave: () => {},
    onPointerCancel: () => {},
    onLostPointerCapture: () => {},
    onKeyDown: () => {},
    onWheel: () => {},
    onDragOver: () => {},
    onDrop: () => {},
    ...overrides,
  }
}

const POINTER_EVENTS = [
  ['pointerdown', 'onPointerDown'],
  ['pointermove', 'onPointerMove'],
  ['pointerup', 'onPointerUp'],
  ['pointerleave', 'onPointerLeave'],
  ['pointercancel', 'onPointerCancel'],
  ['lostpointercapture', 'onLostPointerCapture'],
  ['keydown', 'onKeyDown'],
  ['wheel', 'onWheel'],
  ['dragover', 'onDragOver'],
  ['drop', 'onDrop'],
]

test('mount attaches every canvas DOM listener and forwards events to the injected handlers', () => {
  const received = {}
  const overrides = {}
  for (const [, depName] of POINTER_EVENTS) {
    overrides[depName] = (event) => {
      received[depName] = event
    }
  }
  const controller = createMinimapController(createDeps(overrides))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  for (const [eventName, depName] of POINTER_EVENTS) {
    const EventCtor = eventName === 'wheel' ? MouseEvent : Event
    canvas.dispatchEvent(new EventCtor(eventName, { bubbles: true, cancelable: true }))
    assert.ok(received[depName], `expected ${depName} to be called for ${eventName}`)
  }

  controller.destroy()
})

test('destroy removes every canvas DOM listener', () => {
  let calls = 0
  const controller = createMinimapController(createDeps({ onPointerDown: () => { calls += 1 } }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.destroy()

  canvas.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
  assert.equal(calls, 0)
})

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

test('search methods forward to the real search-controller and jump using the injected camera wrapper', () => {
  const centered = []
  const controller = createMinimapController(createDeps({ centerOnNode: (id) => centered.push(id) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const payload = controller.search('feeder')

  assert.deepEqual(payload.matches, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.deepEqual(centered, ['feeder-1'])
  assert.deepEqual(controller.getSelectedIds(), ['feeder-1'])

  controller.destroy()
})

test('the canvas contextmenu DOM event dispatches directly to the context-menu-controller, not through deps', () => {
  const menuStates = []
  const controller = createMinimapController(createDeps({ onMenuStateChange: (state) => menuStates.push(state) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: -500, clientY: -500 })
  canvas.dispatchEvent(event)

  assert.ok(menuStates.at(-1))
  assert.equal(menuStates.at(-1).context.targetType, 'canvas')

  controller.runContextMenuItem({ id: 'fit-to-screen', action: 'fit-to-screen', disabled: false })
  assert.equal(menuStates.at(-1), null)

  controller.destroy()
})
