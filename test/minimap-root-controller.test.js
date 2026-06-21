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
  return {
    getGraph: () => createDemoGraph(),
    getLayoutDirection: () => 'horizontal',
    getOptions: () => ({}),
    getTheme: () => defaultTheme,
    getRenderers: () => ({}),
    getViewportProp: () => null,
    getGroupStatesProp: () => null,
    getSelectedIds: () => [],
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
    onContextMenu: () => {},
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
  ['contextmenu', 'onContextMenu'],
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
    const EventCtor = eventName === 'wheel' || eventName === 'contextmenu' ? MouseEvent : Event
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
