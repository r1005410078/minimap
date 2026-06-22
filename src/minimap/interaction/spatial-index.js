// 性能优化切片 3：顶层可见项（节点矩形 + 分组外框矩形）的网格空间索引，
// 给 hitTest 和框选范围查询用。只覆盖 layout.visibleItems，不覆盖分组内部子节点——
// 分组内部命中范围本身受可见窗口限制，不是这里要解决的瓶颈。
// 见 docs/superpowers/specs/2026-06-22-spatial-index-design.md

const DEFAULT_CELL_WIDTH = 256
const DEFAULT_CELL_HEIGHT = 128

function cellKey(col, row) {
  return `${col}:${row}`
}

function addToBucket(buckets, key, item) {
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = []
    buckets.set(key, bucket)
  }
  bucket.push(item)
}

export function buildSpatialIndex(layout, { cellWidth = DEFAULT_CELL_WIDTH, cellHeight = DEFAULT_CELL_HEIGHT } = {}) {
  const buckets = new Map()
  for (const item of layout.visibleItems) {
    const startCol = Math.floor(item.x / cellWidth)
    const endCol = Math.floor((item.x + item.width) / cellWidth)
    const startRow = Math.floor(item.y / cellHeight)
    const endRow = Math.floor((item.y + item.height) / cellHeight)
    for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
        addToBucket(buckets, cellKey(col, row), item)
      }
    }
  }
  return { cellWidth, cellHeight, buckets }
}

function containsPoint(item, point) {
  return (
    point.x >= item.x &&
    point.x <= item.x + item.width &&
    point.y >= item.y &&
    point.y <= item.y + item.height
  )
}

function intersects(a, b) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

export function queryPoint(index, point) {
  const col = Math.floor(point.x / index.cellWidth)
  const row = Math.floor(point.y / index.cellHeight)
  const bucket = index.buckets.get(cellKey(col, row))
  if (!bucket) return null
  for (const item of bucket) {
    if (containsPoint(item, point)) return item
  }
  return null
}

export function queryRect(index, rect) {
  const startCol = Math.floor(rect.x / index.cellWidth)
  const endCol = Math.floor((rect.x + rect.width) / index.cellWidth)
  const startRow = Math.floor(rect.y / index.cellHeight)
  const endRow = Math.floor((rect.y + rect.height) / index.cellHeight)
  const seen = new Set()
  const matches = []
  for (let col = startCol; col <= endCol; col++) {
    for (let row = startRow; row <= endRow; row++) {
      const bucket = index.buckets.get(cellKey(col, row))
      if (!bucket) continue
      for (const item of bucket) {
        if (seen.has(item)) continue
        seen.add(item)
        if (intersects(item, rect)) matches.push(item)
      }
    }
  }
  return matches
}

const indexCache = new WeakMap()

export function getSpatialIndex(layout) {
  let index = indexCache.get(layout)
  if (!index) {
    index = buildSpatialIndex(layout)
    indexCache.set(layout, index)
  }
  return index
}
