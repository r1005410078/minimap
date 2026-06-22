import { createCoreController } from './core-controller.js'
import { createSelectionController } from './selection-controller.js'
import { createEditController } from './edit-controller.js'
import { createSearchController } from './search-controller.js'
import { createContextMenuController } from './context-menu-controller.js'
import { createDragController } from './drag-controller.js'
import { isModKey } from '../interaction/interaction.js'

export function createMinimapController(deps) {
  // selection 的 renderCurrent 依赖通过闭包延迟引用 core，core 的 getInteractionRenderState
  // 依赖通过闭包延迟引用 drag——两者都只在真正被调用时才访问，那一定发生在
  // createMinimapController() 整个跑完、core/drag 都已经赋值之后，所以这里直接引用
  // 下面才声明的变量是安全的，不会触发 TDZ 报错。
  const selection = createSelectionController({
    getSelectedIdsProp: deps.getSelectedIdsProp,
    emitSelect: deps.emitSelect,
    renderCurrent: () => core.renderCurrent(),
  })

  const core = createCoreController({
    ...deps,
    getSelectedIds: selection.getSelectedIds,
    getInteractionRenderState: () => drag.getInteractionRenderState(),
    getSearchMatchId: () => search.getCurrentMatchId(),
  })

  const edit = createEditController({
    getGraph: deps.getGraph,
    getLayout: core.getLayout,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    getReadonly: deps.getReadonly,
    updateLayout: core.updateLayout,
    getBeforeDelete: deps.getBeforeDelete,
    getBeforeCopy: deps.getBeforeCopy,
    getBeforeImport: deps.getBeforeImport,
    getBeforePaste: deps.getBeforePaste,
    emitDelete: deps.emitDelete,
    emitCopy: deps.emitCopy,
    emitPaste: deps.emitPaste,
    emitImport: deps.emitImport,
    emitExport: deps.emitExport,
    emitChange: deps.emitChange,
  })

  let canvasEl = null
  let activeWindowPointerId = null
  let windowPointerListenersAttached = false

  // 永久取代 Vue 本地"先 cancelPointerInteractions 再转发"的相机包装函数（切片 1/2 的
  // 临时跨切片依赖到这里收尾）。函数体只在被调用时才访问 drag/core，声明顺序不受限。
  function fitToScreen() {
    drag.cancelPointerInteractions()
    core.fitToScreen()
  }

  function centerOnNode(id) {
    drag.cancelPointerInteractions()
    core.centerOnNode(id)
  }

  function centerOnSelection() {
    drag.cancelPointerInteractions()
    core.centerOnSelection()
  }

  function zoomTo(scale, center) {
    drag.cancelPointerInteractions()
    core.zoomTo(scale, center)
  }

  // 根 controller 自己持有 selection/edit/contextMenu 的真实引用，不需要经过 deps 间接转发，
  // 也不需要 Vue 再传 handleKeyDown 本身——这段纯派发逻辑跟"拖拽"无关，留在根 controller。
  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      if (contextMenu.isOpen()) {
        event.preventDefault()
        contextMenu.close()
        return
      }
      if (selection.getSelectedIds().length === 0) return
      event.preventDefault()
      selection.setSelected([])
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      edit.deleteSelection()
      return
    }
    if (isModKey(event) && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      edit.copySelection()
      return
    }
    if (isModKey(event) && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      edit.paste()
      return
    }
    if (isModKey(event) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault()
      edit.undo()
      return
    }
    if (
      isModKey(event) &&
      ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')
    ) {
      event.preventDefault()
      edit.redo()
    }
  }

  const contextMenu = createContextMenuController({
    getGraph: deps.getGraph,
    getLayout: core.getLayout,
    screenPointFromClient: core.screenPointFromClient,
    pointFromClient: core.pointFromClient,
    getCssSize: core.getCssSize,
    setGroupExpanded: core.setGroupExpanded,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    getReadonly: deps.getReadonly,
    getOptions: deps.getOptions,
    canUndo: edit.canUndo,
    canRedo: edit.canRedo,
    copySelection: edit.copySelection,
    deleteSelection: edit.deleteSelection,
    pasteInto: edit.pasteInto,
    paste: edit.paste,
    fitToScreen,
    centerOnSelection,
    centerOnNode,
    cancelPointerInteractions: () => drag.cancelPointerInteractions(),
    emitConfigChange: deps.emitConfigChange,
    emitContextMenuAction: deps.emitContextMenuAction,
    getContextMenuItemsProp: deps.getContextMenuItemsProp,
    getCanvasEl: () => canvasEl,
    getMenuEl: deps.getMenuEl,
    onMenuStateChange: deps.onMenuStateChange,
  })

  const drag = createDragController({
    getGraph: deps.getGraph,
    getLayoutDirection: deps.getLayoutDirection,
    getOptions: deps.getOptions,
    getGroupStatesProp: deps.getGroupStatesProp,
    getBeforeNodeDrop: deps.getBeforeNodeDrop,
    getBeforeGroupReorder: deps.getBeforeGroupReorder,
    getBeforeNodeMove: deps.getBeforeNodeMove,
    getLayout: core.getLayout,
    getViewport: core.getViewport,
    applyViewport: core.applyViewport,
    updateLayout: core.updateLayout,
    getCssSize: core.getCssSize,
    screenPointFromClient: core.screenPointFromClient,
    pointFromClient: core.pointFromClient,
    renderCurrent: core.renderCurrent,
    scheduleRender: core.scheduleRender,
    flushScheduledRender: core.flushScheduledRender,
    cancelScheduledRender: core.cancelScheduledRender,
    settleAnimation: core.settleAnimation,
    scrollGroup: core.scrollGroup,
    setGroupExpanded: core.setGroupExpanded,
    zoomAt: core.zoomAt,
    getCanvasEl: () => canvasEl,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    applyOperation: edit.applyOperation,
    emitChangeIfApplied: edit.emitChangeIfApplied,
    closeContextMenu: contextMenu.close,
    cancelContextMenuPending: contextMenu.cancelPending,
    emitNodeDrop: deps.emitNodeDrop,
    emitGroupReorder: deps.emitGroupReorder,
    emitNodeMove: deps.emitNodeMove,
  })

  const search = createSearchController({
    getGraph: deps.getGraph,
    centerOnNode,
    select: selection.select,
    emitSearch: deps.emitSearch,
    onSearchStateChange: deps.onSearchStateChange,
  })

  const listeners = []

  function addListener(eventName, handler, options) {
    listeners.push({ eventName, handler, options })
  }

  const DIRECT_EVENT_BINDINGS = [
    ['pointerdown', () => handlePointerDown],
    ['pointermove', () => handlePointerMove],
    ['pointerup', () => handlePointerUp],
    ['pointerleave', () => drag.onPointerLeave],
    ['pointercancel', () => handlePointerCancel],
    ['lostpointercapture', () => handleLostPointerCapture],
    ['dragover', () => drag.onDragOver],
    ['dragleave', () => drag.onDragLeave],
    ['drop', () => drag.onDrop],
    ['keydown', () => handleKeyDown],
    ['contextmenu', () => contextMenu.suppressContextMenu],
  ]

  function eventTargetsCanvas(event) {
    if (!canvasEl) return false
    if (event.target === canvasEl) return true
    return typeof event.composedPath === 'function' && event.composedPath().includes(canvasEl)
  }

  function attachWindowPointerListeners(pointerId) {
    if (typeof window === 'undefined' || windowPointerListenersAttached) {
      activeWindowPointerId = pointerId
      return
    }
    activeWindowPointerId = pointerId
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerCancel)
    windowPointerListenersAttached = true
  }

  function detachWindowPointerListeners() {
    activeWindowPointerId = null
    if (typeof window === 'undefined' || !windowPointerListenersAttached) return
    window.removeEventListener('pointermove', handleWindowPointerMove)
    window.removeEventListener('pointerup', handleWindowPointerUp)
    window.removeEventListener('pointercancel', handleWindowPointerCancel)
    windowPointerListenersAttached = false
  }

  function shouldHandleWindowPointerEvent(event) {
    return activeWindowPointerId != null && event.pointerId === activeWindowPointerId && !eventTargetsCanvas(event)
  }

  function handlePointerDown(event) {
    if (event.button === 0 || event.button === 2) attachWindowPointerListeners(event.pointerId)
    drag.onPointerDown(event)
    contextMenu.handlePointerDown(event)
  }

  function handlePointerMove(event) {
    drag.onPointerMove(event)
    contextMenu.handlePointerMove(event)
  }

  function handlePointerUp(event) {
    drag.onPointerUp(event)
    if (event.button === 2 && drag.consumeMarqueeGesture()) {
      contextMenu.cancelPending()
      detachWindowPointerListeners()
      return
    }
    contextMenu.handlePointerUp(event)
    detachWindowPointerListeners()
  }

  function handlePointerCancel(event) {
    contextMenu.cancelPending()
    drag.onPointerCancel(event)
    detachWindowPointerListeners()
  }

  // 丢失指针捕获不代表手势结束。快速拖动时浏览器会在 pointerup 之前先发
  // lostpointercapture；若在这里取消手势，进行中的框选/拖拽会被误丢弃，而紧随其后的
  // pointerup 已无事可做（表现为“放快了选不中/拖不准，停一下才正常”）。
  // 这里不再取消、也不提前摘掉 window 监听：手势由随后的 pointerup（canvas 或 window）
  // 正常完成，或由 pointercancel 真正取消。
  function handleLostPointerCapture() {}

  function handleWindowPointerMove(event) {
    if (!shouldHandleWindowPointerEvent(event)) return
    handlePointerMove(event)
  }

  function handleWindowPointerUp(event) {
    if (!shouldHandleWindowPointerEvent(event)) return
    handlePointerUp(event)
  }

  function handleWindowPointerCancel(event) {
    if (!shouldHandleWindowPointerEvent(event)) return
    handlePointerCancel(event)
  }

  function mount(canvas, container) {
    canvasEl = canvas
    core.mount(canvas, container)
    if (!canvasEl) return

    for (const [eventName, getHandler] of DIRECT_EVENT_BINDINGS) {
      const handler = getHandler()
      addListener(eventName, handler)
      canvasEl.addEventListener(eventName, handler)
    }
    addListener('wheel', drag.onWheel, { passive: false })
    canvasEl.addEventListener('wheel', drag.onWheel, { passive: false })
  }

  function destroy() {
    detachWindowPointerListeners()
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
    fitToScreen,
    centerOnNode,
    centerOnSelection,
    zoomTo,
    setViewport: core.setViewport,
    cancelViewportTween: core.cancelViewportTween,
    settleAnimation: core.settleAnimation,
    cancelAnimation: core.cancelAnimation,
    renderCurrent: core.renderCurrent,
    scheduleRender: core.scheduleRender,
    flushScheduledRender: core.flushScheduledRender,
    cancelScheduledRender: core.cancelScheduledRender,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    select: selection.select,
    clearSelection: selection.clearSelection,
    undo: edit.undo,
    redo: edit.redo,
    canUndo: edit.canUndo,
    canRedo: edit.canRedo,
    deleteSelection: edit.deleteSelection,
    copySelection: edit.copySelection,
    paste: edit.paste,
    exportGraph: edit.exportGraph,
    importGraph: edit.importGraph,
    onGraphReplaced: edit.onGraphReplaced,
    applyOperation: edit.applyOperation,
    search: search.search,
    searchNext: search.searchNext,
    searchPrevious: search.searchPrevious,
    closeContextMenu: contextMenu.close,
    runContextMenuItem: contextMenu.runItem,
    cancelPointerInteractions: () => drag.cancelPointerInteractions(),
  }
}
