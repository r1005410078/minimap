// 组内拖拽换位时的子节点矩形插值；纯函数，不依赖 Vue / Canvas。
import { easeOutCubic } from './layout-transition.js'
import { visibleGroupChildren } from './layout.js'

export function buildVirtualOrder(group, childId, insertIndex) {
  const order = group.children.filter((id) => id !== childId)
  order.splice(insertIndex, 0, childId)
  return order
}

export function childWorldRectsById(group, order) {
  const virtualGroup = { ...group, children: order }
  const rects = {}
  for (const child of visibleGroupChildren(virtualGroup)) {
    rects[child.id] = { ...child.rect }
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
