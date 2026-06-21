import { createCoreController } from './core-controller.js'
import { createSelectionController } from './selection-controller.js'
import { createEditController } from './edit-controller.js'
import { createSearchController } from './search-controller.js'
import { createContextMenuController } from './context-menu-controller.js'

const POINTER_EVENT_BINDINGS = [
  ['pointerdown', 'onPointerDown'],
  ['pointermove', 'onPointerMove'],
  ['pointerup', 'onPointerUp'],
  ['pointerleave', 'onPointerLeave'],
  ['pointercancel', 'onPointerCancel'],
  ['lostpointercapture', 'onLostPointerCapture'],
  ['keydown', 'onKeyDown'],
  ['dragover', 'onDragOver'],
  ['drop', 'onDrop'],
]

export function createMinimapController(deps) {
  // selection 的 renderCurrent 依赖通过闭包延迟引用 core——此时 core 还没创建，
  // 但 renderCurrent 这个箭头函数只在 selection.setSelected() 真正被调用时才执行
  // （那一定发生在 createMinimapController() 整个跑完、core 已经赋值之后），
  // 所以这里直接引用下面才声明的 `core` 变量是安全的，不会触发 TDZ 报错。
  const selection = createSelectionController({
    getSelectedIdsProp: deps.getSelectedIdsProp,
    emitSelect: deps.emitSelect,
    renderCurrent: () => core.renderCurrent(),
  })

  const core = createCoreController({
    ...deps,
    getSelectedIds: selection.getSelectedIds,
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

  const search = createSearchController({
    getGraph: deps.getGraph,
    centerOnNode: deps.centerOnNode,
    select: selection.select,
    emitSearch: deps.emitSearch,
    onSearchStateChange: deps.onSearchStateChange,
  })

  let canvasEl = null

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
    fitToScreen: deps.fitToScreen,
    centerOnSelection: deps.centerOnSelection,
    centerOnNode: deps.centerOnNode,
    cancelPointerInteractions: deps.cancelPointerInteractions,
    emitConfigChange: deps.emitConfigChange,
    emitContextMenuAction: deps.emitContextMenuAction,
    getContextMenuItemsProp: deps.getContextMenuItemsProp,
    getCanvasEl: () => canvasEl,
    getMenuEl: deps.getMenuEl,
    onMenuStateChange: deps.onMenuStateChange,
  })

  const listeners = []

  function addListener(eventName, handler, options) {
    listeners.push({ eventName, handler, options })
  }

  function handleWheel(event) {
    deps.onWheel(event)
  }

  function handleContextMenu(event) {
    contextMenu.open(event)
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
    addListener('contextmenu', handleContextMenu)
    canvasEl.addEventListener('contextmenu', handleContextMenu)
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
  }
}
