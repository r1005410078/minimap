// Phase 1/2 Vue 壳切片：命中检测 + 拖入插入下标 + 分组内拖拽换位的几何计算，
// 纯函数、不依赖 DOM。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
// 和 docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md

import { GROUP, NODE, LEVEL_GAP, visibleGroupChildren } from '../graph/layout.js'
import { getSpatialIndex, queryPoint } from './spatial-index.js'

const SCROLLBAR_WIDTH = 8

function containsPoint(rect, point) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

// 分组框内部按命中区域细分：header（含 ▾/▸ 整行）/ item（具体子节点格子）/ body（其余空白）。
function hitTestGroupZone(group, point) {
  const headerRect = { x: group.x, y: group.y, width: group.width, height: GROUP.header }
  if (containsPoint(headerRect, point)) return { type: 'group', id: group.id, zone: 'header' }

  for (const child of visibleGroupChildren(group)) {
    if (containsPoint(child.rect, point)) {
      return { type: 'group', id: group.id, zone: 'item', childId: child.id }
    }
  }

  return { type: 'group', id: group.id, zone: 'body' }
}

// 在 layout.visibleItems 里找世界坐标包含 point 的项。
// 树布局下节点和分组框天然不重叠，找到第一个命中项就返回。
export function hitTest(layout, point) {
  const item = queryPoint(getSpatialIndex(layout), point)
  if (!item) return null
  if (item.type === 'node') return { type: 'node', id: item.id }
  const group = layout.groups.find((g) => g.id === item.id)
  return hitTestGroupZone(group, point)
}

// 按 children 顺序比较交叉轴坐标，找第一个比 point 靠后的兄弟，插在它前面；
// 跳过已被任意分组消费的子节点（它们没有独立 rect）。
// 如果 point 落在该父节点某个具体分组的矩形范围内，插入到该分组对应 segment 的末尾之后
// ——分组框内部没有逐个子节点的世界坐标，无法精确定位到框内某一行，只能定位到段末尾。
export function findInsertionIndex(graph, layout, parentId, point, direction) {
  const parent = graph.nodes.get(parentId)
  const children = (parent && parent.children) || []
  if (children.length === 0) return 0

  const groupsOfParent = layout.groups.filter((group) => group.parentId === parentId)
  const groupByChild = new Map()
  for (const group of groupsOfParent) {
    for (const childId of group.children) groupByChild.set(childId, group)
  }

  for (const group of groupsOfParent) {
    if (containsPoint(group, point)) {
      const lastChildId = group.children[group.children.length - 1]
      return children.indexOf(lastChildId) + 1
    }
  }

  if (groupsOfParent.length === 1 && groupsOfParent[0].children.length === children.length) {
    return children.length
  }

  const pointCross = direction === 'vertical' ? point.x : point.y
  const consumedGroups = new Set()
  for (let i = 0; i < children.length; i++) {
    const group = groupByChild.get(children[i])
    if (group) {
      if (consumedGroups.has(group.id)) continue
      consumedGroups.add(group.id)
      const cross = direction === 'vertical' ? group.x + group.width / 2 : group.y + group.height / 2
      if (pointCross < cross) return i
      continue
    }

    const rect = layout.nodes.get(children[i])
    if (!rect) continue
    const cross = direction === 'vertical' ? rect.x + rect.width / 2 : rect.y + rect.height / 2
    if (pointCross < cross) return i
  }
  return children.length
}

// 世界坐标点 -> 分组网格里的插入下标（0..group.children.length）。
// 不要求该下标当前真的有子节点：用于拖拽悬停时实时算插入位置。
// 优先命中指针所在的子节点格子（与 hitTest item 区一致），进入即换位；
// 落在间隙或空白格时用 floor 推算最近插入位。
export function groupChildRect(group, index) {
  const rowHeight = GROUP.itemH + GROUP.itemGap
  const colWidth = GROUP.itemW + GROUP.itemGap
  const columns = Math.max(1, group.columns)
  const row = Math.floor(index / columns)
  const col = index % columns
  return {
    x: group.x + GROUP.padding + col * colWidth,
    y: group.y + GROUP.header + GROUP.padding + row * rowHeight - (group.scrollTop ?? 0),
    width: GROUP.itemW,
    height: GROUP.itemH,
  }
}

export function groupGridIndexAt(group, point) {
  for (let index = 0; index < group.children.length; index++) {
    if (containsPoint(groupChildRect(group, index), point)) return index
  }

  const rowHeight = GROUP.itemH + GROUP.itemGap
  const colWidth = GROUP.itemW + GROUP.itemGap
  const columns = Math.max(1, group.columns)
  const localX = point.x - group.x - GROUP.padding
  const localY = point.y - group.y - GROUP.header - GROUP.padding + (group.scrollTop ?? 0)
  const col = Math.min(columns - 1, Math.max(0, Math.floor(localX / colWidth)))
  const row = Math.max(0, Math.floor(localY / rowHeight))
  return Math.min(group.children.length, row * columns + col)
}

// 阈值判断用屏幕像素坐标（不是世界坐标），保证以后第三阶段加入缩放后
// 阈值含义不变（像素距离，不受 viewport.scale 影响）。
export function exceedsDragThreshold(startScreenPoint, currentScreenPoint, thresholdPx = 4) {
  return Math.hypot(currentScreenPoint.x - startScreenPoint.x, currentScreenPoint.y - startScreenPoint.y) > thresholdPx
}

/** macOS 为 ⌘（Meta），Windows/Linux 为 Ctrl。 */
export function isModKey(event) {
  if (!event) return false
  if (event.metaKey || event.ctrlKey) return true
  if (typeof event.getModifierState === 'function') {
    return event.getModifierState('Meta') || event.getModifierState('Control')
  }
  return false
}

// 指针（世界坐标 y）靠近分组框上/下边缘 edgeZone 范围内时，返回这一帧应叠加到
// scrollTop 上的增量，越靠边缘越接近 maxSpeed；不可滚动或不在热区时返回 0。
export function groupAutoScrollSpeed(group, pointerWorldY, edgeZone = 24, maxSpeed = 8) {
  if (!group.overflowY) return 0
  const top = group.y + GROUP.header
  const bottom = group.y + group.height
  if (pointerWorldY < top || pointerWorldY > bottom) return 0
  if (pointerWorldY < top + edgeZone) {
    return -maxSpeed * Math.min(1, (top + edgeZone - pointerWorldY) / edgeZone)
  }
  if (pointerWorldY > bottom - edgeZone) {
    return maxSpeed * Math.min(1, (pointerWorldY - (bottom - edgeZone)) / edgeZone)
  }
  return 0
}

// 把组内（相对于"去掉被拖项后的 group.children"）插入下标换算成 parent.children
// 的绝对下标，供 graph.js 的 reorderGroupChild 使用。分组永远是 parent.children
// 里的一段连续区间：在"去掉被拖项后的 parent.children"里找这段区间的起始位置，
// 加上组内插入下标。
export function groupInsertIndexToParentIndex(parent, group, draggingChildId, insertIndexInRest) {
  const filteredParentChildren = parent.children.filter((id) => id !== draggingChildId)
  const restGroupChildren = group.children.filter((id) => id !== draggingChildId)
  const segmentStart = filteredParentChildren.indexOf(restGroupChildren[0])
  return segmentStart + insertIndexInRest
}

function isNodeOrDescendant(graph, nodeId, candidateId) {
  let current = candidateId
  while (current) {
    if (current === nodeId) return true
    current = graph.nodes.get(current)?.parentId ?? null
  }
  return false
}

const EDGE_THRESHOLD_SCREEN_PX = 5

// 悬停目标矩形按 cross 轴分三段：起始边/结束边各留一条窄带（插入排序），
// 中间大片区域是嵌套（变成子节点）。窄带宽度按屏幕像素换算成世界单位传入，
// 缩放后窄带的视觉宽度不变；矩形太小塞不下两条窄带时各自收缩到一半，
// 保证不会重叠、也不会出现"中间区域宽度为负"。
function siblingDropZoneAt(graph, layout, point, draggedNodeId, targetNodeId, direction, edgeThresholdWorld, excludeNodeIds = null) {
  const excluded = new Set(excludeNodeIds ?? [draggedNodeId])
  const target = graph.nodes.get(targetNodeId)
  if (!target?.parentId) return null
  const parent = graph.nodes.get(target.parentId)
  const targetRect = layout.nodes.get(targetNodeId)
  if (!parent || !targetRect || !parent.children.includes(targetNodeId)) return null

  const restChildren = parent.children.filter((id) => !excluded.has(id))
  const targetIndex = restChildren.indexOf(targetNodeId)
  if (targetIndex === -1) return null

  const crossStart = direction === 'vertical' ? targetRect.x : targetRect.y
  const crossExtent = direction === 'vertical' ? targetRect.width : targetRect.height
  const pointCross = direction === 'vertical' ? point.x : point.y
  const threshold = Math.min(edgeThresholdWorld, crossExtent / 2)

  if (pointCross <= crossStart + threshold) return { mode: 'before', insertIndex: targetIndex }
  if (pointCross >= crossStart + crossExtent - threshold) return { mode: 'after', insertIndex: targetIndex + 1 }
  return { mode: 'nest' }
}

function collectParentIdsWithPlainChildren(graph, layout) {
  const parentIds = new Set()
  for (const id of layout.nodes.keys()) {
    const node = graph.nodes.get(id)
    if (node?.parentId) parentIds.add(node.parentId)
  }
  return parentIds
}

function siblingGapHitInParent(graph, layout, point, parentId, excluded, direction) {
  const parent = graph.nodes.get(parentId)
  if (!parent) return null

  const restChildren = parent.children.filter((id) => !excluded.has(id))
  const plainRestChildren = restChildren.filter((id) => layout.nodes.has(id))

  for (let i = 0; i < plainRestChildren.length - 1; i++) {
    const idA = plainRestChildren[i]
    const idB = plainRestChildren[i + 1]
    if (restChildren.indexOf(idB) !== restChildren.indexOf(idA) + 1) continue
    const rectA = layout.nodes.get(idA)
    const rectB = layout.nodes.get(idB)
    const gapRect =
      direction === 'vertical'
        ? {
            x: rectA.x + rectA.width,
            y: Math.min(rectA.y, rectB.y),
            width: rectB.x - (rectA.x + rectA.width),
            height: Math.max(rectA.height, rectB.height),
          }
        : {
            x: Math.min(rectA.x, rectB.x),
            y: rectA.y + rectA.height,
            width: Math.max(rectA.width, rectB.width),
            height: rectB.y - (rectA.y + rectA.height),
          }
    if (containsPoint(gapRect, point)) {
      return { insertIndex: restChildren.indexOf(idB) }
    }
  }
  return null
}

// 在"去掉被拖节点后的兄弟列表"里找相邻两个之间的物理空隙（SIBLING_GAP），
// 命中即判定插入到它们之间——比窄带宽得多，是拖拽时最自然会瞄准的落点，
// 不要求像素级精确停在某个节点边缘上。只看仍是平铺节点（未被分组框消费）的兄弟，
// 分组框内部的命中检测走另一套机制，不归这里管。
function siblingGapHitAt(graph, layout, point, draggedNodeId, direction, excludeNodeIds = null) {
  const excluded = new Set(excludeNodeIds ?? [draggedNodeId])
  for (const parentId of collectParentIdsWithPlainChildren(graph, layout)) {
    const hit = siblingGapHitInParent(graph, layout, point, parentId, excluded, direction)
    if (hit) return { parentId, insertIndex: hit.insertIndex }
  }
  return null
}

// 插入预览框（跟标准节点同样大小）的世界坐标位置：命中空隙时居中在空隙上。
// insertIndex 只会是 siblingGapHitAt 命中空隙时返回的下标，两侧节点必然都存在，
// 不需要兜底分支。
function siblingGapPreviewRect(graph, layout, parentId, excluded, insertIndex, direction) {
  const parent = graph.nodes.get(parentId)
  const restChildren = parent.children.filter((id) => !excluded.has(id))
  const rectA = layout.nodes.get(restChildren[insertIndex - 1])
  const rectB = layout.nodes.get(restChildren[insertIndex])
  if (direction === 'vertical') {
    const centerX = (rectA.x + rectA.width + rectB.x) / 2
    return { x: centerX - NODE.width / 2, y: rectA.y, width: NODE.width, height: NODE.height }
  }
  const centerY = (rectA.y + rectA.height + rectB.y) / 2
  return { x: rectA.x, y: centerY - NODE.height / 2, width: NODE.width, height: NODE.height }
}

// 命中边缘窄带时（没有相邻空隙可用，比如列表最前/最后一个），预览框贴在目标
// 节点对应那条边的外侧。
function siblingEdgePreviewRect(layout, targetNodeId, mode, direction) {
  const targetRect = layout.nodes.get(targetNodeId)
  if (direction === 'vertical') {
    const x = mode === 'before' ? targetRect.x - NODE.width : targetRect.x + targetRect.width
    return { x, y: targetRect.y, width: NODE.width, height: NODE.height }
  }
  const y = mode === 'before' ? targetRect.y - NODE.height : targetRect.y + targetRect.height
  return { x: targetRect.x, y, width: NODE.width, height: NODE.height }
}

// 嵌套模式下，把被拖节点追加成目标节点的最后一个子节点会出现在哪——优先贴在
// 目标现有最后一个仍是平铺节点（未被分组框消费）的子节点后面，跟 siblingEdgePreviewRect
// 的 'after' 逻辑完全一样，只是锚点换成目标的子节点而不是被拖节点的兄弟。目标没有平铺
// 子节点时（没有子节点，或所有子节点都被分组框消费），退回固定偏移：主轴上跟目标保持
// 一层深度（LEVEL_GAP），交叉轴上跟目标自身对齐——这种情况下预览框可能跟目标已有的
// 分组框轻微重叠，是简化设计下的预期效果，不是 bug。
function attachPreviewRect(graph, layout, draggedNodeId, targetParentId, direction) {
  const target = graph.nodes.get(targetParentId)
  const restChildren = draggedNodeId ? target.children.filter((id) => id !== draggedNodeId) : target.children
  const plainRestChildren = restChildren.filter((id) => layout.nodes.has(id))
  const lastChildId = plainRestChildren[plainRestChildren.length - 1]
  if (lastChildId) return siblingEdgePreviewRect(layout, lastChildId, 'after', direction)

  const targetRect = layout.nodes.get(targetParentId)
  return direction === 'vertical'
    ? { x: targetRect.x, y: targetRect.y + targetRect.height + LEVEL_GAP, width: NODE.width, height: NODE.height }
    : { x: targetRect.x + targetRect.width + LEVEL_GAP, y: targetRect.y, width: NODE.width, height: NODE.height }
}

function insertIndexPreviewRect(graph, layout, parentId, insertIndex, direction) {
  const parent = graph.nodes.get(parentId)
  if (!parent) return null
  const { children } = parent
  const clampedIndex = Math.max(0, Math.min(insertIndex, children.length))

  let beforeId = null
  let afterId = null
  for (let i = clampedIndex - 1; i >= 0; i -= 1) {
    if (layout.nodes.has(children[i])) {
      beforeId = children[i]
      break
    }
  }
  for (let i = clampedIndex; i < children.length; i += 1) {
    if (layout.nodes.has(children[i])) {
      afterId = children[i]
      break
    }
  }

  if (beforeId && afterId && children.indexOf(afterId) === children.indexOf(beforeId) + 1) {
    return siblingGapPreviewRect(graph, layout, parentId, new Set(), children.indexOf(afterId), direction)
  }
  if (afterId) return siblingEdgePreviewRect(layout, afterId, 'before', direction)
  if (beforeId) return siblingEdgePreviewRect(layout, beforeId, 'after', direction)
  return attachPreviewRect(graph, layout, null, parentId, direction)
}

// 资源树拖入悬停时的插入/挂载预览，语义与 resolveResourceDropTarget 一致。
export function resolveResourceDropPreview(graph, layout, point, direction, selectedIds, rootIds) {
  const hit = hitTest(layout, point)

  if (hit?.type === 'node') {
    const parentId = hit.id
    return {
      valid: true,
      parentId,
      previewRect: attachPreviewRect(graph, layout, null, parentId, direction),
      parentRect: layout.nodes.get(parentId) ?? null,
    }
  }

  if (hit?.type === 'group' && hit.zone === 'item') {
    const parentId = hit.childId
    return {
      valid: true,
      parentId,
      previewRect: attachPreviewRect(graph, layout, null, parentId, direction),
      parentRect: layout.nodes.get(parentId) ?? null,
    }
  }

  const parentId = selectedIds[0] ?? rootIds[0]
  const parent = graph.nodes.get(parentId)
  if (!parent) return { valid: false }

  const insertIndex = findInsertionIndex(graph, layout, parentId, point, direction)
  return {
    valid: true,
    parentId,
    previewRect: insertIndexPreviewRect(graph, layout, parentId, insertIndex, direction),
    parentRect: layout.nodes.get(parentId) ?? null,
  }
}

// 拖拽悬停目标解析：先看是否命中两个相邻兄弟之间的物理空隙（插入排序，最容易瞄准）；
// 否则命中分组框 item 时返回真实父节点 + 该分组 + 组内插入下标；
// 命中同父兄弟普通节点的边缘窄带时返回共同父节点 + 兄弟插入下标（插入排序）；
// 命中同父兄弟普通节点中间区域、或命中非兄弟普通节点时，该节点本身就是新的目标父节点，
// 不计算插入下标（追加到末尾，嵌套变成子节点）；
// 命中分组框 header、命中空白、或目标是被拖节点自己/其后代时，返回 invalid。
export function resolveDropTarget(
  graph,
  layout,
  point,
  draggedNodeId,
  direction = 'horizontal',
  viewportScale = 1,
  excludeNodeIds = null,
) {
  const excluded = new Set(excludeNodeIds ?? [draggedNodeId])
  const edgeThresholdWorld = EDGE_THRESHOLD_SCREEN_PX / viewportScale

  const gapHit = siblingGapHitAt(graph, layout, point, draggedNodeId, direction, [...excluded])
  if (gapHit) {
    return {
      valid: true,
      parentId: gapHit.parentId,
      group: null,
      insertIndex: gapHit.insertIndex,
      previewRect: siblingGapPreviewRect(graph, layout, gapHit.parentId, excluded, gapHit.insertIndex, direction),
    }
  }

  const hit = hitTest(layout, point)
  if (!hit) return { valid: false }

  if (hit.type === 'group' && hit.zone === 'item') {
    const group = layout.groups.find((g) => g.id === hit.id)
    if (!group) return { valid: false }
    const parentId = group.parentId
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    const restGroup = { ...group, children: group.children.filter((id) => !excluded.has(id)) }
    const insertIndex = groupGridIndexAt(restGroup, point)
    return { valid: true, parentId, group, insertIndex, previewRect: null }
  }

  if (hit.type === 'node') {
    if (hit.id === draggedNodeId || isNodeOrDescendant(graph, draggedNodeId, hit.id)) {
      return { valid: false }
    }
    const zone = siblingDropZoneAt(
      graph,
      layout,
      point,
      draggedNodeId,
      hit.id,
      direction,
      edgeThresholdWorld,
      [...excluded],
    )
    if (zone && zone.mode !== 'nest') {
      const targetNode = graph.nodes.get(hit.id)
      return {
        valid: true,
        parentId: targetNode.parentId,
        group: null,
        insertIndex: zone.insertIndex,
        previewRect: siblingEdgePreviewRect(layout, hit.id, zone.mode, direction),
      }
    }
    const parentId = hit.id
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    return {
      valid: true,
      parentId,
      group: null,
      insertIndex: null,
      previewRect: attachPreviewRect(graph, layout, draggedNodeId, parentId, direction),
    }
  }

  return { valid: false }
}

// 屏幕坐标点靠近容器边缘时返回应叠加的视口平移速度；中心区域返回 {x:0, y:0}。
export function edgePanVelocity(screenPoint, containerWidth, containerHeight, edgeZone = 24, maxSpeed = 12) {
  const axisVelocity = (coord, size) => {
    if (coord < edgeZone) return -maxSpeed * Math.min(1, (edgeZone - coord) / edgeZone)
    if (coord > size - edgeZone) return maxSpeed * Math.min(1, (coord - (size - edgeZone)) / edgeZone)
    return 0
  }
  return {
    x: axisVelocity(screenPoint.x, containerWidth),
    y: axisVelocity(screenPoint.y, containerHeight),
  }
}

export function scrollbarMetrics(group) {
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

export function hitScrollbarThumb(layout, point) {
  for (const group of layout.groups) {
    if (!group.overflowY) continue
    const metrics = scrollbarMetrics(group)
    const withinX = point.x >= metrics.trackX && point.x <= metrics.trackX + SCROLLBAR_WIDTH
    const withinY = point.y >= metrics.thumbY && point.y <= metrics.thumbY + metrics.thumbHeight
    if (withinX && withinY) return { group, metrics }
  }
  return null
}
