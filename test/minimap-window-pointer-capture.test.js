import test from 'node:test'
import assert from 'node:assert/strict'
import { createMockCtx } from './helpers/mock-ctx.js'
import { stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { createMinimapController } from '../src/minimap/controllers/minimap-controller.js'
import { defaultTheme } from '../src/minimap/render/theme.js'

function createEventTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? []
      handlers.push(handler)
      listeners.set(type, handlers)
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== handler))
    },
    dispatchEvent(event) {
      event.target ??= this
      for (const handler of listeners.get(event.type) ?? []) handler(event)
      return !event.defaultPrevented
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length
    },
  }
}

function pointerEvent(type, point, extra = {}) {
  return {
    type,
    clientX: point.x,
    clientY: point.y,
    button: 0,
    pointerId: 1,
    metaKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() {},
    ...extra,
  }
}

function installHeadlessDom() {
  const previous = {
    window: globalThis.window,
    ResizeObserver: globalThis.ResizeObserver,
  }
  const windowTarget = createEventTarget()
  globalThis.window = windowTarget
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  stubAnimationFrame()
  return {
    windowTarget,
    restore() {
      globalThis.window = previous.window
      globalThis.ResizeObserver = previous.ResizeObserver
    },
  }
}

function createElements() {
  const canvas = createEventTarget()
  Object.assign(canvas, {
    style: {},
    width: 0,
    height: 0,
    captured: [],
    focusCalls: 0,
    getContext: () => createMockCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture(id) { this.captured.push(id) },
    focus() { this.focusCalls += 1 },
  })
  const container = {
    clientWidth: 800,
    clientHeight: 600,
  }
  return { canvas, container }
}

function createDeps(overrides = {}) {
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

test('window pointerup completes a fast marquee that leaves the canvas immediately', () => {
  const { windowTarget, restore } = installHeadlessDom()
  try {
    const controller = createMinimapController(createDeps())
    const { canvas, container } = createElements()
    controller.mount(canvas, container)

    canvas.dispatchEvent(pointerEvent('pointerdown', { x: 380, y: -10 }, { metaKey: true }))
    windowTarget.dispatchEvent(pointerEvent('pointerup', { x: 540, y: 170 }, { metaKey: true, target: windowTarget }))

    assert.deepEqual(controller.getSelectedIds().sort(), ['feeder-1', 'feeder-2', 'feeder-3'])

    controller.destroy()
  } finally {
    restore()
  }
})
