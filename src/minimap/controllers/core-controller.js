import { computeLayout, clampGroupScroll, locateChildGroup, childRectInGroup, scrollTopToReveal, keepAnchorStable } from '../graph/layout.js'
import {
  DEFAULT_VIEWPORT,
  normalizeViewport,
  sameViewport,
  viewportOptions,
  zoomViewportAt,
  panViewportBy,
  clampScale,
  fitViewportToBounds,
  centerViewportOn,
  centerViewportOnBounds,
  tweenViewport,
} from '../coords/viewport.js'
import { createLayoutTransition, layoutAt, resolveAnchorCenter } from '../graph/layout-transition.js'
import { screenToWorld } from '../coords/coords.js'
import { renderScene, worldRectToScreen } from '../render/renderer.js'
import { buildSelectionRelations } from '../interaction/selection.js'
import { createRenderScheduler } from '../render/render-scheduler.js'
import { resolveRenderQuality } from '../render/render-quality.js'

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

  let settledLayout = null
  let animationFrameId = null
  let activeTransition = null
  let lastRenderedLayout = null
  let lastRenderedViewport = { ...DEFAULT_VIEWPORT }
  let activeViewportTween = null
  let viewportTweenFrameId = null

  const ANIMATION_DURATION_MS = 200

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

  function cancelAnimation() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
    activeTransition = null
  }

  function commitViewportSilently(nextViewport) {
    const next = normalizeViewport(nextViewport, viewportOptions(currentOptions()))
    if (!isViewportControlled()) internalViewport = next
  }

  function finishLayout(nextLayout, nextViewport) {
    layout = nextLayout
    settledLayout = nextLayout
    commitViewportSilently(nextViewport)
    renderCurrent(layout, getViewport())
  }

  function settleAnimation() {
    if (!activeTransition) return
    const { nextLayout, nextViewport } = activeTransition
    cancelAnimation()
    finishLayout(nextLayout, nextViewport)
  }

  function chooseAnchorId(startLayout, nextLayout) {
    const selected = deps.getSelectedIds()[0]
    if (selected && resolveAnchorCenter(startLayout, selected) && resolveAnchorCenter(nextLayout, selected)) return selected
    const root = deps.getGraph().rootIds[0]
    if (root && resolveAnchorCenter(startLayout, root) && resolveAnchorCenter(nextLayout, root)) return root
    return null
  }

  function targetViewportFor(startLayout, nextLayout, preserveAnchor) {
    const viewport = getViewport()
    if (!preserveAnchor || !startLayout) return viewport
    const anchorId = chooseAnchorId(startLayout, nextLayout)
    if (!anchorId) return viewport
    const before = resolveAnchorCenter(startLayout, anchorId)
    const after = resolveAnchorCenter(nextLayout, anchorId)
    return keepAnchorStable(viewport, before, after)
  }

  function startAnimation(startLayout, nextLayout, startViewport, nextViewport) {
    const transition = createLayoutTransition({
      fromLayout: startLayout,
      toLayout: nextLayout,
      fromViewport: startViewport,
      toViewport: nextViewport,
      durationMs: ANIMATION_DURATION_MS,
    })
    activeTransition = { transition, startedAt: null, nextLayout, nextViewport }

    const tick = (time) => {
      if (!activeTransition) return
      if (activeTransition.startedAt === null) activeTransition.startedAt = time
      const elapsed = time - activeTransition.startedAt
      const progress = elapsed / activeTransition.transition.durationMs
      const frame = layoutAt(activeTransition.transition, progress)
      layout = frame.layout
      commitViewportSilently(frame.viewport)
      renderCurrent(layout, getViewport())

      if (progress >= 1) {
        animationFrameId = null
        const finished = activeTransition
        activeTransition = null
        finishLayout(finished.nextLayout, finished.nextViewport)
        return
      }
      animationFrameId = requestAnimationFrame(tick)
    }
    animationFrameId = requestAnimationFrame(tick)
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

    const startLayout = lastRenderedLayout || settledLayout || layout
    const startViewport = lastRenderedViewport || getViewport()
    let nextViewport = targetViewportFor(startLayout, nextLayout, preserveAnchor)
    const isInitialLayout = !settledLayout && !lastRenderedLayout
    if (isInitialLayout && !isViewportControlled() && !currentOptions().disableInitialCenter) {
      nextViewport = centerViewportOnBounds(
        nextLayout.bounds,
        cssWidth,
        cssHeight,
        1,
        viewportOptions(currentOptions()),
      )
    }
    const canAnimate = animate && typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function'

    cancelAnimation()

    if (!startLayout || !canAnimate || ANIMATION_DURATION_MS <= 0) {
      finishLayout(nextLayout, nextViewport)
      return
    }

    commitViewportSilently(startViewport)
    startAnimation(startLayout, nextLayout, startViewport, nextViewport)
  }

  function renderCurrent(currentLayout = layout, renderViewport = getViewport()) {
    if (!ctx || !currentLayout) return
    lastRenderedLayout = currentLayout
    lastRenderedViewport = { ...renderViewport }
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
        searchMatchId: deps.getSearchMatchId?.() ?? null,
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
    cancelAnimation()
    cancelViewportTween()
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

  function cancelViewportTween() {
    if (viewportTweenFrameId !== null) {
      cancelAnimationFrame(viewportTweenFrameId)
      viewportTweenFrameId = null
    }
    activeViewportTween = null
  }

  function runViewportTween(toViewport, { durationMs = 200 } = {}) {
    settleAnimation()
    cancelViewportTween()

    const next = normalizeViewport(toViewport, viewportOptions(currentOptions()))
    const fromViewport = getViewport()
    if (sameViewport(fromViewport, next)) return

    if (isViewportControlled()) {
      deps.emitViewportChange(next)
      return
    }

    activeViewportTween = { fromViewport, toViewport: next, durationMs, startedAt: null }
    const tick = (time) => {
      if (!activeViewportTween) return
      if (activeViewportTween.startedAt === null) activeViewportTween.startedAt = time
      const progress = (time - activeViewportTween.startedAt) / activeViewportTween.durationMs
      if (progress >= 1) {
        viewportTweenFrameId = null
        const finalViewport = activeViewportTween.toViewport
        activeViewportTween = null
        internalViewport = finalViewport
        renderCurrent(layout, finalViewport)
        deps.emitViewportChange(finalViewport)
        return
      }
      internalViewport = tweenViewport(activeViewportTween.fromViewport, activeViewportTween.toViewport, progress)
      renderCurrent(layout, internalViewport)
      viewportTweenFrameId = requestAnimationFrame(tick)
    }
    viewportTweenFrameId = requestAnimationFrame(tick)
  }

  function fitToScreen() {
    if (!layout) return
    runViewportTween(fitViewportToBounds(layout.bounds, cssWidth, cssHeight, currentOptions()))
  }

  function centerOnNode(id) {
    const target = resolveCenterTarget(id)
    if (!target) return
    runViewportTween(centerViewportOn(target, getViewport(), cssWidth, cssHeight))
  }

  function centerOnSelection() {
    const ids = deps.getSelectedIds()
    if (ids.length === 0) return
    const rects = ids.map(resolveTargetRect).filter(Boolean)
    if (rects.length === 0) return
    const minX = Math.min(...rects.map((r) => r.x))
    const maxX = Math.max(...rects.map((r) => r.x + r.width))
    const minY = Math.min(...rects.map((r) => r.y))
    const maxY = Math.max(...rects.map((r) => r.y + r.height))
    const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    runViewportTween(centerViewportOn(target, getViewport(), cssWidth, cssHeight))
  }

  function zoomTo(scale, center = null) {
    const viewport = getViewport()
    const worldCenter = center ?? screenToWorld({ x: cssWidth / 2, y: cssHeight / 2 }, viewport)
    const nextScale = clampScale(scale, viewportOptions(currentOptions()))
    runViewportTween({
      x: worldCenter.x * (viewport.scale - nextScale) + viewport.x,
      y: worldCenter.y * (viewport.scale - nextScale) + viewport.y,
      scale: nextScale,
    })
  }

  function setViewport(viewport) {
    settleAnimation()
    cancelViewportTween()
    applyViewport(viewport)
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
    fitToScreen,
    centerOnNode,
    centerOnSelection,
    zoomTo,
    setViewport,
    cancelViewportTween,
    settleAnimation,
    cancelAnimation,
  }
}
