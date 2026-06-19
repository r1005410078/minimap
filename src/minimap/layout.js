// Phase 1 布局引擎：稳定分层树布局 + 布局级分组折叠 + 结构性虚拟化 + 视口锚点补偿。
// 纯 JS，不依赖 Vue / DOM。见 docs/superpowers/specs/2026-06-18-phase-1-core-logic.md

export const GROUP_THRESHOLD = 5

// Phase 1 内置默认值；后续接入组件时由 theme 覆盖。
const NODE = { width: 120, height: 40 }
const LEVEL_GAP = 80 // 主轴（深度方向）层距
const SIBLING_GAP = 24 // 交叉轴（兄弟方向）间距
const GROUP = { padding: 12, header: 28, itemW: 120, itemH: 40, itemGap: 10 }
const GROUP_MAX_W_RATIO = 0.48
const GROUP_MAX_H_RATIO = 0.42

// 重新布局后，让锚点节点保持在原屏幕位置：补偿视口偏移。
// screen = world * scale + viewport => viewport' = viewport + (before - after) * scale
export function keepAnchorStable(viewport, before, after) {
  return {
    x: viewport.x + (before.x - after.x) * viewport.scale,
    y: viewport.y + (before.y - after.y) * viewport.scale,
    scale: viewport.scale,
  }
}

function isLeaf(node) {
  return !node.children || node.children.length === 0
}

// 把 parentNode.children 按"连续叶子兄弟"分段；遇到带子节点的兄弟就结束当前段
// （这个兄弟自己永远不参与合并）。只返回长度超过 groupThreshold 的段，按出现顺序排列。
function collectGroupSegments(parentNode, graph, groupThreshold) {
  const segments = []
  let current = null
  for (const childId of parentNode.children || []) {
    const child = graph.nodes.get(childId)
    if (child && isLeaf(child)) {
      if (!current) {
        current = []
        segments.push(current)
      }
      current.push(childId)
    } else {
      current = null
    }
  }
  return segments.filter((segment) => segment.length > groupThreshold)
}

// 把一个分组的子节点列表折叠成分组框，按内部网格推导尺寸，同时受视口比例约束。
function buildGroup(groupId, parentId, children, viewportWidth, viewportHeight) {
  const maxW = viewportWidth * GROUP_MAX_W_RATIO
  const maxH = viewportHeight * GROUP_MAX_H_RATIO

  const columns = Math.max(
    1,
    Math.floor((maxW - 2 * GROUP.padding + GROUP.itemGap) / (GROUP.itemW + GROUP.itemGap)),
  )
  const rows = Math.ceil(children.length / columns)
  const contentWidth = 2 * GROUP.padding + columns * GROUP.itemW + (columns - 1) * GROUP.itemGap
  const contentHeight =
    GROUP.header + 2 * GROUP.padding + rows * GROUP.itemH + Math.max(0, rows - 1) * GROUP.itemGap

  return {
    id: groupId,
    parentId,
    children,
    columns,
    rows,
    width: Math.min(contentWidth, maxW),
    height: Math.min(contentHeight, maxH),
    overflowY: contentHeight > maxH,
    x: 0,
    y: 0,
  }
}

export function computeLayout(graph, options = {}) {
  const direction = options.direction === 'vertical' ? 'vertical' : 'horizontal'
  const viewportWidth = options.viewportWidth ?? 1200
  const viewportHeight = options.viewportHeight ?? 760
  const groupThreshold = options.groupThreshold ?? GROUP_THRESHOLD

  // 1. 按"连续叶子兄弟分段"规则折叠；一个父节点下可能产生 0、1 或多个分组。
  const groups = []
  const groupOf = new Map() // childId -> group，供下面的 itemOf 跳过已消费的子节点
  for (const node of graph.nodes.values()) {
    const segments = collectGroupSegments(node, graph, groupThreshold)
    segments.forEach((segmentChildren, segmentIndex) => {
      const groupId = `${node.id}::g${segmentIndex}`
      const group = buildGroup(groupId, node.id, segmentChildren, viewportWidth, viewportHeight)
      groups.push(group)
      for (const childId of segmentChildren) groupOf.set(childId, group)
    })
  }

  // 2. 构建布局项树：命中分组子节点时，只在该分组第一次出现的位置插入一个 group 项。
  const itemOf = (nodeId) => {
    const node = graph.nodes.get(nodeId)
    const childItems = []
    const consumedGroups = new Set()
    for (const childId of node.children || []) {
      const group = groupOf.get(childId)
      if (group) {
        if (consumedGroups.has(group.id)) continue
        consumedGroups.add(group.id)
        childItems.push({ type: 'group', group })
      } else {
        childItems.push(itemOf(childId))
      }
    }
    return { type: 'node', node, childItems }
  }

  const mainExtentOf = (item) =>
    item.type === 'group'
      ? direction === 'horizontal'
        ? item.group.width
        : item.group.height
      : direction === 'horizontal'
        ? NODE.width
        : NODE.height
  const crossExtentOf = (item) =>
    item.type === 'group'
      ? direction === 'horizontal'
        ? item.group.height
        : item.group.width
      : direction === 'horizontal'
        ? NODE.height
        : NODE.width

  // 3. 自底向上算交叉轴占用尺寸（group 与叶子节点是叶子项）。
  const crossSizeCache = new Map()
  const crossSizeOf = (item) => {
    if (crossSizeCache.has(item)) return crossSizeCache.get(item)
    const own = crossExtentOf(item)
    let size = own
    if (item.type === 'node' && item.childItems.length > 0) {
      let sum = 0
      item.childItems.forEach((child, i) => {
        sum += crossSizeOf(child)
        if (i < item.childItems.length - 1) sum += SIBLING_GAP
      })
      size = Math.max(own, sum)
    }
    crossSizeCache.set(item, size)
    return size
  }

  const nodes = new Map()
  const visibleItems = []
  let minMain = Infinity
  let maxMain = -Infinity
  let minCross = Infinity
  let maxCross = -Infinity

  // 4. 自顶向下分配世界坐标；父节点落在子项中线，深度决定主轴坐标。
  const place = (item, mainStart, crossStart) => {
    const mainExt = mainExtentOf(item)
    const crossExt = crossExtentOf(item)

    let center
    if (item.type === 'node' && item.childItems.length > 0) {
      const childMainStart = mainStart + mainExt + LEVEL_GAP
      let cursor = crossStart
      const centers = []
      for (const child of item.childItems) {
        centers.push(place(child, childMainStart, cursor))
        cursor += crossSizeOf(child) + SIBLING_GAP
      }
      const middle = Math.floor(centers.length / 2)
      center =
        centers.length % 2 === 1
          ? centers[middle]
          : (centers[middle - 1] + centers[middle]) / 2
    } else {
      center = crossStart + crossSizeOf(item) / 2
    }

    const crossTopLeft = center - crossExt / 2
    const x = direction === 'horizontal' ? mainStart : crossTopLeft
    const y = direction === 'horizontal' ? crossTopLeft : mainStart
    const width = direction === 'horizontal' ? mainExt : crossExt
    const height = direction === 'horizontal' ? crossExt : mainExt

    if (item.type === 'node') {
      nodes.set(item.node.id, { x, y, width, height })
      visibleItems.push({ type: 'node', id: item.node.id, x, y, width, height })
    } else {
      item.group.x = x
      item.group.y = y
      visibleItems.push({ type: 'group', id: item.group.id, parentId: item.group.parentId, x, y, width, height })
    }

    minMain = Math.min(minMain, mainStart)
    maxMain = Math.max(maxMain, mainStart + mainExt)
    minCross = Math.min(minCross, crossTopLeft)
    maxCross = Math.max(maxCross, crossTopLeft + crossExt)
    return center
  }

  let cursor = 0
  for (const rootId of graph.rootIds || []) {
    const item = itemOf(rootId)
    place(item, 0, cursor)
    cursor += crossSizeOf(item) + SIBLING_GAP
  }

  const bounds =
    direction === 'horizontal'
      ? { minX: minMain, maxX: maxMain, minY: minCross, maxY: maxCross }
      : { minX: minCross, maxX: maxCross, minY: minMain, maxY: maxMain }

  return { nodes, groups, visibleItems, bounds }
}
