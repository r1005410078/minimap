// 组内拖拽换位时的子节点矩形插值；纯函数，不依赖 Vue / Canvas。
import { easeOutCubic } from '../graph/layout-transition.js'
import { GROUP } from '../graph/layout.js'

export function buildVirtualOrder(children, childId, insertIndex) {
  const order = children.filter((id) => id !== childId)
  order.splice(insertIndex, 0, childId)
  return order
}

export function buildVirtualOrderMulti(children, dragNodeIds, insertIndex) {
  const dragSet = new Set(dragNodeIds)
  const block = children.filter((id) => dragSet.has(id))
  const rest = children.filter((id) => !dragSet.has(id))
  const order = [...rest]
  order.splice(insertIndex, 0, ...block)
  return order
}

export function childWorldRectsById(group, order) {
  const columns = Math.max(1, group.columns)
  const rects = {}
  const rowHeight = GROUP.itemH + GROUP.itemGap
  for (let i = 0; i < order.length; i++) {
    const childId = order[i]
    const row = Math.floor(i / columns)
    const col = i % columns
    rects[childId] = {
      x: group.x + GROUP.padding + col * (GROUP.itemW + GROUP.itemGap),
      y: group.y + GROUP.header + GROUP.padding + row * rowHeight - group.scrollTop,
      width: GROUP.itemW,
      height: GROUP.itemH,
    }
  }
  return rects
}

export function interpolateChildRects(fromById, toById, progress) {
  const ids = new Set([...Object.keys(fromById), ...Object.keys(toById)])
  const result = {}
  for (const id of ids) {
    const from = fromById[id] ?? toById[id]
    const to = toById[id] ?? fromById[id]
    if (!from || !to) continue
    result[id] = {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      width: from.width + (to.width - from.width) * progress,
      height: from.height + (to.height - from.height) * progress,
    }
  }
  return result
}

export function dragShiftProgress(startedAt, durationMs, now) {
  if (startedAt == null || durationMs <= 0) return 1
  return Math.min(1, (now - startedAt) / durationMs)
}

export function dragShiftEasedProgress(startedAt, durationMs, now) {
  return easeOutCubic(dragShiftProgress(startedAt, durationMs, now))
}

export function currentShiftRects(fromById, toById, startedAt, durationMs, now) {
  const progress = dragShiftEasedProgress(startedAt, durationMs, now)
  return interpolateChildRects(fromById, toById, progress)
}
