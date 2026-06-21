<script setup>
// Phase 1 Vue 组件壳骨架：挂载真实 canvas、DPR 适配、ResizeObserver 驱动的按需重渲染。
// 分组框命中检测细分、框内拖拽换位、滚轮滚动、展开折叠点击见 Phase 2 切片3。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
// 和 docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { GROUP, clampGroupScroll } from './layout.js'
import { worldRectToScreen } from './renderer.js'
import { createMinimapController } from './minimap-controller.js'
import { defaultTheme } from './theme.js'
import { screenToWorld } from './coords.js'
import { centerViewportOn, panViewportBy, viewportOptions, zoomViewportAt } from './viewport.js'
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
  resolveDropTarget,
  edgePanVelocity,
} from './interaction.js'
import {
  buildVirtualOrder,
  childWorldRectsById,
  currentShiftRects,
  dragShiftEasedProgress,
  dragShiftProgress,
} from './drag-transition.js'
import { applySelectionClick, idsInSelectionRect, normalizeRect } from './selection.js'
import Overview from './Overview.vue'
import ResourceTree from './ResourceTree.vue'

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
  contextMenuItems: { type: [Function, Array], default: null },
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
  'context-menu-action',
  'config-change',
])

const containerRef = ref(null)
const canvasRef = ref(null)
const overviewRef = ref(null)
const searchKeyword = ref('')
const searchMatches = ref([])
const searchCurrentIndex = ref(-1)
const contextMenuRef = ref(null)
const renderStats = ref(null)
const internalReadonly = ref(props.readonly)
const internalOptions = ref({ ...(props.options ?? {}) })
const effectiveReadonly = computed(() => internalReadonly.value)
const effectiveOptions = computed(() => ({
  enableSearch: true,
  enableOverview: true,
  enableActiveBorder: false,
  showGrid: true,
  showPerformance: false,
  hideTextDuringInteraction: false,
  ...internalOptions.value,
}))
const effectiveTheme = computed(() => {
  const baseTheme = props.theme || defaultTheme
  return {
    ...baseTheme,
    grid: {
      ...(baseTheme.grid || {}),
      visible: effectiveOptions.value.showGrid !== false,
    },
  }
})

let controller = null
let dragState = null
let scrollbarDragState = null
let panState = null
let marqueeState = null
let hoveredScrollbarGroupId = null
const contextMenuState = ref(null)

function syncConfigFromProps() {
  internalReadonly.value = props.readonly
  internalOptions.value = { ...(props.options ?? {}) }
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

function interactionRenderState() {
  const timestamp = now()
  if (!dragState || !dragState.dragging) {
    return {
      dragging: false,
      interacting: Boolean(panState || marqueeState?.active),
      groupDrag: null,
      selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
      groupScrollbarHoverId: hoveredScrollbarGroupId,
      attachPreview: null,
    }
  }
  const layout = controller.getLayout()
  const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
  let groupDrag
  if (!group) {
    groupDrag = {
      groupId: null,
      order: null,
      draggingChildId: dragState.nodeId,
      ghostRect: dragState.ghostScreenRect,
      childRectsById: null,
      dropSlotOpacity: 1,
    }
  } else {
    const order = buildVirtualOrder(group.children, dragState.nodeId, dragState.insertIndex)
    const autoScrolling = shouldAutoScroll(group)
    const childRectsById =
      !autoScrolling &&
      dragState.shiftFromById &&
      dragState.shiftToById &&
      dragState.shiftStartedAt != null
        ? currentShiftRects(dragState.shiftFromById, dragState.shiftToById, dragState.shiftStartedAt, DRAG_SHIFT_DURATION_MS, timestamp)
        : null
    const dropSlotOpacity =
      autoScrolling || dragState.slotFadeStartedAt == null
        ? 1
        : dragShiftEasedProgress(dragState.slotFadeStartedAt, DRAG_SHIFT_DURATION_MS, timestamp)
    groupDrag = { groupId: group.id, order, draggingChildId: dragState.nodeId, ghostRect: dragState.ghostScreenRect, childRectsById, dropSlotOpacity }
  }
  return {
    dragging: true,
    interacting: false,
    groupDrag,
    selectionRect: null,
    groupScrollbarHoverId: hoveredScrollbarGroupId,
    attachPreview: dragState.attachPreviewRect
      ? { rect: dragState.attachPreviewRect, parentRect: dragState.attachPreviewParentRect }
      : null,
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
    controller.renderCurrent()
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
  const layout = controller.getLayout()
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
          previewRect: null,
        }
      : resolveDropTarget(
          props.graph,
          layout,
          worldPoint,
          dragState.nodeId,
          props.layoutDirection,
          controller.getViewport().scale,
        )

  if (!target.valid) {
    clearDragShiftAnimation()
    dragState.targetParentId = null
    dragState.targetGroupId = null
    dragState.insertIndex = 0
    dragState.attachPreviewRect = null
    dragState.attachPreviewParentRect = null
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
    dragState.attachPreviewRect = null
    dragState.attachPreviewParentRect = null
  } else {
    clearDragShiftAnimation()
    dragState.targetParentId = target.parentId
    dragState.targetGroupId = null
    dragState.insertIndex = target.insertIndex
    dragState.attachPreviewRect = target.previewRect ?? null
    dragState.attachPreviewParentRect = target.previewRect ? layout.nodes.get(target.parentId) : null
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

function isAdditiveSelection(event) {
  return event.shiftKey || event.metaKey || event.ctrlKey
}

function ghostRectForPoint(worldPoint) {
  const worldRect = {
    x: worldPoint.x - GROUP.itemW / 2,
    y: worldPoint.y - GROUP.itemH / 2,
    width: GROUP.itemW,
    height: GROUP.itemH,
  }
  return worldRectToScreen(worldRect, controller.getViewport())
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
  const layout = controller.getLayout()
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
    const layout = controller.getLayout()
    const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
    if (group && dragState.ghostWorldPoint) {
      const delta = groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y)
      if (delta !== 0) {
        group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)
        clearDragShiftAnimation()
        updateDragTarget(dragState.ghostWorldPoint)
      }
    }
    controller.renderCurrent()
    const timestamp = time ?? now()
    const scrolling = shouldAutoScroll(group)
    if (scrolling || dragShiftActive(timestamp)) dragState.scrollRafId = requestAnimationFrame(tick)
    else dragState.scrollRafId = null
  }
  dragState.scrollRafId = requestAnimationFrame(tick)
}

function ensureAutoScrollLoop() {
  if (!dragState?.dragging || dragState.scrollRafId != null) return
  const layout = controller.getLayout()
  const group = dragState.targetGroupId ? layout?.groups.find((g) => g.id === dragState.targetGroupId) : null
  if (!shouldAutoScroll(group) && !dragShiftActive()) return
  startAutoScrollLoop()
}

function edgePanActive() {
  if (!dragState?.dragging || !dragState.lastScreenPoint) return false
  const { width, height } = controller.getCssSize()
  const velocity = edgePanVelocity(dragState.lastScreenPoint, width, height)
  return velocity.x !== 0 || velocity.y !== 0
}

function cancelEdgePanLoop() {
  if (dragState && dragState.edgePanRafId !== null) {
    cancelAnimationFrame(dragState.edgePanRafId)
    dragState.edgePanRafId = null
  }
}

function ensureEdgePanLoop() {
  if (!dragState?.dragging || dragState.edgePanRafId != null || !edgePanActive()) return
  const tick = () => {
    if (!dragState?.dragging) return
    const { width, height } = controller.getCssSize()
    const velocity = edgePanVelocity(dragState.lastScreenPoint, width, height)
    if (velocity.x !== 0 || velocity.y !== 0) {
      controller.applyViewport(panViewportBy(controller.getViewport(), { x: -velocity.x, y: -velocity.y }, viewportOptions(props.options)))
      updateDragTarget(screenToWorld(dragState.lastScreenPoint, controller.getViewport()))
      controller.renderCurrent()
    }
    if (edgePanActive()) dragState.edgePanRafId = requestAnimationFrame(tick)
    else dragState.edgePanRafId = null
  }
  dragState.edgePanRafId = requestAnimationFrame(tick)
}

function cancelDrag() {
  if (!dragState) return
  cancelAutoScrollLoop()
  cancelDragShiftLoop()
  cancelEdgePanLoop()
  dragState = null
  controller.renderCurrent()
}

function cancelScrollbarDrag() {
  if (!scrollbarDragState) return
  const group = controller.getLayout()?.groups.find((g) => g.id === scrollbarDragState.groupId)
  if (group && props.groupStates === null) group.scrollTop = scrollbarDragState.startScrollTop
  hoveredScrollbarGroupId = null
  scrollbarDragState = null
  if (props.groupStates !== null) controller.updateLayout({ animate: false, preserveAnchor: false })
  else controller.renderCurrent()
}

function cancelPan() {
  panState = null
}

function cancelMarquee() {
  marqueeState = null
}

function cancelPointerInteractions() {
  controller.cancelScheduledRender()
  cancelDrag()
  cancelScrollbarDrag()
  cancelPan()
  cancelMarquee()
}

function updateScrollbarHover(groupId) {
  if (hoveredScrollbarGroupId === groupId) return
  hoveredScrollbarGroupId = groupId
  controller.renderCurrent()
}

function clearScrollbarHover() {
  updateScrollbarHover(null)
}

function handlePointerDown(event) {
  controller.closeContextMenu()
  const layout = controller.getLayout()
  if (!layout) return
  if (event.button !== 0) return
  canvasRef.value?.focus?.()
  const point = controller.pointFromClient(event.clientX, event.clientY)
  const scrollbarHit = hitScrollbarThumb(point)
  if (scrollbarHit) {
    canvasRef.value?.setPointerCapture?.(event.pointerId)
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
    const group = controller.getLayout().groups.find((g) => g.id === hit.id)
    controller.setGroupExpanded(hit.id, !group.expanded)
    return
  }

  if ((hit?.type === 'group' && hit.zone === 'item') || hit?.type === 'node') {
    const nodeId = hit.type === 'group' ? hit.childId : hit.id
    const node = props.graph.nodes.get(nodeId)
    if (!node) return
    canvasRef.value?.setPointerCapture?.(event.pointerId)
    dragState = {
      nodeId,
      fromParentId: node.parentId,
      additive: isAdditiveSelection(event),
      startScreen: controller.screenPointFromClient(event.clientX, event.clientY),
      dragging: false,
      targetParentId: null,
      targetGroupId: null,
      insertIndex: 0,
      attachPreviewRect: null,
      attachPreviewParentRect: null,
      ghostWorldPoint: null,
      ghostScreenRect: null,
      lastScreenPoint: null,
      scrollRafId: null,
      edgePanRafId: null,
      shiftFromById: null,
      shiftToById: null,
      shiftStartedAt: null,
      slotFadeStartedAt: null,
      shiftRafId: null,
    }
    return
  }

  if (!hit) {
    controller.settleAnimation()
    canvasRef.value?.setPointerCapture?.(event.pointerId)
    if (event.metaKey || event.ctrlKey) {
      const startScreen = controller.screenPointFromClient(event.clientX, event.clientY)
      marqueeState = {
        pointerId: event.pointerId,
        startScreen,
        rect: { x: startScreen.x, y: startScreen.y, width: 0, height: 0 },
        active: false,
      }
      controller.renderCurrent()
      return
    }
    controller.setSelected([])
    panState = {
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startViewport: controller.getViewport(),
      moved: false,
    }
    return
  }

  controller.setSelected(applySelectionClick(controller.getSelectedIds(), hit.id, { additive: isAdditiveSelection(event) }))
}

function handlePointerMove(event) {
  if (scrollbarDragState) {
    const group = controller.getLayout().groups.find((g) => g.id === scrollbarDragState.groupId)
    if (!group) return
    const deltaScreenY = event.clientY - scrollbarDragState.startScreenY
    const viewport = controller.getViewport()
    const scrollDelta = (deltaScreenY / (scrollbarDragState.metrics.maxThumbOffset * viewport.scale)) * scrollbarDragState.metrics.maxScroll
    const rawScrollTop = scrollbarDragState.startScrollTop + scrollDelta
    const nextScrollTop = clampGroupScroll(group, rawScrollTop)
    group.scrollTop = nextScrollTop
    controller.renderCurrent()
    return
  }

  if (marqueeState) {
    const screenPoint = controller.screenPointFromClient(event.clientX, event.clientY)
    marqueeState.rect = {
      x: marqueeState.startScreen.x,
      y: marqueeState.startScreen.y,
      width: screenPoint.x - marqueeState.startScreen.x,
      height: screenPoint.y - marqueeState.startScreen.y,
    }
    marqueeState.active = true
    controller.scheduleRender('marquee')
    return
  }

  if (panState) {
    const delta = {
      x: event.clientX - panState.startScreen.x,
      y: event.clientY - panState.startScreen.y,
    }
    panState.moved = panState.moved || delta.x !== 0 || delta.y !== 0
    controller.applyViewport(panViewportBy(panState.startViewport, delta, viewportOptions(props.options)), { render: false })
    controller.scheduleRender('pan')
    return
  }

  if (!dragState) {
    const scrollbarHit = hitScrollbarThumb(controller.pointFromClient(event.clientX, event.clientY))
    updateScrollbarHover(scrollbarHit?.group.id ?? null)
    return
  }
  const screenPoint = controller.screenPointFromClient(event.clientX, event.clientY)
  const worldPoint = controller.pointFromClient(event.clientX, event.clientY)
  dragState.lastScreenPoint = screenPoint

  if (!dragState.dragging) {
    if (!exceedsDragThreshold(dragState.startScreen, screenPoint)) return
    dragState.dragging = true
    dragState.slotFadeStartedAt = now()
    ensureAutoScrollLoop()
  }

  updateDragTarget(worldPoint)
  controller.renderCurrent()
  ensureAutoScrollLoop()
  ensureEdgePanLoop()
  if (dragShiftActive()) ensureDragShiftLoop()
}

function handlePointerUp() {
  if (marqueeState) {
    controller.flushScheduledRender()
    const ids = marqueeState.active ? idsInSelectionRect(controller.getLayout(), marqueeState.rect, controller.getViewport()) : []
    marqueeState = null
    controller.setSelected(ids)
    return
  }

  if (panState) {
    controller.flushScheduledRender()
    panState = null
    controller.renderCurrent()
    return
  }

  if (scrollbarDragState) {
    controller.flushScheduledRender()
    const group = controller.getLayout().groups.find((g) => g.id === scrollbarDragState.groupId)
    if (group) controller.scrollGroup(group, group.scrollTop)
    scrollbarDragState = null
    return
  }

  if (!dragState) return

  if (dragState.dragging) {
    controller.flushScheduledRender()
    cancelAutoScrollLoop()
    cancelDragShiftLoop()
    cancelEdgePanLoop()
    const layout = controller.getLayout()
    let renderAfterDrag = false
    let updateLayoutAfterDrag = false
    let groupScrollPatch = null
    let groupReorderPayload = null
    let nodeMovePayload = null
    let changeResult = null

    if (dragState.targetParentId) {
      const parent = props.graph.nodes.get(dragState.targetParentId)
      const targetGroup = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
      const index = targetGroup
        ? groupInsertIndexToParentIndex(parent, targetGroup, dragState.nodeId, dragState.insertIndex)
        : dragState.targetParentId === dragState.fromParentId
          ? dragState.insertIndex ?? parent.children.length
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
        const result = controller.applyOperation(operation, { before: props.beforeGroupReorder })
        if (result.applied) {
          if (targetGroup) groupScrollPatch = { groupId: targetGroup.id, scrollTop: targetGroup.scrollTop }
          updateLayoutAfterDrag = true
          groupReorderPayload = {
            groupId: dragState.targetGroupId,
            childId: dragState.nodeId,
            index: result.operation.payload.index,
          }
          changeResult = result
        } else {
          renderAfterDrag = true
        }
      } else {
        const operation = {
          type: 'move-node',
          payload: { nodeId: dragState.nodeId, toParentId: dragState.targetParentId, index },
        }
        const result = controller.applyOperation(operation, { before: props.beforeNodeMove })
        if (result.applied) {
          updateLayoutAfterDrag = true
          nodeMovePayload = {
            nodeId: dragState.nodeId,
            fromParentId: dragState.fromParentId,
            toParentId: dragState.targetParentId,
            index: result.operation.payload.index,
          }
          changeResult = result
        } else {
          renderAfterDrag = true
        }
      }
    } else {
      renderAfterDrag = true
    }

    dragState = null
    if (groupScrollPatch) {
      const group = layout.groups.find((g) => g.id === groupScrollPatch.groupId)
      if (group) controller.scrollGroup(group, groupScrollPatch.scrollTop)
    }
    if (updateLayoutAfterDrag) controller.updateLayout()
    if (groupReorderPayload) emit('group-reorder', groupReorderPayload)
    if (nodeMovePayload) emit('node-move', nodeMovePayload)
    if (changeResult) emitChange(changeResult)
    if (renderAfterDrag) controller.renderCurrent()
    return
  } else {
    controller.setSelected(applySelectionClick(controller.getSelectedIds(), dragState.nodeId, { additive: dragState.additive }))
  }

  dragState = null
}

function handleWheel(event) {
  controller.closeContextMenu()
  const layout = controller.getLayout()
  if (!layout) return
  if (dragState || scrollbarDragState || panState) return
  const viewport = controller.getViewport()
  const screenPoint = controller.screenPointFromClient(event.clientX, event.clientY)
  const point = controller.pointFromClient(event.clientX, event.clientY)
  const hit = hitTest(layout, point)
  if (hit?.type === 'group') {
    const group = controller.getLayout().groups.find((g) => g.id === hit.id)
    if (group?.overflowY) {
      event.preventDefault()
      controller.scrollGroup(group, group.scrollTop + event.deltaY)
      return
    }
  }

  event.preventDefault()
  controller.settleAnimation()
  const nextViewport = zoomViewportAt(viewport, screenPoint, event.deltaY, viewportOptions(props.options))
  controller.applyViewport(nextViewport)
}

function handleKeyDown(event) {
  if (event.key === 'Escape') {
    if (contextMenuState.value) {
      event.preventDefault()
      controller.closeContextMenu()
      return
    }
    if (controller.getSelectedIds().length === 0) return
    event.preventDefault()
    controller.setSelected([])
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    controller.deleteSelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    controller.copySelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
    event.preventDefault()
    controller.paste()
  }
}

function handleDragOver(event) {
  event.preventDefault()
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

function resolveResourceDropTarget(point) {
  const layout = controller.getLayout()
  const hit = hitTest(layout, point)
  if (hit?.type === 'node') {
    const parent = props.graph.nodes.get(hit.id)
    if (parent) return { parentId: hit.id, index: parent.children.length }
  }

  if (hit?.type === 'group' && hit.zone === 'item') {
    const parent = props.graph.nodes.get(hit.childId)
    if (parent) return { parentId: hit.childId, index: parent.children.length }
  }

  const selected = controller.getSelectedIds()
  const parentId = selected[0] ?? props.graph.rootIds[0]
  const parent = props.graph.nodes.get(parentId)
  if (!parent) return null
  return {
    parentId,
    index: findInsertionIndex(props.graph, layout, parentId, point, props.layoutDirection),
  }
}

function handleDrop(event) {
  event.preventDefault()
  controller.settleAnimation()
  if (!controller.getLayout()) return
  const raw = event.dataTransfer.getData('application/json')
  if (!raw) return
  const resource = JSON.parse(raw)

  const point = controller.pointFromClient(event.clientX, event.clientY)
  const target = resolveResourceDropTarget(point)
  if (!target) return
  const { parentId, index } = target
  const id = `res-${resource.id}-${Date.now()}`
  const operation = {
    type: 'drop-node',
    payload: { resource, parentId, index, id },
  }
  const result = controller.applyOperation(operation, { before: props.beforeNodeDrop })
  if (!result.applied) return

  controller.updateLayout()
  emit('node-drop', { resource, parentId, index: result.operation.payload.index })
  emitChange(result)
}

function fitToScreen() {
  cancelPointerInteractions()
  controller.fitToScreen()
}

function centerOnNode(id) {
  cancelPointerInteractions()
  controller.centerOnNode(id)
}

function centerOnSelection() {
  cancelPointerInteractions()
  controller.centerOnSelection()
}

function zoomTo(scale, center) {
  cancelPointerInteractions()
  controller.zoomTo(scale, center)
}

function handleOverviewNavigate(worldPoint) {
  const { width, height } = controller.getCssSize()
  controller.applyViewport(centerViewportOn(worldPoint, controller.getViewport(), width, height))
}

function emitConfigChange(key, value, context) {
  if (key === 'readonly') internalReadonly.value = value
  else internalOptions.value = { ...internalOptions.value, [key]: value }
  controller.renderCurrent()
  emit('config-change', { key, value, source: 'context-menu', context })
}

defineExpose({
  fitToScreen: () => fitToScreen(),
  centerOnNode: (id) => centerOnNode(id),
  centerOnSelection: () => centerOnSelection(),
  zoomTo: (scale, center) => zoomTo(scale, center),
  setViewport: (viewport) => controller.setViewport(viewport),
  getViewport: () => controller.getViewport(),
  select: (ids, mode) => controller.select(ids, mode),
  clearSelection: () => controller.clearSelection(),
  search: (keyword) => controller.search(keyword),
  searchNext: () => controller.searchNext(),
  searchPrevious: () => controller.searchPrevious(),
  undo: () => controller.undo(),
  redo: () => controller.redo(),
  canUndo: () => controller.canUndo(),
  canRedo: () => controller.canRedo(),
  deleteSelection: () => controller.deleteSelection(),
  copySelection: () => controller.copySelection(),
  paste: () => controller.paste(),
  exportGraph: () => controller.exportGraph(),
  importGraph: (data) => controller.importGraph(data),
})

function createInteractionController() {
  return createMinimapController({
    getGraph: () => props.graph,
    getLayoutDirection: () => props.layoutDirection,
    getOptions: () => effectiveOptions.value,
    getTheme: () => effectiveTheme.value,
    getRenderers: () => ({ node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer }),
    getViewportProp: () => props.viewport,
    getGroupStatesProp: () => props.groupStates,
    getInteractionRenderState: () => interactionRenderState(),
    getSelectedIdsProp: () => props.selectedIds,
    emitSelect: (ids) => emit('select', ids),
    getReadonly: () => effectiveReadonly.value,
    getBeforeDelete: () => props.beforeDelete,
    getBeforeCopy: () => props.beforeCopy,
    getBeforeImport: () => props.beforeImport,
    getBeforePaste: () => props.beforePaste,
    emitDelete: (payload) => emit('delete', payload),
    emitCopy: (payload) => emit('copy', payload),
    emitPaste: (payload) => emit('paste', payload),
    emitImport: (payload) => emit('import', payload),
    emitExport: (payload) => emit('export', payload),
    emitChange: (payload) => emit('change', payload),
    centerOnNode: (id) => centerOnNode(id),
    fitToScreen: () => fitToScreen(),
    centerOnSelection: () => centerOnSelection(),
    emitSearch: (payload) => emit('search', payload),
    onSearchStateChange: ({ keyword, matches, currentIndex }) => {
      searchKeyword.value = keyword
      searchMatches.value = matches
      searchCurrentIndex.value = currentIndex
    },
    cancelPointerInteractions: () => cancelPointerInteractions(),
    emitConfigChange,
    emitContextMenuAction: (payload) => emit('context-menu-action', payload),
    getContextMenuItemsProp: () => props.contextMenuItems,
    getMenuEl: () => contextMenuRef.value,
    onMenuStateChange: (state) => { contextMenuState.value = state },
    emitViewportChange: (next) => emit('viewport-change', next),
    emitGroupStateChange: (next) => emit('group-state-change', next),
    onRenderStats: (stats) => { renderStats.value = stats },
    onOverviewRender: (scene) => overviewRef.value?.render(scene),
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerLeave: clearScrollbarHover,
    onPointerCancel: cancelPointerInteractions,
    onLostPointerCapture: cancelPointerInteractions,
    onKeyDown: handleKeyDown,
    onWheel: handleWheel,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  })
}

controller = createInteractionController()

onMounted(() => {
  controller.mount(canvasRef.value, containerRef.value)
})

onUnmounted(() => {
  cancelPointerInteractions()
  controller?.closeContextMenu()
  controller?.destroy()
  controller = null
})

watch(() => props.layoutDirection, () => controller.updateLayout())
watch(
  () => props.graph,
  () => {
    controller.closeContextMenu()
    controller.onGraphReplaced()
    controller.updateLayout()
  },
)
watch(() => props.selectedIds, () => controller.renderCurrent())
watch(() => props.groupStates, () => controller.updateLayout())
watch(() => props.viewport, () => controller.renderCurrent())
watch(() => props.options, () => {
  syncConfigFromProps()
  controller.closeContextMenu()
  controller.updateLayout()
})
watch(() => props.readonly, () => syncConfigFromProps())
watch(() => props.contextMenuItems, () => controller.closeContextMenu())
</script>

<template>
  <div class="minimap">
    <ResourceTree class="minimap-resources" :resources="resources" />
    <div ref="containerRef" class="minimap-canvas-container">
      <div class="minimap-toolbar" aria-label="画布工具栏">
        <button class="minimap-toolbar-button is-primary" type="button" aria-label="返回">◀</button>
        <span class="minimap-toolbar-separator"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="撤销" @click="controller.undo">↶</button>
        <button class="minimap-toolbar-button" type="button" aria-label="重做" @click="controller.redo">↷</button>
        <span class="minimap-toolbar-separator"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="选择">□</button>
        <button class="minimap-toolbar-button" type="button" aria-label="复制" @click="controller.copySelection">⌘</button>
        <button class="minimap-toolbar-button" type="button" aria-label="粘贴" @click="controller.paste">⎘</button>
        <button class="minimap-toolbar-button" type="button" aria-label="删除" @click="controller.deleteSelection">⌫</button>
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
        :class="{ 'is-active-border-enabled': effectiveOptions.enableActiveBorder === true }"
        tabindex="0"
      ></canvas>
      <div v-if="effectiveOptions.enableSearch !== false" class="minimap-search">
        <input
          :value="searchKeyword"
          class="minimap-search-input"
          placeholder="搜索节点..."
          @input="controller.search($event.target.value)"
          @keydown.enter="controller.searchNext"
        />
        <span class="minimap-search-count">{{ searchMatches.length ? `${searchCurrentIndex + 1}/${searchMatches.length}` : '0/0' }}</span>
        <button
          class="minimap-search-btn minimap-search-prev"
          :disabled="searchMatches.length === 0"
          @click="controller.searchPrevious"
        >
          ‹
        </button>
        <button
          class="minimap-search-btn minimap-search-next"
          :disabled="searchMatches.length === 0"
          @click="controller.searchNext"
        >
          ›
        </button>
      </div>
      <div v-if="effectiveOptions.enableOverview !== false" class="minimap-overview-panel">
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
      <div v-if="effectiveOptions.showPerformance" class="minimap-performance">
        <span class="minimap-performance-label">性能</span>
        <span class="minimap-performance-value">{{ renderStats ? `${renderStats.drawn}/${renderStats.total}` : '0/0' }}</span>
        <span class="minimap-performance-value">{{ renderStats ? `${renderStats.culled} culled` : '0 culled' }}</span>
        <span class="minimap-performance-value">{{ renderStats ? `${renderStats.durationMs.toFixed(1)}ms` : '0.0ms' }}</span>
      </div>
      <div
        v-if="contextMenuState"
        ref="contextMenuRef"
        class="minimap-context-menu"
        role="menu"
        :style="{ left: `${contextMenuState.position.x}px`, top: `${contextMenuState.position.y}px` }"
      >
        <div v-for="item in contextMenuState.items" :key="item.id">
          <div v-if="item.type === 'separator'" class="minimap-context-menu-separator"></div>
          <button
            v-else
            class="minimap-context-menu-item"
            :class="{ 'is-danger': item.danger, 'is-checked': item.checked }"
            type="button"
            role="menuitem"
            :data-menu-id="item.id"
            :aria-disabled="item.disabled ? 'true' : 'false'"
            :disabled="item.disabled"
            @click="controller.runContextMenuItem(item)"
          >
            <span class="minimap-context-menu-check" aria-hidden="true">
              {{ item.type === 'checkbox' ? (item.checked ? '✓' : '') : '' }}
            </span>
            <span class="minimap-context-menu-label">{{ item.label }}</span>
          </button>
        </div>
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
.minimap-performance {
  position: absolute;
  z-index: 4;
  left: 14px;
  bottom: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  color: #b8c1cc;
  background: rgba(18, 23, 29, 0.92);
  border: 1px solid #303741;
  border-radius: 8px;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.38);
  font: 12px/1 system-ui, sans-serif;
}
.minimap-performance-label {
  color: #7f8a99;
  letter-spacing: 0;
}
.minimap-performance-value {
  white-space: nowrap;
}
.minimap-context-menu {
  position: absolute;
  z-index: 8;
  width: 232px;
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  color: #d8dee8;
  background: rgba(17, 21, 27, 0.98);
  border: 1px solid #303741;
  border-radius: 8px;
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.42);
  scrollbar-width: thin;
  scrollbar-color: #2e3540 transparent;
}
.minimap-context-menu::-webkit-scrollbar {
  width: 6px;
}
.minimap-context-menu::-webkit-scrollbar-track {
  background: transparent;
}
.minimap-context-menu::-webkit-scrollbar-thumb {
  background-color: #2e3540;
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
.minimap-context-menu::-webkit-scrollbar-thumb:hover {
  background-color: #3a4250;
}
.minimap-context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 30px;
  gap: 8px;
  padding: 0 8px;
  color: #cfd6df;
  background: transparent;
  border: 0;
  border-radius: 5px;
  text-align: left;
  font: 13px/1 system-ui, sans-serif;
}
.minimap-context-menu-item:hover:not(:disabled) {
  background: #232930;
}
.minimap-context-menu-item:disabled {
  opacity: 0.38;
}
.minimap-context-menu-item.is-danger:not(:disabled) {
  color: #ff8d8d;
}
.minimap-context-menu-check {
  width: 14px;
  color: #2bdd7f;
  text-align: center;
}
.minimap-context-menu-label {
  flex: 1;
}
.minimap-context-menu-separator {
  height: 1px;
  margin: 5px 4px;
  background: #2a3038;
}
</style>
