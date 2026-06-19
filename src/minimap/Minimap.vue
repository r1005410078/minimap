<script setup>
// Phase 1 Vue 组件壳骨架：挂载真实 canvas、DPR 适配、ResizeObserver 驱动的按需重渲染。
// 分组框命中检测细分、框内拖拽换位、滚轮滚动、展开折叠点击见 Phase 2 切片3。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
// 和 docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { computeLayout, keepAnchorStable, GROUP, clampGroupScroll } from './layout.js'
import {
  createLayoutTransition,
  layoutAt,
  resolveAnchorCenter,
} from './layout-transition.js'
import { renderScene, worldRectToScreen } from './renderer.js'
import { defaultTheme } from './theme.js'
import { screenToWorld } from './coords.js'
import {
  DEFAULT_VIEWPORT,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  viewportOptions,
  zoomViewportAt,
} from './viewport.js'
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
} from './interaction.js'
import { reorderGroupChild } from './graph.js'
import {
  buildVirtualOrder,
  childWorldRectsById,
  currentShiftRects,
  dragShiftEasedProgress,
  dragShiftProgress,
} from './drag-transition.js'
import {
  applySelectionClick,
  buildSelectionRelations,
  idsInSelectionRect,
  normalizeRect,
} from './selection.js'
import ResourceTree from './ResourceTree.vue'

const ANIMATION_DURATION_MS = 200
const DRAG_SHIFT_DURATION_MS = 150
const SCROLLBAR_WIDTH = 8

const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  selectedIds: { type: Array, default: null },
  groupStates: { type: Object, default: null },
  viewport: { type: Object, default: null },
  options: { type: Object, default: null },
  theme: { type: Object, default: null },
  nodeRenderer: { type: Function, default: null },
  groupRenderer: { type: Function, default: null },
  edgeRenderer: { type: Function, default: null },
})

const emit = defineEmits([
  'select',
  'node-drop',
  'change',
  'group-state-change',
  'group-reorder',
  'viewport-change',
])

const containerRef = ref(null)
const canvasRef = ref(null)

let ctx = null
let resizeObserver = null
let layout = null
let cssWidth = 0
let cssHeight = 0
let internalSelectedIds = []
let internalGroupStates = {}
let dragState = null
let scrollbarDragState = null
let panState = null
let marqueeState = null
let hoveredScrollbarGroupId = null

let internalViewport = { ...DEFAULT_VIEWPORT }
let settledLayout = null
let animationFrameId = null
let activeTransition = null
let lastRenderedLayout = null
let lastRenderedViewport = { ...DEFAULT_VIEWPORT }

function currentSelectedIds() {
  if (props.selectedIds !== null) return props.selectedIds
  return internalSelectedIds
}

function currentGroupStates() {
  return props.groupStates !== null ? props.groupStates : internalGroupStates
}

function currentViewport() {
  return normalizeViewport(props.viewport ?? internalViewport, viewportOptions(props.options))
}

function applyViewport(nextViewport, { emitChange = true } = {}) {
  const next = normalizeViewport(nextViewport, viewportOptions(props.options))
  const previous = currentViewport()
  if (sameViewport(previous, next)) return false
  if (emitChange) emit('viewport-change', next)
  if (props.viewport !== null) return true
  internalViewport = next
  renderCurrent(layout, next)
  return true
}

function updateGroupState(groupId, patch) {
  const current = currentGroupStates()
  const next = { ...current, [groupId]: { ...current[groupId], ...patch } }
  if (props.groupStates === null) internalGroupStates = next
  emit('group-state-change', next)
}

const now = () => (globalThis.performance ?? Date).now()

function clearDragShiftAnimation() {
  if (!dragState) return
  dragState.shiftFromById = null
  dragState.shiftToById = null
  dragState.shiftStartedAt = null
}

function shouldAutoScroll(group) {
  return group && dragState?.ghostWorldPoint && groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y) !== 0
}

function dragRenderContext() {
  if (!dragState || !dragState.dragging || !layout) return null
  const group = layout.groups.find((g) => g.id === dragState.groupId)
  if (!group) return null
  const order = buildVirtualOrder(group, dragState.childId, dragState.insertIndex)
  const timestamp = now()
  const autoScrolling = shouldAutoScroll(group)
  const childRectsById =
    !autoScrolling &&
    dragState.shiftFromById &&
    dragState.shiftToById &&
    dragState.shiftStartedAt != null
      ? currentShiftRects(
          dragState.shiftFromById,
          dragState.shiftToById,
          dragState.shiftStartedAt,
          DRAG_SHIFT_DURATION_MS,
          timestamp,
        )
      : null
  const dropSlotOpacity =
    autoScrolling || dragState.slotFadeStartedAt == null
      ? 1
      : dragShiftEasedProgress(dragState.slotFadeStartedAt, DRAG_SHIFT_DURATION_MS, timestamp)
  return {
    groupId: group.id,
    order,
    draggingChildId: dragState.childId,
    ghostRect: dragState.ghostScreenRect,
    childRectsById,
    dropSlotOpacity,
  }
}

function dragShiftActive(timestamp = now()) {
  if (!dragState?.dragging) return false
  const shiftActive =
    dragState.shiftStartedAt != null &&
    dragShiftProgress(dragState.shiftStartedAt, DRAG_SHIFT_DURATION_MS, timestamp) < 1
  const slotActive =
    dragState.slotFadeStartedAt != null &&
    dragShiftProgress(dragState.slotFadeStartedAt, DRAG_SHIFT_DURATION_MS, timestamp) < 1
  return shiftActive || slotActive
}

function cancelDragShiftLoop() {
  if (dragState?.shiftRafId != null) {
    cancelAnimationFrame(dragState.shiftRafId)
    dragState.shiftRafId = null
  }
}

function ensureDragShiftLoop() {
  if (!dragState?.dragging || dragState.shiftRafId != null || dragState.scrollRafId != null) return
  const tick = (time) => {
    if (!dragState?.dragging) {
      cancelDragShiftLoop()
      return
    }
    renderCurrent()
    if (dragShiftActive(time ?? now())) dragState.shiftRafId = requestAnimationFrame(tick)
    else dragState.shiftRafId = null
  }
  dragState.shiftRafId = requestAnimationFrame(tick)
}

function beginDragVisuals(group) {
  const toOrder = buildVirtualOrder(group, dragState.childId, dragState.insertIndex)
  dragState.shiftFromById = childWorldRectsById(group, group.children)
  dragState.shiftToById = childWorldRectsById(group, toOrder)
  dragState.shiftStartedAt = now()
  dragState.slotFadeStartedAt = now()
}

function scheduleDragShift(group, insertIndex) {
  const timestamp = now()
  const fromById =
    dragState.shiftFromById && dragState.shiftToById && dragState.shiftStartedAt != null
      ? currentShiftRects(
          dragState.shiftFromById,
          dragState.shiftToById,
          dragState.shiftStartedAt,
          DRAG_SHIFT_DURATION_MS,
          timestamp,
        )
      : childWorldRectsById(group, group.children)
  const toOrder = buildVirtualOrder(group, dragState.childId, insertIndex)
  dragState.shiftFromById = fromById
  dragState.shiftToById = childWorldRectsById(group, toOrder)
  dragState.shiftStartedAt = timestamp
}

function renderCurrent(currentLayout = layout, renderViewport = currentViewport()) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...renderViewport }
  const relations = buildSelectionRelations(props.graph, currentLayout, currentSelectedIds())
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: renderViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: {
      selectedIds: relations.selectedIds,
      highlightedIds: relations.highlightedIds,
      dimmedIds: relations.dimmedIds,
      highlightedEdgeIds: relations.highlightedEdgeIds,
      dimmedEdgeIds: relations.dimmedEdgeIds,
      groupDrag: dragRenderContext(),
      groupScrollbarHoverId: hoveredScrollbarGroupId,
      selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
    },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
}

function cancelAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  activeTransition = null
}

function settleAnimation() {
  if (!activeTransition) return
  const { nextLayout, nextViewport } = activeTransition
  cancelAnimation()
  finishLayout(nextLayout, nextViewport)
}

function chooseAnchorId(startLayout, nextLayout) {
  const selected = currentSelectedIds()[0]
  if (selected && resolveAnchorCenter(startLayout, selected) && resolveAnchorCenter(nextLayout, selected)) return selected
  const root = props.graph.rootIds[0]
  if (root && resolveAnchorCenter(startLayout, root) && resolveAnchorCenter(nextLayout, root)) return root
  return null
}

function targetViewportFor(startLayout, nextLayout, preserveAnchor) {
  const viewport = currentViewport()
  if (!preserveAnchor || !startLayout) return viewport
  const anchorId = chooseAnchorId(startLayout, nextLayout)
  if (!anchorId) return viewport
  const before = resolveAnchorCenter(startLayout, anchorId)
  const after = resolveAnchorCenter(nextLayout, anchorId)
  return keepAnchorStable(viewport, before, after)
}

function commitViewportSilently(nextViewport) {
  const next = normalizeViewport(nextViewport, viewportOptions(props.options))
  if (props.viewport === null) internalViewport = next
}

function finishLayout(nextLayout, nextViewport) {
  layout = nextLayout
  settledLayout = nextLayout
  commitViewportSilently(nextViewport)
  renderCurrent(layout, currentViewport())
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
    renderCurrent(layout, currentViewport())

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
  const nextLayout = computeLayout(props.graph, {
    direction: props.layoutDirection,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
    groupThreshold: props.options?.groupThreshold,
    groupStates: new Map(Object.entries(currentGroupStates())),
  })

  const startLayout = lastRenderedLayout || settledLayout || layout
  const startViewport = lastRenderedViewport || currentViewport()
  const nextViewport = targetViewportFor(startLayout, nextLayout, preserveAnchor)
  const canAnimate =
    animate &&
    typeof requestAnimationFrame === 'function' &&
    typeof cancelAnimationFrame === 'function'

  cancelAnimation()

  if (!startLayout || !canAnimate || ANIMATION_DURATION_MS <= 0) {
    finishLayout(nextLayout, nextViewport)
    return
  }

  commitViewportSilently(startViewport)
  startAnimation(startLayout, nextLayout, startViewport, nextViewport)
}

function setSelected(ids) {
  const nextIds = [...ids]
  if (props.selectedIds === null) internalSelectedIds = nextIds
  emit('select', nextIds)
  renderCurrent()
}

function isAdditiveSelection(event) {
  return event.shiftKey || event.metaKey || event.ctrlKey
}

function screenPointFromEvent(event) {
  const rect = canvasRef.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function pointFromEvent(event) {
  return screenToWorld(screenPointFromEvent(event), currentViewport())
}

function ghostRectForPoint(worldPoint) {
  const worldRect = {
    x: worldPoint.x - GROUP.itemW / 2,
    y: worldPoint.y - GROUP.itemH / 2,
    width: GROUP.itemW,
    height: GROUP.itemH,
  }
  return worldRectToScreen(worldRect, currentViewport())
}

function scrollbarMetrics(group) {
  const trackHeight = group.height - GROUP.header
  const thumbHeight = (group.height / group.contentHeight) * trackHeight
  const maxScroll = Math.max(0, group.contentHeight - group.height)
  const maxThumbOffset = Math.max(1, trackHeight - thumbHeight)
  const thumbOffset = maxScroll > 0 ? (group.scrollTop / maxScroll) * maxThumbOffset : 0
  return {
    trackX: group.x + group.width - SCROLLBAR_WIDTH,
    trackY: group.y + GROUP.header,
    trackHeight,
    thumbHeight,
    thumbY: group.y + GROUP.header + thumbOffset,
    maxScroll,
    maxThumbOffset,
  }
}

function hitScrollbarThumb(point) {
  if (!layout) return null
  for (const group of layout.groups) {
    if (!group.overflowY) continue
    const metrics = scrollbarMetrics(group)
    const withinX = point.x >= metrics.trackX && point.x <= metrics.trackX + SCROLLBAR_WIDTH
    const withinY = point.y >= metrics.thumbY && point.y <= metrics.thumbY + metrics.thumbHeight
    if (withinX && withinY) return { group, metrics }
  }
  return null
}

function cancelAutoScrollLoop() {
  if (dragState && dragState.scrollRafId !== null) {
    cancelAnimationFrame(dragState.scrollRafId)
    dragState.scrollRafId = null
  }
}

function updateDragInsertion(group, worldPoint, { animateShift = true } = {}) {
  const restGroup = { ...group, children: group.children.filter((id) => id !== dragState.childId) }
  const nextIndex = groupGridIndexAt(restGroup, worldPoint)
  const autoScrolling = shouldAutoScroll(group)
  const canAnimateShift = animateShift && !autoScrolling

  if (nextIndex !== dragState.insertIndex) {
    if (canAnimateShift) scheduleDragShift(group, nextIndex)
    else clearDragShiftAnimation()
    dragState.insertIndex = nextIndex
  } else if (autoScrolling) {
    clearDragShiftAnimation()
  }

  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
}

function startAutoScrollLoop() {
  const tick = (time) => {
    if (!dragState || !dragState.dragging) return
    const group = layout.groups.find((g) => g.id === dragState.groupId)
    if (group && dragState.ghostWorldPoint) {
      const delta = groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y)
      if (delta !== 0) {
        group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)
        clearDragShiftAnimation()
        updateDragInsertion(group, dragState.ghostWorldPoint, { animateShift: false })
      }
    }
    renderCurrent()
    const timestamp = time ?? now()
    const scrolling = shouldAutoScroll(group)
    if (scrolling || dragShiftActive(timestamp)) dragState.scrollRafId = requestAnimationFrame(tick)
    else dragState.scrollRafId = null
  }
  dragState.scrollRafId = requestAnimationFrame(tick)
}

function ensureAutoScrollLoop() {
  if (!dragState?.dragging || dragState.scrollRafId != null) return
  const group = layout?.groups.find((g) => g.id === dragState.groupId)
  if (!shouldAutoScroll(group) && !dragShiftActive()) return
  startAutoScrollLoop()
}

function cancelDrag() {
  if (!dragState) return
  cancelAutoScrollLoop()
  cancelDragShiftLoop()
  dragState = null
  renderCurrent()
}

function cancelScrollbarDrag() {
  if (!scrollbarDragState) return
  const group = layout?.groups.find((g) => g.id === scrollbarDragState.groupId)
  if (group && props.groupStates === null) group.scrollTop = scrollbarDragState.startScrollTop
  hoveredScrollbarGroupId = null
  scrollbarDragState = null
  if (props.groupStates !== null) updateLayout({ animate: false, preserveAnchor: false })
  else renderCurrent()
}

function cancelPan() {
  panState = null
}

function cancelMarquee() {
  marqueeState = null
}

function cancelPointerInteractions() {
  cancelDrag()
  cancelScrollbarDrag()
  cancelPan()
  cancelMarquee()
}

function updateScrollbarHover(groupId) {
  if (hoveredScrollbarGroupId === groupId) return
  hoveredScrollbarGroupId = groupId
  renderCurrent()
}

function clearScrollbarHover() {
  updateScrollbarHover(null)
}

function handlePointerDown(event) {
  if (!layout) return
  canvasRef.value.focus?.()
  const point = pointFromEvent(event)
  const scrollbarHit = hitScrollbarThumb(point)
  if (scrollbarHit) {
    canvasRef.value.setPointerCapture?.(event.pointerId)
    updateScrollbarHover(scrollbarHit.group.id)
    scrollbarDragState = {
      groupId: scrollbarHit.group.id,
      startScreenY: event.clientY,
      startScrollTop: scrollbarHit.group.scrollTop,
      metrics: scrollbarHit.metrics,
    }
    return
  }

  const hit = hitTest(layout, point)

  if (hit?.type === 'group' && hit.zone === 'header') {
    const group = layout.groups.find((g) => g.id === hit.id)
    updateGroupState(hit.id, { expanded: !group.expanded })
    updateLayout()
    return
  }

  if (hit?.type === 'group' && hit.zone === 'item') {
    canvasRef.value.setPointerCapture?.(event.pointerId)
    dragState = {
      groupId: hit.id,
      childId: hit.childId,
      additive: isAdditiveSelection(event),
      startScreen: { x: event.clientX, y: event.clientY },
      dragging: false,
      insertIndex: 0,
      ghostWorldPoint: null,
      ghostScreenRect: null,
      scrollRafId: null,
      shiftFromById: null,
      shiftToById: null,
      shiftStartedAt: null,
      slotFadeStartedAt: null,
      shiftRafId: null,
    }
    return
  }

  if (!hit) {
    settleAnimation()
    canvasRef.value.setPointerCapture?.(event.pointerId)
    if (event.shiftKey) {
      const startScreen = screenPointFromEvent(event)
      marqueeState = {
        pointerId: event.pointerId,
        startScreen,
        rect: { x: startScreen.x, y: startScreen.y, width: 0, height: 0 },
        active: false,
      }
      renderCurrent()
      return
    }
    setSelected([])
    panState = {
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startViewport: currentViewport(),
      moved: false,
    }
    return
  }

  setSelected(applySelectionClick(currentSelectedIds(), hit.id, { additive: isAdditiveSelection(event) }))
}

function handlePointerMove(event) {
  if (scrollbarDragState) {
    const group = layout.groups.find((g) => g.id === scrollbarDragState.groupId)
    if (!group) return
    const deltaScreenY = event.clientY - scrollbarDragState.startScreenY
    const viewport = currentViewport()
    const scrollDelta =
      (deltaScreenY / (scrollbarDragState.metrics.maxThumbOffset * viewport.scale)) *
      scrollbarDragState.metrics.maxScroll
    const rawScrollTop = scrollbarDragState.startScrollTop + scrollDelta
    const nextScrollTop = clampGroupScroll(group, rawScrollTop)
    group.scrollTop = nextScrollTop
    renderCurrent()
    return
  }

  if (marqueeState) {
    const screenPoint = screenPointFromEvent(event)
    marqueeState.rect = {
      x: marqueeState.startScreen.x,
      y: marqueeState.startScreen.y,
      width: screenPoint.x - marqueeState.startScreen.x,
      height: screenPoint.y - marqueeState.startScreen.y,
    }
    marqueeState.active = true
    renderCurrent()
    return
  }

  if (panState) {
    const delta = {
      x: event.clientX - panState.startScreen.x,
      y: event.clientY - panState.startScreen.y,
    }
    panState.moved = panState.moved || delta.x !== 0 || delta.y !== 0
    applyViewport(panViewportBy(panState.startViewport, delta, viewportOptions(props.options)))
    return
  }

  if (!dragState) {
    const scrollbarHit = hitScrollbarThumb(pointFromEvent(event))
    updateScrollbarHover(scrollbarHit?.group.id ?? null)
    return
  }
  const screenPoint = { x: event.clientX, y: event.clientY }
  const group = layout.groups.find((g) => g.id === dragState.groupId)
  if (!group) return
  const worldPoint = pointFromEvent(event)

  if (!dragState.dragging) {
    if (!exceedsDragThreshold(dragState.startScreen, screenPoint)) return
    dragState.dragging = true
    updateDragInsertion(group, worldPoint)
    beginDragVisuals(group)
    ensureAutoScrollLoop()
  } else {
    updateDragInsertion(group, worldPoint)
  }

  renderCurrent()
  ensureAutoScrollLoop()
  if (dragShiftActive()) ensureDragShiftLoop()
}

function handlePointerUp() {
  if (marqueeState) {
    const ids = marqueeState.active ? idsInSelectionRect(layout, marqueeState.rect, currentViewport()) : []
    marqueeState = null
    setSelected(ids)
    return
  }

  if (panState) {
    panState = null
    return
  }

  if (scrollbarDragState) {
    const group = layout.groups.find((g) => g.id === scrollbarDragState.groupId)
    if (group) {
      updateGroupState(group.id, { scrollTop: group.scrollTop })
      if (props.groupStates !== null) updateLayout({ animate: false, preserveAnchor: false })
      else renderCurrent()
    }
    scrollbarDragState = null
    return
  }

  if (!dragState) return

  if (dragState.dragging) {
    cancelAutoScrollLoop()
    cancelDragShiftLoop()
    const group = layout.groups.find((g) => g.id === dragState.groupId)
    if (group) {
      const parent = props.graph.nodes.get(group.parentId)
      const index = groupInsertIndexToParentIndex(parent, group, dragState.childId, dragState.insertIndex)
      reorderGroupChild(props.graph, group.parentId, dragState.childId, index)
      updateGroupState(group.id, { scrollTop: group.scrollTop })
      updateLayout()
      emit('group-reorder', { groupId: group.id, childId: dragState.childId, index })
      emit('change', props.graph)
    }
  } else {
    setSelected(applySelectionClick(currentSelectedIds(), dragState.childId, { additive: dragState.additive }))
  }

  dragState = null
}

function handleWheel(event) {
  if (!layout) return
  if (dragState || scrollbarDragState || panState) return
  const viewport = currentViewport()
  const screenPoint = screenPointFromEvent(event)
  const point = screenToWorld(screenPoint, viewport)
  const hit = hitTest(layout, point)
  if (hit?.type === 'group') {
    const group = layout.groups.find((g) => g.id === hit.id)
    if (group?.overflowY) {
      event.preventDefault()
      const rawScrollTop = group.scrollTop + event.deltaY
      const nextScrollTop = clampGroupScroll(group, rawScrollTop)
      if (props.groupStates === null) group.scrollTop = nextScrollTop
      updateGroupState(group.id, { scrollTop: nextScrollTop })
      if (props.groupStates !== null) updateLayout({ animate: false, preserveAnchor: false })
      else renderCurrent()
      return
    }
  }

  event.preventDefault()
  settleAnimation()
  const nextViewport = zoomViewportAt(viewport, screenPoint, event.deltaY, viewportOptions(props.options))
  applyViewport(nextViewport)
}

function handleKeyDown(event) {
  if (event.key !== 'Escape') return
  if (currentSelectedIds().length === 0) return
  event.preventDefault()
  setSelected([])
}

function handleDragOver(event) {
  event.preventDefault()
}

function handleDrop(event) {
  event.preventDefault()
  settleAnimation()
  if (!layout) return
  const raw = event.dataTransfer.getData('application/json')
  if (!raw) return
  const resource = JSON.parse(raw)

  const point = pointFromEvent(event)
  const selected = currentSelectedIds()
  const parentId = selected[0] ?? props.graph.rootIds[0]
  const parent = props.graph.nodes.get(parentId)
  if (!parent) return

  const index = findInsertionIndex(props.graph, layout, parentId, point, props.layoutDirection)
  const id = `res-${resource.id}-${Date.now()}`
  props.graph.nodes.set(id, { id, label: resource.label, parentId, children: [] })
  parent.children.splice(index, 0, id)

  updateLayout()
  emit('node-drop', { resource, parentId, index })
  emit('change', props.graph)
}

function syncCanvasSize() {
  const container = containerRef.value
  const canvas = canvasRef.value
  if (!container || !canvas) return
  cssWidth = container.clientWidth
  cssHeight = container.clientHeight
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  // setTransform 而不是 scale：避免每次 resize 后缩放重复叠加。
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

onMounted(() => {
  const canvas = canvasRef.value
  ctx = canvas.getContext('2d')
  syncCanvasSize()
  resizeObserver = new ResizeObserver(() => {
    syncCanvasSize()
    updateLayout({ animate: false, preserveAnchor: false })
  })
  resizeObserver.observe(containerRef.value)
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerleave', clearScrollbarHover)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointercancel', cancelPointerInteractions)
  canvas.addEventListener('lostpointercapture', cancelPointerInteractions)
  canvas.addEventListener('keydown', handleKeyDown)
  canvas.addEventListener('wheel', handleWheel, { passive: false })
  canvas.addEventListener('dragover', handleDragOver)
  canvas.addEventListener('drop', handleDrop)
  updateLayout({ animate: false, preserveAnchor: false })
})

onUnmounted(() => {
  const canvas = canvasRef.value
  cancelAnimation()
  cancelPointerInteractions()
  if (canvas) {
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('pointerleave', clearScrollbarHover)
    canvas.removeEventListener('pointerup', handlePointerUp)
    canvas.removeEventListener('pointercancel', cancelPointerInteractions)
    canvas.removeEventListener('lostpointercapture', cancelPointerInteractions)
    canvas.removeEventListener('keydown', handleKeyDown)
    canvas.removeEventListener('wheel', handleWheel)
    canvas.removeEventListener('dragover', handleDragOver)
    canvas.removeEventListener('drop', handleDrop)
  }
  if (resizeObserver) resizeObserver.disconnect()
})

watch(() => props.layoutDirection, () => updateLayout())
watch(() => props.graph, () => updateLayout())
watch(() => props.selectedIds, () => renderCurrent())
watch(() => props.groupStates, () => updateLayout())
watch(() => props.viewport, () => renderCurrent())
watch(() => props.options, () => updateLayout())
</script>

<template>
  <div class="minimap">
    <ResourceTree class="minimap-resources" :resources="resources" />
    <div ref="containerRef" class="minimap-canvas-container">
      <canvas ref="canvasRef" tabindex="0"></canvas>
    </div>
  </div>
</template>

<style scoped>
.minimap {
  display: flex;
  width: 100%;
  height: 100%;
}
.minimap-resources {
  flex: 0 0 220px;
  overflow-y: auto;
  border-right: 1px solid #1b2530;
}
.minimap-canvas-container {
  flex: 1 1 auto;
  position: relative;
}
.minimap-canvas-container canvas {
  display: block;
}
</style>
