// Phase 1/2 Vue 壳切片：命中检测 + 拖入插入下标 + 分组内拖拽换位的几何计算，
// 纯函数、不依赖 DOM。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
// 和 docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md

import { GROUP, visibleGroupChildren } from './layout.js'

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
  for (const item of layout.visibleItems) {
    if (!containsPoint(item, point)) continue
    if (item.type === 'node') return { type: 'node', id: item.id }
    const group = layout.groups.find((g) => g.id === item.id)
    return hitTestGroupZone(group, point)
  }
  return null
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

// 拖拽悬停目标解析：命中分组框 item 时返回真实父节点 + 该分组 + 组内插入下标；
// 命中普通节点时该节点本身就是新的目标父节点，不计算插入下标（追加到末尾）；
// 命中分组框 header、命中空白、或目标是被拖节点自己/其后代时，返回 invalid。
export function resolveDropTarget(graph, layout, point, draggedNodeId) {
  const hit = hitTest(layout, point)
  if (!hit) return { valid: false }

  if (hit.type === 'group' && hit.zone === 'item') {
    const group = layout.groups.find((g) => g.id === hit.id)
    if (!group) return { valid: false }
    const parentId = group.parentId
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    const restGroup = { ...group, children: group.children.filter((id) => id !== draggedNodeId) }
    const insertIndex = groupGridIndexAt(restGroup, point)
    return { valid: true, parentId, group, insertIndex }
  }

  if (hit.type === 'node') {
    const parentId = hit.id
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    return { valid: true, parentId, group: null, insertIndex: null }
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
