<script setup>
// Phase 1 Vue 组件壳骨架：挂载真实 canvas、DPR 适配、ResizeObserver 驱动的按需重渲染。
// 分组框命中检测细分、框内拖拽换位、滚轮滚动、展开折叠点击见 Phase 2 切片3。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
// 和 docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md
import { ref, watch, onMounted, onUnmounted } from 'vue'
import {
  computeLayout,
  keepAnchorStable,
  GROUP,
  clampGroupScroll,
  childRectInGroup,
  locateChildGroup,
  scrollTopToReveal,
} from './layout.js'
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
  centerViewportOn,
  clampScale,
  fitViewportToBounds,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  tweenViewport,
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
  resolveDropTarget,
} from './interaction.js'
import { createGraphOperationManager, captureSubtreeSnapshot } from './graph-operations.js'
import { deserializeGraph, serializeGraph } from './graph-serialization.js'
import {
  buildVirtualOrder,
  childWorldRectsById,
  currentShiftRects,
  dragShiftEasedProgress,
  dragShiftProgress,
} from './drag-transition.js'
import {
  applySelectionClick,
  applySelectionSet,
  buildSelectionRelations,
  idsInSelectionRect,
  normalizeRect,
} from './selection.js'
import { searchNodes } from './search.js'
import Overview from './Overview.vue'
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
  readonly: { type: Boolean, default: false },
  beforeNodeDrop: { type: Function, default: null },
  beforeGroupReorder: { type: Function, default: null },
  beforeDelete: { type: Function, default: null },
  beforeCopy: { type: Function, default: null },
  beforeImport: { type: Function, default: null },
  beforeNodeMove: { type: Function, default: null },
  beforePaste: { type: Function, default: null },
})

const emit = defineEmits([
  'select',
  'node-drop',
  'change',
  'group-state-change',
  'group-reorder',
  'viewport-change',
  'search',
  'delete',
  'copy',
  'import',
  'export',
  'paste',
  'node-move',
])

const containerRef = ref(null)
const canvasRef = ref(null)
const overviewRef = ref(null)
const searchKeyword = ref('')
const searchMatches = ref([])
const searchCurrentIndex = ref(-1)

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
let activeViewportTween = null
let viewportTweenFrameId = null
let operationManager = null
let clipboard = null

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
  cancelPointerInteractions()

  const next = normalizeViewport(toViewport, viewportOptions(props.options))
  const fromViewport = currentViewport()
  if (sameViewport(fromViewport, next)) return

  if (props.viewport !== null) {
    emit('viewport-change', next)
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
      emit('viewport-change', finalViewport)
      return
    }
    internalViewport = tweenViewport(activeViewportTween.fromViewport, activeViewportTween.toViewport, progress)
    renderCurrent(layout, internalViewport)
    viewportTweenFrameId = requestAnimationFrame(tick)
  }
  viewportTweenFrameId = requestAnimationFrame(tick)
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
  const timestamp = now()
  const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
  if (!group) {
    return {
      groupId: null,
      order: null,
      draggingChildId: dragState.nodeId,
      ghostRect: dragState.ghostScreenRect,
      childRectsById: null,
      dropSlotOpacity: 1,
    }
  }
  const order = buildVirtualOrder(group.children, dragState.nodeId, dragState.insertIndex)
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
    draggingChildId: dragState.nodeId,
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

// hitTest 对分组框 item 区的判定基于 visibleGroupChildren（受当前 scrollTop 窗口裁剪），
// 自动滚动连续推进时，固定的 ghostWorldPoint 会在内容下面"溜走"，落到窗口外的空白行——
// hitTest 因此把 zone 误判成 body，resolveDropTarget 跟着判定为 invalid，自动滚动循环
// 在还没真正滚到底之前就被掐断。只要指针仍在同一个分组框的题身体范围内（表头之外），
// 就继续认定该分组为目标，直接用不受窗口裁剪的 groupGridIndexAt 重算插入位置，
// 不依赖 hitTest 的可见窗口判断。
function withinGroupBody(group, point) {
  return (
    point.x >= group.x &&
    point.x <= group.x + group.width &&
    point.y >= group.y + GROUP.header &&
    point.y <= group.y + group.height
  )
}

function updateDragTarget(worldPoint) {
  const previousGroupId = dragState.targetGroupId
  const previousIndex = dragState.insertIndex

  const activeGroup = previousGroupId ? layout.groups.find((g) => g.id === previousGroupId) : null
  const target =
    activeGroup && withinGroupBody(activeGroup, worldPoint)
      ? {
          valid: true,
          parentId: activeGroup.parentId,
          group: activeGroup,
          insertIndex: groupGridIndexAt(
            { ...activeGroup, children: activeGroup.children.filter((id) => id !== dragState.nodeId) },
            worldPoint,
          ),
        }
      : resolveDropTarget(props.graph, layout, worldPoint, dragState.nodeId)

  if (!target.valid) {
    clearDragShiftAnimation()
    dragState.targetParentId = null
    dragState.targetGroupId = null
    dragState.insertIndex = 0
  } else if (target.group) {
    const autoScrolling = shouldAutoScroll(target.group)
    const groupChanged = previousGroupId !== target.group.id
    const indexChanged = previousIndex !== target.insertIndex
    if (!autoScrolling && (groupChanged || indexChanged)) {
      scheduleDragShift(target.group, target.insertIndex, { reset: groupChanged })
    } else if (autoScrolling) {
      clearDragShiftAnimation()
    }
    dragState.targetParentId = target.parentId
    dragState.targetGroupId = target.group.id
    dragState.insertIndex = target.insertIndex
  } else {
    clearDragShiftAnimation()
    dragState.targetParentId = target.parentId
    dragState.targetGroupId = null
    dragState.insertIndex = 0
  }

  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
}

function scheduleDragShift(group, insertIndex, { reset = false } = {}) {
  const timestamp = now()
  const fromById =
    !reset && dragState.shiftFromById && dragState.shiftToById && dragState.shiftStartedAt != null
      ? currentShiftRects(
          dragState.shiftFromById,
          dragState.shiftToById,
          dragState.shiftStartedAt,
          DRAG_SHIFT_DURATION_MS,
          timestamp,
        )
      : childWorldRectsById(group, group.children)
  const toOrder = buildVirtualOrder(group.children, dragState.nodeId, insertIndex)
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
  overviewRef.value?.render({
    layout: currentLayout,
    viewport: renderViewport,
    mainWidth: cssWidth,
    mainHeight: cssHeight,
    theme: props.theme || defaultTheme,
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

function startAutoScrollLoop() {
  const tick = (time) => {
    if (!dragState || !dragState.dragging) return
    const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
    if (group && dragState.ghostWorldPoint) {
      const delta = groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y)
      if (delta !== 0) {
        group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)
        clearDragShiftAnimation()
        updateDragTarget(dragState.ghostWorldPoint)
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
  const group = dragState.targetGroupId ? layout?.groups.find((g) => g.id === dragState.targetGroupId) : null
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

  if ((hit?.type === 'group' && hit.zone === 'item') || hit?.type === 'node') {
    const nodeId = hit.type === 'group' ? hit.childId : hit.id
    const node = props.graph.nodes.get(nodeId)
    if (!node) return
    canvasRef.value.setPointerCapture?.(event.pointerId)
    dragState = {
      nodeId,
      fromParentId: node.parentId,
      additive: isAdditiveSelection(event),
      startScreen: { x: event.clientX, y: event.clientY },
      dragging: false,
      targetParentId: null,
      targetGroupId: null,
      insertIndex: 0,
      ghostWorldPoint: null,
      ghostScreenRect: null,
      lastScreenPoint: null,
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
    if (event.metaKey || event.ctrlKey) {
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
  const worldPoint = pointFromEvent(event)
  dragState.lastScreenPoint = screenPoint

  if (!dragState.dragging) {
    if (!exceedsDragThreshold(dragState.startScreen, screenPoint)) return
    dragState.dragging = true
    dragState.slotFadeStartedAt = now()
    ensureAutoScrollLoop()
  }

  updateDragTarget(worldPoint)
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
    if (dragState.targetParentId) {
      const parent = props.graph.nodes.get(dragState.targetParentId)
      const targetGroup = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
      const index = targetGroup
        ? groupInsertIndexToParentIndex(parent, targetGroup, dragState.nodeId, dragState.insertIndex)
        : parent.children.length

      if (dragState.targetParentId === dragState.fromParentId) {
        const operation = {
          type: 'reorder-group-child',
          payload: {
            groupId: dragState.targetGroupId,
            parentId: dragState.targetParentId,
            childId: dragState.nodeId,
            index,
          },
        }
        const result = graphOperations().apply(operation, {
          readonly: props.readonly,
          before: props.beforeGroupReorder,
        })
        if (result.applied) {
          if (targetGroup) updateGroupState(targetGroup.id, { scrollTop: targetGroup.scrollTop })
          updateLayout()
          emit('group-reorder', {
            groupId: dragState.targetGroupId,
            childId: dragState.nodeId,
            index: result.operation.payload.index,
          })
          emitChange(result)
        } else {
          renderCurrent()
        }
      } else {
        const operation = {
          type: 'move-node',
          payload: { nodeId: dragState.nodeId, toParentId: dragState.targetParentId, index },
        }
        const result = graphOperations().apply(operation, {
          readonly: props.readonly,
          before: props.beforeNodeMove,
        })
        if (result.applied) {
          updateLayout()
          emit('node-move', {
            nodeId: dragState.nodeId,
            fromParentId: dragState.fromParentId,
            toParentId: dragState.targetParentId,
            index: result.operation.payload.index,
          })
          emitChange(result)
        } else {
          renderCurrent()
        }
      }
    } else {
      renderCurrent()
    }
  } else {
    setSelected(applySelectionClick(currentSelectedIds(), dragState.nodeId, { additive: dragState.additive }))
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
  if (event.key === 'Escape') {
    if (currentSelectedIds().length === 0) return
    event.preventDefault()
    setSelected([])
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    copySelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
    event.preventDefault()
    paste()
  }
}

function handleDragOver(event) {
  event.preventDefault()
}

function graphOperations() {
  if (!operationManager) operationManager = createGraphOperationManager(props.graph)
  return operationManager
}

function emitChange(result) {
  if (!result.applied) return
  emit('change', {
    type: result.type,
    operation: result.operation,
    previousGraph: result.previousGraph,
    nextGraph: result.nextGraph,
    reason: result.reason,
  })
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
  const operation = {
    type: 'drop-node',
    payload: { resource, parentId, index, id },
  }
  const result = graphOperations().apply(operation, {
    readonly: props.readonly,
    before: props.beforeNodeDrop,
  })
  if (!result.applied) return

  updateLayout()
  emit('node-drop', { resource, parentId, index: result.operation.payload.index })
  emitChange(result)
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

// 跟 resolveTargetRect 不同：这个版本会先把 id 所在分组的 scrollTop 滚到能看见它的位置
// （副作用），只给 centerOnNode 用。centerOnSelection 故意不用这个——多个选中 id 落在
// 同一分组时，逐个滚动会互相覆盖 scrollTop，让已经读出的矩形过期，包围盒数学失真。
function resolveCenterTarget(id) {
  if (!layout) return null
  const located = locateChildGroup(layout, id)
  if (located) {
    const scrollTop = scrollTopToReveal(located.group, located.index)
    if (props.groupStates === null) located.group.scrollTop = scrollTop
    updateGroupState(located.group.id, { scrollTop })
    if (props.groupStates !== null) updateLayout({ animate: false, preserveAnchor: false })
  }
  const rect = resolveTargetRect(id)
  return rect ? rectCenter(rect) : null
}

function fitToScreen() {
  if (!layout) return
  runViewportTween(fitViewportToBounds(layout.bounds, cssWidth, cssHeight, props.options))
}

function centerOnNode(id) {
  const target = resolveCenterTarget(id)
  if (!target) return
  runViewportTween(centerViewportOn(target, currentViewport(), cssWidth, cssHeight))
}

function centerOnSelection() {
  const ids = currentSelectedIds()
  if (ids.length === 0) return
  const rects = ids.map(resolveTargetRect).filter(Boolean)
  if (rects.length === 0) return
  const minX = Math.min(...rects.map((r) => r.x))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxY = Math.max(...rects.map((r) => r.y + r.height))
  const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  runViewportTween(centerViewportOn(target, currentViewport(), cssWidth, cssHeight))
}

function zoomTo(scale, center = null) {
  const viewport = currentViewport()
  const worldCenter = center ?? screenToWorld({ x: cssWidth / 2, y: cssHeight / 2 }, viewport)
  const nextScale = clampScale(scale, viewportOptions(props.options))
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

function getViewport() {
  return currentViewport()
}

function select(ids, mode = 'replace') {
  setSelected(applySelectionSet(currentSelectedIds(), ids, mode))
}

function clearSelection() {
  setSelected([])
}

function jumpToSearchResult(id) {
  centerOnNode(id)
  select([id])
}

function search(keyword) {
  searchKeyword.value = keyword
  const matches = searchNodes(props.graph, keyword)
  searchMatches.value = matches
  searchCurrentIndex.value = matches.length > 0 ? 0 : -1
  if (matches.length > 0) jumpToSearchResult(matches[0])
  const payload = { keyword, matches, current: matches[0] ?? null }
  emit('search', payload)
  return payload
}

function searchNext() {
  if (searchMatches.value.length === 0) return
  searchCurrentIndex.value = (searchCurrentIndex.value + 1) % searchMatches.value.length
  const id = searchMatches.value[searchCurrentIndex.value]
  jumpToSearchResult(id)
  emit('search', { keyword: searchKeyword.value, matches: searchMatches.value, current: id })
}

function searchPrevious() {
  if (searchMatches.value.length === 0) return
  const length = searchMatches.value.length
  searchCurrentIndex.value = (searchCurrentIndex.value - 1 + length) % length
  const id = searchMatches.value[searchCurrentIndex.value]
  jumpToSearchResult(id)
  emit('search', { keyword: searchKeyword.value, matches: searchMatches.value, current: id })
}

function handleOverviewNavigate(worldPoint) {
  applyViewport(centerViewportOn(worldPoint, currentViewport(), cssWidth, cssHeight))
}

function undo() {
  const result = graphOperations().undo()
  if (result.applied) {
    updateLayout()
    emitChange(result)
  }
  return result
}

function redo() {
  const result = graphOperations().redo()
  if (result.applied) {
    updateLayout()
    emitChange(result)
  }
  return result
}

function canUndo() {
  return graphOperations().canUndo()
}

function canRedo() {
  return graphOperations().canRedo()
}

function selectedRealNodeIds() {
  if (!layout) return currentSelectedIds()
  const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
  const ids = []
  for (const id of currentSelectedIds()) {
    const group = groupsById.get(id)
    if (group) ids.push(...group.children)
    else ids.push(id)
  }
  return [...new Set(ids)]
}

function selectionAfterDeleting(deletedIds) {
  const deleted = new Set(deletedIds)
  return currentSelectedIds().filter((id) => !deleted.has(id))
}

function deleteSelection() {
  const ids = currentSelectedIds()
  const expandedIds = selectedRealNodeIds()
  const operation = { type: 'delete-nodes', payload: { ids, expandedIds } }
  const result = graphOperations().apply(operation, {
    readonly: props.readonly,
    before: props.beforeDelete,
  })
  if (!result.applied) return result

  updateLayout({ animate: false })
  setSelected(selectionAfterDeleting(result.operation.payload.deletedIds || []))
  emit('delete', { ids, deletedIds: result.operation.payload.deletedIds || [] })
  emitChange(result)
  return result
}

function copySelection() {
  const ids = currentSelectedIds()
  const expandedIds = selectedRealNodeIds()
  const payload = { ids, expandedIds }
  const unapplied = (reason) => ({
    applied: false,
    type: 'copy-selection',
    operation: { type: 'copy-selection', payload },
    inverse: null,
    previousGraph: props.graph,
    nextGraph: props.graph,
    reason,
  })

  if (expandedIds.length === 0) return unapplied('empty')
  if (props.beforeCopy && props.beforeCopy(payload) === false) return unapplied('blocked')

  clipboard = captureSubtreeSnapshot(props.graph, expandedIds)
  const capturedPayload = { ids, capturedIds: clipboard.nodes.map((node) => node.id) }
  emit('copy', capturedPayload)
  return {
    applied: true,
    type: 'copy-selection',
    operation: { type: 'copy-selection', payload: capturedPayload },
    inverse: null,
    previousGraph: props.graph,
    nextGraph: props.graph,
    reason: null,
  }
}

function pasteTargetId() {
  const id = currentSelectedIds()[0] ?? null
  if (!id || !layout) return id
  const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
  const group = groupsById.get(id)
  return group ? group.parentId : id
}

function nextPasteId(sourceId, usedIds) {
  let index = 1
  let id = `paste-${sourceId}-${index}`
  while (usedIds.has(id)) {
    index += 1
    id = `paste-${sourceId}-${index}`
  }
  usedIds.add(id)
  return id
}

function createPasteIdMap(snapshot) {
  const usedIds = new Set(props.graph.nodes.keys())
  const idMap = {}
  for (const node of snapshot.nodes) idMap[node.id] = nextPasteId(node.id, usedIds)
  return idMap
}

function paste() {
  const targetParentId = pasteTargetId()
  const snapshot = clipboard ?? { rootIds: [], nodes: [] }
  const idMap = createPasteIdMap(snapshot)
  const operation = { type: 'paste-nodes', payload: { targetParentId, snapshot, idMap } }
  const result = graphOperations().apply(operation, {
    readonly: props.readonly,
    before: props.beforePaste,
  })
  if (!result.applied) return result

  updateLayout()
  emit('paste', {
    targetParentId,
    pastedIds: result.operation.payload.pastedIds || [],
    idMap,
  })
  emitChange(result)
  return result
}

function exportGraph() {
  const graph = serializeGraph(props.graph)
  emit('export', { graph })
  return graph
}

function importGraph(data) {
  if (props.readonly) {
    return {
      applied: false,
      type: 'replace-graph',
      operation: { type: 'replace-graph', payload: { data } },
      inverse: null,
      previousGraph: props.graph,
      nextGraph: props.graph,
      reason: 'readonly',
    }
  }
  const parsed = deserializeGraph(data)
  if (!parsed.valid) {
    return {
      applied: false,
      type: 'replace-graph',
      operation: { type: 'replace-graph', payload: { data } },
      inverse: null,
      previousGraph: props.graph,
      nextGraph: props.graph,
      reason: parsed.reason,
    }
  }
  const operation = { type: 'replace-graph', payload: { graph: parsed.graph } }
  const result = graphOperations().apply(operation, {
    before: props.beforeImport,
  })
  if (!result.applied) return result

  updateLayout({ animate: false })
  setSelected([])
  emit('import', { graph: props.graph })
  emitChange(result)
  return result
}

defineExpose({
  fitToScreen,
  centerOnNode,
  centerOnSelection,
  zoomTo,
  setViewport,
  getViewport,
  select,
  clearSelection,
  search,
  searchNext,
  searchPrevious,
  undo,
  redo,
  canUndo,
  canRedo,
  deleteSelection,
  copySelection,
  paste,
  exportGraph,
  importGraph,
})

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
  cancelViewportTween()
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
watch(
  () => props.graph,
  () => {
    operationManager = createGraphOperationManager(props.graph)
    updateLayout()
  },
)
watch(() => props.selectedIds, () => renderCurrent())
watch(() => props.groupStates, () => updateLayout())
watch(() => props.viewport, () => renderCurrent())
watch(() => props.options, () => updateLayout())
</script>

<template>
  <div class="minimap">
    <ResourceTree class="minimap-resources" :resources="resources" />
    <div ref="containerRef" class="minimap-canvas-container">
      <div class="minimap-toolbar" aria-label="画布工具栏">
        <button class="minimap-toolbar-button is-primary" type="button" aria-label="返回">◀</button>
        <span class="minimap-toolbar-separator"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="撤销" @click="undo">↶</button>
        <button class="minimap-toolbar-button" type="button" aria-label="重做" @click="redo">↷</button>
        <span class="minimap-toolbar-separator"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="选择">□</button>
        <button class="minimap-toolbar-button" type="button" aria-label="复制" @click="copySelection">⌘</button>
        <button class="minimap-toolbar-button" type="button" aria-label="粘贴" @click="paste">⎘</button>
        <button class="minimap-toolbar-button" type="button" aria-label="删除" @click="deleteSelection">⌫</button>
        <button class="minimap-toolbar-button" type="button" aria-label="框选">▣</button>
        <span class="minimap-toolbar-separator"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="定位">◎</button>
        <button class="minimap-toolbar-button" type="button" aria-label="缩小">⊖</button>
        <button class="minimap-toolbar-button" type="button" aria-label="放大">⊕</button>
        <span class="minimap-toolbar-spacer"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="展开">↗</button>
        <button class="minimap-toolbar-button is-accent" type="button" aria-label="列表">▦</button>
        <button class="minimap-toolbar-button" type="button" aria-label="信息">ⓘ</button>
      </div>
      <canvas
        ref="canvasRef"
        :class="{ 'is-active-border-enabled': options?.enableActiveBorder === true }"
        tabindex="0"
      ></canvas>
      <div v-if="options?.enableSearch !== false" class="minimap-search">
        <input
          :value="searchKeyword"
          class="minimap-search-input"
          placeholder="搜索节点..."
          @input="search($event.target.value)"
          @keydown.enter="searchNext"
        />
        <span class="minimap-search-count">{{ searchMatches.length ? `${searchCurrentIndex + 1}/${searchMatches.length}` : '0/0' }}</span>
        <button
          class="minimap-search-btn minimap-search-prev"
          :disabled="searchMatches.length === 0"
          @click="searchPrevious"
        >
          ‹
        </button>
        <button
          class="minimap-search-btn minimap-search-next"
          :disabled="searchMatches.length === 0"
          @click="searchNext"
        >
          ›
        </button>
      </div>
      <div v-if="options?.enableOverview !== false" class="minimap-overview-panel">
        <div class="minimap-overview-header">
          <span>MINIMAP</span>
          <span>拖入放置</span>
        </div>
        <Overview
          ref="overviewRef"
          class="minimap-overview"
          @navigate="handleOverviewNavigate"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.minimap {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 10px;
  padding: 8px;
  background: #0b0f14;
}
.minimap-resources {
  flex: 0 0 220px;
  overflow-y: auto;
}
.minimap-canvas-container {
  flex: 1 1 auto;
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid #252b34;
  border-radius: 10px;
  background: #0f1318;
}
.minimap-canvas-container canvas {
  display: block;
  outline: none;
}
.minimap-canvas-container canvas.is-active-border-enabled:focus {
  outline: 1px solid #3d9cff;
  outline-offset: -1px;
}
.minimap-toolbar {
  position: absolute;
  z-index: 3;
  top: 8px;
  left: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: rgba(22, 26, 32, 0.96);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
}
.minimap-toolbar-button {
  width: 28px;
  height: 28px;
  color: #9aa3af;
  background: transparent;
  border: 0;
  border-radius: 5px;
  font: 16px/1 system-ui, sans-serif;
}
.minimap-toolbar-button:hover:not(:disabled) {
  color: #d8dee8;
  background: #232930;
}
.minimap-toolbar-button:disabled {
  opacity: 0.45;
}
.minimap-toolbar-button.is-primary {
  color: #d8dee8;
}
.minimap-toolbar-button.is-accent {
  color: #2bdd7f;
}
.minimap-toolbar-separator {
  width: 1px;
  height: 24px;
  background: #2a3038;
}
.minimap-toolbar-spacer {
  flex: 1;
}
.minimap-search {
  position: absolute;
  z-index: 4;
  top: 68px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(18, 23, 29, 0.94);
  border: 1px solid #2a3038;
  border-radius: 7px;
}
.minimap-search-input {
  width: 150px;
  color: #d9e0ea;
  background: #0f141a;
  border: 1px solid #303741;
  border-radius: 5px;
  padding: 5px 7px;
  font-size: 12px;
}
.minimap-search-count {
  min-width: 36px;
  color: #87909c;
  font-size: 12px;
  text-align: center;
}
.minimap-search-btn {
  width: 22px;
  height: 22px;
  color: #cfd6df;
  background: #20262d;
  border: 1px solid #303741;
  border-radius: 4px;
}
.minimap-search-btn:disabled {
  opacity: 0.4;
}
.minimap-overview-panel {
  position: absolute;
  z-index: 4;
  right: 14px;
  bottom: 14px;
  padding: 8px;
  border: 1px solid #303741;
  border-radius: 9px;
  background: rgba(18, 23, 29, 0.92);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.38);
}
.minimap-overview-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  color: #68727f;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
}
.minimap-overview {
  display: block;
  overflow: hidden;
  border-radius: 5px;
}
.minimap-overview canvas {
  display: block;
  cursor: pointer;
}
</style>
