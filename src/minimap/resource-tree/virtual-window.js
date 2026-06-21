const DEFAULT_OVERSCAN = 20
const FAST_OVERSCAN = 100

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function resolveVirtualWindow({
  rowCount,
  rowHeight,
  viewportHeight,
  scrollTop,
  previousScrollTop = scrollTop,
  overscan = DEFAULT_OVERSCAN,
  fastOverscan = FAST_OVERSCAN,
  fastScrollThreshold = viewportHeight * 2,
}) {
  const totalHeight = Math.max(0, rowCount) * rowHeight
  const effectiveOverscan = Math.abs(scrollTop - previousScrollTop) > fastScrollThreshold ? fastOverscan : overscan
  if (rowCount <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight: 0, overscan: effectiveOverscan }
  }

  const maxScrollTop = Math.max(0, totalHeight - viewportHeight)
  const clampedScrollTop = clamp(scrollTop, 0, maxScrollTop)
  const firstVisible = Math.floor(clampedScrollTop / rowHeight)
  const visibleCount = Math.ceil(viewportHeight / rowHeight)
  const start = clamp(firstVisible - effectiveOverscan, 0, rowCount)
  const end = clamp(firstVisible + visibleCount + effectiveOverscan, start, rowCount)
  return {
    start,
    end,
    offsetY: start * rowHeight,
    totalHeight,
    overscan: effectiveOverscan,
  }
}
