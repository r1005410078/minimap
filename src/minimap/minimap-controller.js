import { createCoreController } from './core-controller.js'

const POINTER_EVENT_BINDINGS = [
  ['pointerdown', 'onPointerDown'],
  ['pointermove', 'onPointerMove'],
  ['pointerup', 'onPointerUp'],
  ['pointerleave', 'onPointerLeave'],
  ['pointercancel', 'onPointerCancel'],
  ['lostpointercapture', 'onLostPointerCapture'],
  ['keydown', 'onKeyDown'],
  ['contextmenu', 'onContextMenu'],
  ['dragover', 'onDragOver'],
  ['drop', 'onDrop'],
]

export function createMinimapController(deps) {
  const core = createCoreController(deps)
  let canvasEl = null
  const listeners = []

  function addListener(eventName, handler, options) {
    listeners.push({ eventName, handler, options })
  }

  function handleWheel(event) {
    deps.onWheel(event)
  }

  function mount(canvas, container) {
    canvasEl = canvas
    core.mount(canvas, container)
    if (!canvasEl) return

    for (const [eventName, depName] of POINTER_EVENT_BINDINGS) {
      const handler = (event) => deps[depName](event)
      addListener(eventName, handler)
      canvasEl.addEventListener(eventName, handler)
    }
    addListener('wheel', handleWheel, { passive: false })
    canvasEl.addEventListener('wheel', handleWheel, { passive: false })
  }

  function destroy() {
    if (canvasEl) {
      for (const { eventName, handler, options } of listeners) {
        canvasEl.removeEventListener(eventName, handler, options)
      }
    }
    listeners.length = 0
    canvasEl = null
    core.destroy()
  }

  return {
    mount,
    destroy,
    getCssSize: core.getCssSize,
    screenPointFromClient: core.screenPointFromClient,
    pointFromClient: core.pointFromClient,
    getLayout: core.getLayout,
    updateLayout: core.updateLayout,
    scrollGroup: core.scrollGroup,
    setGroupExpanded: core.setGroupExpanded,
    resolveTargetRect: core.resolveTargetRect,
    resolveCenterTarget: core.resolveCenterTarget,
    getViewport: core.getViewport,
    applyViewport: core.applyViewport,
    zoomAt: core.zoomAt,
    panBy: core.panBy,
    fitToScreen: core.fitToScreen,
    centerOnNode: core.centerOnNode,
    centerOnSelection: core.centerOnSelection,
    zoomTo: core.zoomTo,
    setViewport: core.setViewport,
    cancelViewportTween: core.cancelViewportTween,
    settleAnimation: core.settleAnimation,
    cancelAnimation: core.cancelAnimation,
    renderCurrent: core.renderCurrent,
    scheduleRender: core.scheduleRender,
    flushScheduledRender: core.flushScheduledRender,
    cancelScheduledRender: core.cancelScheduledRender,
  }
}
