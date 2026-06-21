import { computeLayout, clampGroupScroll, locateChildGroup, childRectInGroup, scrollTopToReveal } from './layout.js'
import {
  DEFAULT_VIEWPORT,
  normalizeViewport,
  sameViewport,
  viewportOptions,
  zoomViewportAt,
  panViewportBy,
} from './viewport.js'
import { screenToWorld } from './coords.js'
import { renderScene, worldRectToScreen } from './renderer.js'
import { buildSelectionRelations } from './selection.js'
import { createRenderScheduler } from './render-scheduler.js'
import { resolveRenderQuality } from './render-quality.js'

export function createCoreController(deps) {
  let canvasEl = null
  let containerEl = null
  let ctx = null
  let resizeObserver = null
  let cssWidth = 0
  let cssHeight = 0

  let layout = null
  let internalGroupStates = {}
  let internalViewport = { ...DEFAULT_VIEWPORT }
  let renderScheduler = null

  function currentOptions() {
    return deps.getOptions() ?? {}
  }

  function isGroupStatesControlled() {
    return deps.getGroupStatesProp() != null
  }

  function currentGroupStates() {
    return deps.getGroupStatesProp() ?? internalGroupStates
  }

  function isViewportControlled() {
    return deps.getViewportProp() != null
  }

  function getViewport() {
    return normalizeViewport(deps.getViewportProp() ?? internalViewport, viewportOptions(currentOptions()))
  }

  function applyViewport(nextViewport, { emitChange = true, render = true } = {}) {
    const next = normalizeViewport(nextViewport, viewportOptions(currentOptions()))
    const previous = getViewport()
    if (sameViewport(previous, next)) return false
    if (emitChange) deps.emitViewportChange(next)
    if (isViewportControlled()) return true
    internalViewport = next
    if (render) renderCurrent(layout, next)
    return true
  }

  function updateGroupState(groupId, patch) {
    const current = currentGroupStates()
    const next = { ...current, [groupId]: { ...current[groupId], ...patch } }
    if (!isGroupStatesControlled()) internalGroupStates = next
    deps.emitGroupStateChange(next)
  }

  function scrollGroup(group, rawScrollTop) {
    const nextScrollTop = clampGroupScroll(group, rawScrollTop)
    if (!isGroupStatesControlled()) group.scrollTop = nextScrollTop
    updateGroupState(group.id, { scrollTop: nextScrollTop })
    if (isGroupStatesControlled()) updateLayout({ animate: false, preserveAnchor: false })
    else renderCurrent()
  }

  function setGroupExpanded(groupId, expanded) {
    updateGroupState(groupId, { expanded })
    updateLayout()
  }

  function resolveTargetRect(id) {
    if (!layout) return null
    const group = layout.groups.find((g) => g.id === id)
    if (group) return { x: group.x, y: group.y, width: group.width, height: group.height }
    const nodeRect = layout.nodes.get(id)
    if (nodeRect) return nodeRect
    const located = locateChildGroup(layout, id)
    if (!located) return null
    return childRectInGroup(located.group, id)
  }

  function rectCenter(rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }

  function resolveCenterTarget(id) {
    if (!layout) return null
    const located = locateChildGroup(layout, id)
    if (located) {
      const scrollTop = scrollTopToReveal(located.group, located.index)
      if (!isGroupStatesControlled()) located.group.scrollTop = scrollTop
      updateGroupState(located.group.id, { scrollTop })
      if (isGroupStatesControlled()) updateLayout({ animate: false, preserveAnchor: false })
    }
    const rect = resolveTargetRect(id)
    return rect ? rectCenter(rect) : null
  }

  function updateLayout({ animate = true, preserveAnchor = true } = {}) {
    if (!ctx) return
    const nextLayout = computeLayout(deps.getGraph(), {
      direction: deps.getLayoutDirection(),
      viewportWidth: cssWidth,
      viewportHeight: cssHeight,
      groupThreshold: currentOptions().groupThreshold,
      groupStates: new Map(Object.entries(currentGroupStates())),
    })
    layout = nextLayout
    renderCurrent(layout, getViewport())
  }

  function renderCurrent(currentLayout = layout, renderViewport = getViewport()) {
    if (!ctx || !currentLayout) return
    const interaction = deps.getInteractionRenderState()
    const relations = interaction.dragging
      ? buildSelectionRelations(deps.getGraph(), currentLayout, [])
      : buildSelectionRelations(deps.getGraph(), currentLayout, deps.getSelectedIds())
    const attachPreview = interaction.attachPreview
      ? {
          rect: worldRectToScreen(interaction.attachPreview.rect, renderViewport),
          parentRect: interaction.attachPreview.parentRect
            ? worldRectToScreen(interaction.attachPreview.parentRect, renderViewport)
            : null,
        }
      : null
    const stats = renderScene(ctx, {
      layout: currentLayout,
      graph: deps.getGraph(),
      layoutDirection: deps.getLayoutDirection(),
      viewport: renderViewport,
      width: cssWidth,
      height: cssHeight,
      theme: deps.getTheme(),
      state: {
        selectedIds: relations.selectedIds,
        highlightedIds: relations.highlightedIds,
        dimmedIds: relations.dimmedIds,
        highlightedEdgeIds: relations.highlightedEdgeIds,
        dimmedEdgeIds: relations.dimmedEdgeIds,
        groupDrag: interaction.groupDrag ?? null,
        groupScrollbarHoverId: interaction.groupScrollbarHoverId ?? null,
        selectionRect: interaction.selectionRect ?? null,
        attachPreview,
      },
      quality: resolveRenderQuality({
        scale: renderViewport.scale,
        interacting: currentOptions().hideTextDuringInteraction === true && interaction.interacting === true,
      }),
      renderers: deps.getRenderers(),
    })
    deps.onRenderStats(stats)
    deps.onOverviewRender({
      layout: currentLayout,
      viewport: renderViewport,
      mainWidth: cssWidth,
      mainHeight: cssHeight,
      theme: deps.getTheme(),
    })
  }

  function scheduleRender(reason) {
    renderScheduler.schedule(reason)
  }

  function flushScheduledRender() {
    renderScheduler.flush()
  }

  function cancelScheduledRender() {
    renderScheduler.cancel()
  }

  function syncCanvasSize() {
    if (!containerEl || !canvasEl || !ctx) return
    cssWidth = containerEl.clientWidth
    cssHeight = containerEl.clientHeight
    const dpr = globalThis.devicePixelRatio || 1
    canvasEl.width = Math.max(1, Math.round(cssWidth * dpr))
    canvasEl.height = Math.max(1, Math.round(cssHeight * dpr))
    canvasEl.style.width = `${cssWidth}px`
    canvasEl.style.height = `${cssHeight}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function mount(canvas, container) {
    if (!canvas) return
    canvasEl = canvas
    containerEl = container
    ctx = canvas.getContext('2d')
    renderScheduler = createRenderScheduler({ render: () => renderCurrent() })
    syncCanvasSize()
    resizeObserver = new ResizeObserver(() => {
      syncCanvasSize()
      updateLayout({ animate: false, preserveAnchor: false })
    })
    if (container) resizeObserver.observe(container)
    updateLayout({ animate: false, preserveAnchor: false })
  }

  function destroy() {
    cancelScheduledRender()
    resizeObserver?.disconnect()
    resizeObserver = null
  }

  function getCssSize() {
    return { width: cssWidth, height: cssHeight }
  }

  function screenPointFromClient(clientX, clientY) {
    if (!canvasEl) return { x: clientX, y: clientY }
    const rect = canvasEl.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  function pointFromClient(clientX, clientY) {
    return screenToWorld(screenPointFromClient(clientX, clientY), getViewport())
  }

  function zoomAt(screenPoint, deltaY) {
    return applyViewport(zoomViewportAt(getViewport(), screenPoint, deltaY, viewportOptions(currentOptions())))
  }

  function panBy(delta) {
    return applyViewport(panViewportBy(getViewport(), delta, viewportOptions(currentOptions())), { render: false })
  }

  function getLayout() {
    return layout
  }

  return {
    mount,
    destroy,
    getCssSize,
    screenPointFromClient,
    pointFromClient,
    getLayout,
    updateLayout,
    scrollGroup,
    setGroupExpanded,
    resolveTargetRect,
    resolveCenterTarget,
    getViewport,
    applyViewport,
    zoomAt,
    panBy,
    renderCurrent,
    scheduleRender,
    flushScheduledRender,
    cancelScheduledRender,
  }
}
