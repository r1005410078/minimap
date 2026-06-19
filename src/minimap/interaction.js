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
  for (const group of groupsOfParent) {
    if (containsPoint(group, point)) {
      const lastChildId = group.children[group.children.length - 1]
      return children.indexOf(lastChildId) + 1
    }
  }

  const pointCross = direction === 'vertical' ? point.x : point.y
  for (let i = 0; i < children.length; i++) {
    if (groupsOfParent.some((group) => group.children.includes(children[i]))) continue
    const rect = layout.nodes.get(children[i])
    if (!rect) continue
    const cross = direction === 'vertical' ? rect.x + rect.width / 2 : rect.y + rect.height / 2
    if (pointCross < cross) return i
  }
  return children.length
}

// 世界坐标点 -> 分组网格里的插入下标（0..group.children.length）。
// 不要求该下标当前真的有子节点：用于拖拽悬停时实时算插入位置。
// col 用 Math.round 而非 Math.floor，靠近格子左右半边时四舍五入到更近的插入缝；
// 超出分组矩形范围的点会被 clamp 到最近的合法行/列，天然限制"只能在同一分组框内换位"。
export function groupGridIndexAt(group, point) {
  const rowHeight = GROUP.itemH + GROUP.itemGap
  const colWidth = GROUP.itemW + GROUP.itemGap
  const columns = Math.max(1, group.columns)
  const localX = point.x - group.x - GROUP.padding
  const localY = point.y - group.y - GROUP.header - GROUP.padding + group.scrollTop
  const col = Math.min(columns - 1, Math.max(0, Math.round(localX / colWidth)))
  const row = Math.max(0, Math.round(localY / rowHeight))
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
