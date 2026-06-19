// Phase 1 布局切换动画：纯 layout / viewport 插值逻辑。
// 不依赖 Vue、Canvas 或 DOM。见 docs/superpowers/specs/2026-06-19-phase-1-layout-transition.md

const DEFAULT_DURATION_MS = 200

function clamp01(value) {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function easeOutCubic(value) {
  const t = clamp01(value)
  return 1 - Math.pow(1 - t, 3)
}

function itemKey(item) {
  return item.type === 'group' ? `group:${item.id}` : `node:${item.id}`
}

function rectOf(item) {
  return {
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  }
}

function interpolateNumber(from, to, progress) {
  return from + (to - from) * progress
}

function interpolateRect(from, to, progress) {
  return {
    x: interpolateNumber(from.x, to.x, progress),
    y: interpolateNumber(from.y, to.y, progress),
    width: interpolateNumber(from.width, to.width, progress),
    height: interpolateNumber(from.height, to.height, progress),
  }
}

function indexVisibleItems(layout) {
  const byKey = new Map()
  for (const item of layout.visibleItems || []) byKey.set(itemKey(item), rectOf(item))
  return byKey
}

function transitionRect(fromItems, targetItem, progress) {
  const target = rectOf(targetItem)
  const from = fromItems.get(itemKey(targetItem))
  return from ? interpolateRect(from, target, progress) : target
}

function calculateBounds(visibleItems, fallback) {
  if (!visibleItems.length) return fallback
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of visibleItems) {
    minX = Math.min(minX, item.x)
    minY = Math.min(minY, item.y)
    maxX = Math.max(maxX, item.x + item.width)
    maxY = Math.max(maxY, item.y + item.height)
  }
  return { minX, minY, maxX, maxY }
}

function interpolateViewport(from, to, progress) {
  return {
    x: interpolateNumber(from.x, to.x, progress),
    y: interpolateNumber(from.y, to.y, progress),
    scale: from.scale,
  }
}

export function createLayoutTransition({
  fromLayout,
  toLayout,
  fromViewport,
  toViewport,
  durationMs = DEFAULT_DURATION_MS,
}) {
  return {
    fromItems: indexVisibleItems(fromLayout),
    toLayout,
    fromViewport: { ...fromViewport },
    toViewport: { ...toViewport },
    durationMs,
  }
}

export function layoutAt(transition, progress) {
  const eased = easeOutCubic(progress)
  const visibleItems = transition.toLayout.visibleItems.map((item) => ({
    ...item,
    ...transitionRect(transition.fromItems, item, eased),
  }))

  const rectByKey = new Map(visibleItems.map((item) => [itemKey(item), rectOf(item)]))
  const nodes = new Map()
  for (const [id, rect] of transition.toLayout.nodes.entries()) {
    nodes.set(id, rectByKey.get(`node:${id}`) || { ...rect })
  }

  const groups = transition.toLayout.groups.map((group) => ({
    ...group,
    ...(rectByKey.get(`group:${group.id}`) || rectOf(group)),
  }))

  return {
    layout: {
      nodes,
      groups,
      visibleItems,
      bounds: calculateBounds(visibleItems, transition.toLayout.bounds),
    },
    viewport: interpolateViewport(transition.fromViewport, transition.toViewport, eased),
  }
}

export function resolveAnchorCenter(layout, id) {
  if (!id) return null
  const rect = layout.nodes.get(id)
  if (!rect) return null
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }
}
