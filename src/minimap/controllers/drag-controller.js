import { GROUP, clampGroupScroll } from '../graph/layout.js'
import { worldRectToScreen } from '../render/renderer.js'
import { screenToWorld } from '../coords/coords.js'
import { panViewportBy, viewportOptions } from '../coords/viewport.js'
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  isModKey,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
  resolveDropTarget,
  resolveResourceDropPreview,
  edgePanVelocity,
  hitScrollbarThumb,
} from '../interaction/interaction.js'
import {
  buildVirtualOrder,
  buildVirtualOrderMulti,
  childWorldRectsById,
  currentShiftRects,
  dragShiftEasedProgress,
  dragShiftProgress,
} from '../interaction/drag-transition.js'
import { applySelectionClick, idsInSelectionRect, normalizeRect, resolveDragNodeIds } from '../interaction/selection.js'

const DRAG_SHIFT_DURATION_MS = 150

function parseResourcePayload(raw) {
  const payload = JSON.parse(raw)
  if (Array.isArray(payload.resources) && payload.resources.length > 0) return payload.resources
  return [payload]
}

function resourceNodeId(resource, index) {
  return `res-${resource.id}-${Date.now()}-${index}`
}

export function createDragController(deps) {
  let dragState = null
  let resourceDragState = null
  let scrollbarDragState = null
  let panState = null
  let marqueeState = null
  let hoveredScrollbarGroupId = null

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

  function dragNodeIds() {
    return dragState?.dragNodeIds ?? []
  }

  function isMultiDrag() {
    return dragNodeIds().length > 1
  }

  function getInteractionRenderState() {
    const timestamp = now()
    if (resourceDragState) {
      return {
        dragging: false,
        interacting: false,
        groupDrag: null,
        selectionRect: null,
        groupScrollbarHoverId: hoveredScrollbarGroupId,
        attachPreview: resourceDragState.attachPreviewRect
          ? { rect: resourceDragState.attachPreviewRect, parentRect: resourceDragState.attachPreviewParentRect }
          : null,
      }
    }
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
    const layout = deps.getLayout()
    const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
    const ids = dragNodeIds()
    let groupDrag
    if (!group) {
      groupDrag = {
        groupId: null,
        order: null,
        draggingChildId: dragState.nodeId,
        draggingChildIds: ids,
        ghostCount: ids.length,
        ghostRect: dragState.ghostScreenRect,
        childRectsById: null,
        dropSlotOpacity: 1,
      }
    } else {
      const orderBuilder = isMultiDrag() ? buildVirtualOrderMulti : buildVirtualOrder
      const order = isMultiDrag()
        ? orderBuilder(group.children, ids, dragState.insertIndex)
        : orderBuilder(group.children, dragState.nodeId, dragState.insertIndex)
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
      groupDrag = {
        groupId: group.id,
        order,
        draggingChildId: dragState.nodeId,
        draggingChildIds: ids,
        ghostCount: ids.length,
        ghostRect: dragState.ghostScreenRect,
        childRectsById,
        dropSlotOpacity,
      }
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
      deps.renderCurrent()
      if (dragShiftActive(time ?? now())) dragState.shiftRafId = requestAnimationFrame(tick)
      else dragState.shiftRafId = null
    }
    dragState.shiftRafId = requestAnimationFrame(tick)
  }

  function withinGroupBody(group, point) {
    return (
      point.x >= group.x &&
      point.x <= group.x + group.width &&
      point.y >= group.y + GROUP.header &&
      point.y <= group.y + group.height
    )
  }

  function updateDragTarget(worldPoint) {
    const layout = deps.getLayout()
    const previousGroupId = dragState.targetGroupId
    const previousIndex = dragState.insertIndex

    const activeGroup = previousGroupId ? layout.groups.find((g) => g.id === previousGroupId) : null
    const excluded = dragNodeIds()
    const target =
      activeGroup && withinGroupBody(activeGroup, worldPoint)
        ? {
            valid: true,
            parentId: activeGroup.parentId,
            group: activeGroup,
            insertIndex: groupGridIndexAt(
              { ...activeGroup, children: activeGroup.children.filter((id) => !excluded.includes(id)) },
              worldPoint,
            ),
            previewRect: null,
          }
        : resolveDropTarget(
            deps.getGraph(),
            layout,
            worldPoint,
            dragState.nodeId,
            deps.getLayoutDirection(),
            deps.getViewport().scale,
            excluded,
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
    const toOrder = isMultiDrag()
      ? buildVirtualOrderMulti(group.children, dragNodeIds(), insertIndex)
      : buildVirtualOrder(group.children, dragState.nodeId, insertIndex)
    dragState.shiftFromById = fromById
    dragState.shiftToById = childWorldRectsById(group, toOrder)
    dragState.shiftStartedAt = timestamp
  }

  function isAdditiveSelection(event) {
    return event.shiftKey || isModKey(event)
  }

  function ghostRectForPoint(worldPoint) {
    const worldRect = {
      x: worldPoint.x - GROUP.itemW / 2,
      y: worldPoint.y - GROUP.itemH / 2,
      width: GROUP.itemW,
      height: GROUP.itemH,
    }
    return worldRectToScreen(worldRect, deps.getViewport())
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
      const layout = deps.getLayout()
      const group = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
      if (group && dragState.ghostWorldPoint) {
        const delta = groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y)
        if (delta !== 0) {
          group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)
          clearDragShiftAnimation()
          updateDragTarget(dragState.ghostWorldPoint)
        }
      }
      deps.renderCurrent()
      const timestamp = time ?? now()
      const scrolling = shouldAutoScroll(group)
      if (scrolling || dragShiftActive(timestamp)) dragState.scrollRafId = requestAnimationFrame(tick)
      else dragState.scrollRafId = null
    }
    dragState.scrollRafId = requestAnimationFrame(tick)
  }

  function ensureAutoScrollLoop() {
    if (!dragState?.dragging || dragState.scrollRafId != null) return
    const layout = deps.getLayout()
    const group = dragState.targetGroupId ? layout?.groups.find((g) => g.id === dragState.targetGroupId) : null
    if (!shouldAutoScroll(group) && !dragShiftActive()) return
    startAutoScrollLoop()
  }

  function edgePanActive() {
    if (!dragState?.dragging || !dragState.lastScreenPoint) return false
    const { width, height } = deps.getCssSize()
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
      const { width, height } = deps.getCssSize()
      const velocity = edgePanVelocity(dragState.lastScreenPoint, width, height)
      if (velocity.x !== 0 || velocity.y !== 0) {
        deps.applyViewport(panViewportBy(deps.getViewport(), { x: -velocity.x, y: -velocity.y }, viewportOptions(deps.getOptions())))
        updateDragTarget(screenToWorld(dragState.lastScreenPoint, deps.getViewport()))
        deps.renderCurrent()
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
    deps.renderCurrent()
  }

  function cancelScrollbarDrag() {
    if (!scrollbarDragState) return
    const group = deps.getLayout()?.groups.find((g) => g.id === scrollbarDragState.groupId)
    if (group && deps.getGroupStatesProp() === null) group.scrollTop = scrollbarDragState.startScrollTop
    hoveredScrollbarGroupId = null
    scrollbarDragState = null
    if (deps.getGroupStatesProp() !== null) deps.updateLayout({ animate: false, preserveAnchor: false })
    else deps.renderCurrent()
  }

  function cancelPan() {
    panState = null
  }

  function cancelMarquee() {
    marqueeState = null
  }

  function cancelPointerInteractions() {
    deps.cancelScheduledRender()
    const hadMarquee = Boolean(marqueeState?.active)
    cancelDrag()
    cancelScrollbarDrag()
    cancelPan()
    cancelMarquee()
    if (hadMarquee) deps.renderCurrent()
  }

  function updateScrollbarHover(groupId) {
    if (hoveredScrollbarGroupId === groupId) return
    hoveredScrollbarGroupId = groupId
    deps.renderCurrent()
  }

  function clearScrollbarHover() {
    updateScrollbarHover(null)
  }

  function startMarquee(event) {
    deps.settleAnimation()
    deps.getCanvasEl()?.setPointerCapture?.(event.pointerId)
    const startScreen = deps.screenPointFromClient(event.clientX, event.clientY)
    marqueeState = {
      pointerId: event.pointerId,
      startScreen,
      rect: { x: startScreen.x, y: startScreen.y, width: 0, height: 0 },
      active: false,
    }
    deps.renderCurrent()
  }

  let consumedMarqueeGesture = false

  function consumeMarqueeGesture() {
    const value = consumedMarqueeGesture
    consumedMarqueeGesture = false
    return value
  }

  function handlePointerDown(event) {
    deps.closeContextMenu()
    const layout = deps.getLayout()
    if (!layout) return
    const isPrimary = event.button === 0
    const isSecondary = event.button === 2
    if (!isPrimary && !isSecondary) return
    deps.getCanvasEl()?.focus?.()
    const point = deps.pointFromClient(event.clientX, event.clientY)

    if (isSecondary) {
      const hit = hitTest(layout, point)
      if (!hit) startMarquee(event)
      return
    }

    const scrollbarHit = hitScrollbarThumb(layout, point)
    if (scrollbarHit) {
      deps.getCanvasEl()?.setPointerCapture?.(event.pointerId)
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
      const group = deps.getLayout().groups.find((g) => g.id === hit.id)
      deps.setGroupExpanded(hit.id, !group.expanded)
      return
    }

    if ((hit?.type === 'group' && hit.zone === 'item') || hit?.type === 'node') {
      const nodeId = hit.type === 'group' ? hit.childId : hit.id
      const node = deps.getGraph().nodes.get(nodeId)
      if (!node) return
      deps.getCanvasEl()?.setPointerCapture?.(event.pointerId)
      dragState = {
        nodeId,
        dragNodeIds: resolveDragNodeIds(nodeId, deps.getSelectedIds(), deps.getGraph(), layout),
        fromParentId: node.parentId,
        additive: isAdditiveSelection(event),
        startScreen: deps.screenPointFromClient(event.clientX, event.clientY),
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
      deps.settleAnimation()
      deps.getCanvasEl()?.setPointerCapture?.(event.pointerId)
      if (isModKey(event)) {
        startMarquee(event)
        return
      }
      deps.setSelected([])
      panState = {
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startViewport: deps.getViewport(),
        moved: false,
      }
      return
    }

    deps.setSelected(applySelectionClick(deps.getSelectedIds(), hit.id, { additive: isAdditiveSelection(event) }))
  }

  function handlePointerMove(event) {
    if (scrollbarDragState) {
      const group = deps.getLayout().groups.find((g) => g.id === scrollbarDragState.groupId)
      if (!group) return
      const deltaScreenY = event.clientY - scrollbarDragState.startScreenY
      const viewport = deps.getViewport()
      const scrollDelta = (deltaScreenY / (scrollbarDragState.metrics.maxThumbOffset * viewport.scale)) * scrollbarDragState.metrics.maxScroll
      const rawScrollTop = scrollbarDragState.startScrollTop + scrollDelta
      const nextScrollTop = clampGroupScroll(group, rawScrollTop)
      group.scrollTop = nextScrollTop
      deps.renderCurrent()
      return
    }

    if (marqueeState) {
      const screenPoint = deps.screenPointFromClient(event.clientX, event.clientY)
      marqueeState.rect = {
        x: marqueeState.startScreen.x,
        y: marqueeState.startScreen.y,
        width: screenPoint.x - marqueeState.startScreen.x,
        height: screenPoint.y - marqueeState.startScreen.y,
      }
      if (!marqueeState.active) {
        marqueeState.active = true
        deps.cancelContextMenuPending?.()
      }
      deps.scheduleRender('marquee')
      return
    }

    if (panState) {
      const delta = {
        x: event.clientX - panState.startScreen.x,
        y: event.clientY - panState.startScreen.y,
      }
      panState.moved = panState.moved || delta.x !== 0 || delta.y !== 0
      deps.applyViewport(panViewportBy(panState.startViewport, delta, viewportOptions(deps.getOptions())), { render: false })
      deps.scheduleRender('pan')
      return
    }

    if (!dragState) {
      const scrollbarHit = hitScrollbarThumb(deps.getLayout(), deps.pointFromClient(event.clientX, event.clientY))
      updateScrollbarHover(scrollbarHit?.group.id ?? null)
      return
    }
    const screenPoint = deps.screenPointFromClient(event.clientX, event.clientY)
    const worldPoint = deps.pointFromClient(event.clientX, event.clientY)
    dragState.lastScreenPoint = screenPoint

    if (!dragState.dragging) {
      if (!exceedsDragThreshold(dragState.startScreen, screenPoint)) return
      dragState.dragging = true
      dragState.slotFadeStartedAt = now()
      ensureAutoScrollLoop()
    }

    updateDragTarget(worldPoint)
    deps.renderCurrent()
    ensureAutoScrollLoop()
    ensureEdgePanLoop()
    if (dragShiftActive()) ensureDragShiftLoop()
  }

  function handlePointerUp() {
    if (marqueeState) {
      deps.flushScheduledRender()
      consumedMarqueeGesture = marqueeState.active
      if (marqueeState.active) {
        const ids = idsInSelectionRect(deps.getLayout(), marqueeState.rect, deps.getViewport())
        deps.setSelected(ids)
      }
      marqueeState = null
      deps.renderCurrent()
      return
    }

    if (panState) {
      deps.flushScheduledRender()
      panState = null
      deps.renderCurrent()
      return
    }

    if (scrollbarDragState) {
      deps.flushScheduledRender()
      const group = deps.getLayout().groups.find((g) => g.id === scrollbarDragState.groupId)
      if (group) deps.scrollGroup(group, group.scrollTop)
      scrollbarDragState = null
      return
    }

    if (!dragState) return

    if (dragState.dragging) {
      deps.flushScheduledRender()
      cancelAutoScrollLoop()
      cancelDragShiftLoop()
      cancelEdgePanLoop()
      const layout = deps.getLayout()
      let renderAfterDrag = false
      let updateLayoutAfterDrag = false
      let groupScrollPatch = null
      let groupReorderPayload = null
      let nodeMovePayload = null
      let changeResult = null

      if (dragState.targetParentId) {
        const parent = deps.getGraph().nodes.get(dragState.targetParentId)
        const targetGroup = dragState.targetGroupId ? layout.groups.find((g) => g.id === dragState.targetGroupId) : null
        const index = targetGroup
          ? groupInsertIndexToParentIndex(parent, targetGroup, dragState.nodeId, dragState.insertIndex)
          : dragState.insertIndex ?? parent.children.length
        const ids = dragNodeIds()
        const graph = deps.getGraph()
        const sameParentReorder =
          dragState.targetParentId === dragState.fromParentId &&
          ids.every((id) => graph.nodes.get(id)?.parentId === dragState.fromParentId)

        if (sameParentReorder) {
          const operation = ids.length > 1
            ? {
              type: 'reorder-group-children',
              payload: {
                groupId: dragState.targetGroupId,
                parentId: dragState.targetParentId,
                childIds: ids,
                index,
              },
            }
            : {
              type: 'reorder-group-child',
              payload: {
                groupId: dragState.targetGroupId,
                parentId: dragState.targetParentId,
                childId: dragState.nodeId,
                index,
              },
            }
          const result = deps.applyOperation(operation, { before: deps.getBeforeGroupReorder() })
          if (result.applied) {
            if (targetGroup) groupScrollPatch = { groupId: targetGroup.id, scrollTop: targetGroup.scrollTop }
            updateLayoutAfterDrag = true
            groupReorderPayload = ids.length > 1
              ? { groupId: dragState.targetGroupId, childIds: ids, index: result.operation.payload.index }
              : {
                groupId: dragState.targetGroupId,
                childId: dragState.nodeId,
                index: result.operation.payload.index,
              }
            changeResult = result
          } else {
            renderAfterDrag = true
          }
        } else {
          const operation = ids.length > 1
            ? {
              type: 'move-nodes',
              payload: { nodeIds: ids, toParentId: dragState.targetParentId, index },
            }
            : {
              type: 'move-node',
              payload: { nodeId: dragState.nodeId, toParentId: dragState.targetParentId, index },
            }
          const result = deps.applyOperation(operation, { before: deps.getBeforeNodeMove() })
          if (result.applied) {
            updateLayoutAfterDrag = true
            nodeMovePayload = {
              nodeId: dragState.nodeId,
              nodeIds: ids,
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
        if (group) deps.scrollGroup(group, groupScrollPatch.scrollTop)
      }
      if (updateLayoutAfterDrag) deps.updateLayout()
      if (groupReorderPayload) deps.emitGroupReorder(groupReorderPayload)
      if (nodeMovePayload) deps.emitNodeMove(nodeMovePayload)
      if (changeResult) deps.emitChangeIfApplied(changeResult)
      if (renderAfterDrag) deps.renderCurrent()
      return
    } else {
      deps.setSelected(applySelectionClick(deps.getSelectedIds(), dragState.nodeId, { additive: dragState.additive }))
    }

    dragState = null
  }

  function handleWheel(event) {
    deps.closeContextMenu()
    const layout = deps.getLayout()
    if (!layout) return
    if (dragState || scrollbarDragState || panState) return
    const point = deps.pointFromClient(event.clientX, event.clientY)
    const hit = hitTest(layout, point)
    if (hit?.type === 'group') {
      const group = deps.getLayout().groups.find((g) => g.id === hit.id)
      if (group?.overflowY) {
        event.preventDefault()
        deps.scrollGroup(group, group.scrollTop + event.deltaY)
        return
      }
    }

    event.preventDefault()
    deps.settleAnimation()
    const screenPoint = deps.screenPointFromClient(event.clientX, event.clientY)
    deps.zoomAt(screenPoint, event.deltaY)
  }

  function clearResourceDragPreview() {
    if (!resourceDragState) return
    resourceDragState = null
    deps.scheduleRender('resource-drag')
  }

  function updateResourceDragPreview(point) {
    const layout = deps.getLayout()
    if (!layout) {
      clearResourceDragPreview()
      return
    }
    const preview = resolveResourceDropPreview(
      deps.getGraph(),
      layout,
      point,
      deps.getLayoutDirection(),
      deps.getSelectedIds(),
      deps.getGraph().rootIds,
    )
    if (!preview.valid || !preview.previewRect) {
      clearResourceDragPreview()
      return
    }
    const next = {
      attachPreviewRect: preview.previewRect,
      attachPreviewParentRect: preview.parentRect,
    }
    const unchanged =
      resourceDragState &&
      resourceDragState.attachPreviewRect?.x === next.attachPreviewRect.x &&
      resourceDragState.attachPreviewRect?.y === next.attachPreviewRect.y
    resourceDragState = next
    if (!unchanged) deps.scheduleRender('resource-drag')
  }

  function handleDragOver(event) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    updateResourceDragPreview(deps.pointFromClient(event.clientX, event.clientY))
  }

  function handleDragLeave() {
    clearResourceDragPreview()
  }

  function resolveResourceDropTarget(point) {
    const layout = deps.getLayout()
    const hit = hitTest(layout, point)
    if (hit?.type === 'node') {
      const parent = deps.getGraph().nodes.get(hit.id)
      if (parent) return { parentId: hit.id, index: parent.children.length }
    }

    if (hit?.type === 'group' && hit.zone === 'item') {
      const parent = deps.getGraph().nodes.get(hit.childId)
      if (parent) return { parentId: hit.childId, index: parent.children.length }
    }

    const selected = deps.getSelectedIds()
    const parentId = selected[0] ?? deps.getGraph().rootIds[0]
    const parent = deps.getGraph().nodes.get(parentId)
    if (!parent) return null
    return {
      parentId,
      index: findInsertionIndex(deps.getGraph(), layout, parentId, point, deps.getLayoutDirection()),
    }
  }

  function handleDrop(event) {
    event.preventDefault()
    clearResourceDragPreview()
    deps.settleAnimation()
    if (!deps.getLayout()) return
    const raw = event.dataTransfer.getData('application/json')
    if (!raw) return
    const resources = parseResourcePayload(raw).filter((resource) => resource?.id && resource?.label)
    if (resources.length === 0) return

    const point = deps.pointFromClient(event.clientX, event.clientY)
    const target = resolveResourceDropTarget(point)
    if (!target) return
    const { parentId, index } = target
    const operation = resources.length === 1
      ? {
        type: 'drop-node',
        payload: {
          resource: resources[0],
          parentId,
          index,
          id: resourceNodeId(resources[0], 0),
        },
      }
      : {
        type: 'drop-nodes',
        payload: {
          parentId,
          index,
          nodes: resources.map((resource, resourceIndex) => ({
            id: resourceNodeId(resource, resourceIndex),
            resource,
          })),
        },
      }
    const beforeNodeDrop = deps.getBeforeNodeDrop()
    const result = deps.applyOperation(operation, {
      before: beforeNodeDrop
        ? (payload) => beforeNodeDrop(resources.length > 1 ? { resources, parentId, index } : payload)
        : null,
    })
    if (!result.applied) return

    deps.updateLayout()
    const batchId = resources.length > 1 ? `drop-${Date.now()}` : undefined
    resources.forEach((resource, batchIndex) => {
      deps.emitNodeDrop({
        resource,
        parentId,
        index: result.operation.payload.index + batchIndex,
        ...(batchId
          ? { batchId, batchIndex, batchSize: resources.length }
          : {}),
      })
    })
    deps.emitChangeIfApplied(result)
  }

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerLeave: clearScrollbarHover,
    onPointerCancel: cancelPointerInteractions,
    onLostPointerCapture: cancelPointerInteractions,
    onWheel: handleWheel,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    cancelPointerInteractions,
    getInteractionRenderState,
    consumeMarqueeGesture,
  }
}
