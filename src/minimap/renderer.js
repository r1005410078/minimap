// Phase 1 Canvas 渲染器：默认绘制 + 自定义绘制钩子 + 视口裁剪 + 渲染统计。
// 只做渲染逻辑，ctx 由外部传入（真实或 mock），不碰 DOM。
// 见 docs/superpowers/specs/2026-06-18-phase-1-canvas-renderer.md

import { worldToScreen } from './coords.js'
import { orthogonalPath } from './orthogonal.js'
import { defaultTheme } from './theme.js'
import { GROUP, visibleGroupChildren } from './layout.js'

const now = () => (globalThis.performance ?? Date).now()

// --- 纯函数（可单测，不依赖 ctx）---

export function worldRectToScreen(rect, viewport) {
  return {
    x: rect.x * viewport.scale + viewport.x,
    y: rect.y * viewport.scale + viewport.y,
    width: rect.width * viewport.scale,
    height: rect.height * viewport.scale,
  }
}

function intersectsViewport(screen, width, height) {
  return (
    screen.x + screen.width >= 0 &&
    screen.x <= width &&
    screen.y + screen.height >= 0 &&
    screen.y <= height
  )
}

// 以 layout.visibleItems 为候选，剔除屏幕矩形与 [0,0,width,height] 不相交的项。
export function collectVisible(layout, viewport, width, height) {
  const items = []
  let culled = 0
  for (const item of layout.visibleItems) {
    const screen = worldRectToScreen(item, viewport)
    if (intersectsViewport(screen, width, height)) items.push({ item, screen })
    else culled++
  }
  return { items, culled }
}

const centerOfBox = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

function roundedRect(ctx, rect, radius) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius)
    return
  }
  const r = Math.min(radius, rect.width / 2, rect.height / 2)
  ctx.moveTo(rect.x + r, rect.y)
  ctx.lineTo(rect.x + rect.width - r, rect.y)
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + r)
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - r)
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - r, rect.y + rect.height)
  ctx.lineTo(rect.x + r, rect.y + rect.height)
  ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - r)
  ctx.lineTo(rect.x, rect.y + r)
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y)
}

// childId -> 它所属的分组（一个父节点下的每个分组各自的 children 互不重叠）。
function groupByChildId(layout) {
  return new Map(layout.groups.flatMap((group) => group.children.map((id) => [id, group])))
}

// 父子树默认连线 + graph.edges 业务线；端点为世界坐标中心，
// 端点落在被折叠子节点上时路由到其所在分组框（按 childId 直接查，不经过 node.parentId）。
export function resolveEdges(graph, layout) {
  const edges = []
  const byChildId = groupByChildId(layout)

  const resolveEndpoint = (id) => {
    const box = layout.nodes.get(id)
    if (box) return { box, point: centerOfBox(box) }
    const group = byChildId.get(id)
    return group ? { box: group, point: centerOfBox(group) } : null
  }

  for (const item of layout.visibleItems) {
    if (item.type !== 'node') continue
    const node = graph.nodes.get(item.id)
    if (!node || !node.children || node.children.length === 0) continue
    const parentCenter = centerOfBox(item)
    const parentBox = layout.nodes.get(item.id)
    const consumedGroups = new Set()

    for (const childId of node.children) {
      const group = byChildId.get(childId)
      if (group) {
        if (consumedGroups.has(group.id)) continue
        consumedGroups.add(group.id)
        edges.push({
          id: `tree:group:${group.id}`,
          kind: 'tree',
          from: parentCenter,
          to: centerOfBox(group),
          fromBox: parentBox,
          toBox: group,
        })
      } else {
        const childBox = layout.nodes.get(childId)
        if (childBox) {
          edges.push({
            id: `tree:${item.id}:${childId}`,
            kind: 'tree',
            from: parentCenter,
            to: centerOfBox(childBox),
            fromBox: parentBox,
            toBox: childBox,
          })
        }
      }
    }
  }

  for (const edge of graph.edges || []) {
    const from = resolveEndpoint(edge.source)
    const to = resolveEndpoint(edge.target)
    if (from && to) {
      edges.push({
        id: edge.id,
        kind: edge.kind || 'relation',
        from: from.point,
        to: to.point,
        fromBox: from.box,
        toBox: to.box,
      })
    }
  }

  return edges
}

// --- 默认绘制（发 ctx 调用，可被 renderers 覆盖）---

function makeState(id, selectedIds, highlightedIds, dimmedIds) {
  return {
    selected: selectedIds ? selectedIds.has(id) : false,
    hovered: false,
    dragging: false,
    highlighted: highlightedIds ? highlightedIds.has(id) : false,
    dimmed: dimmedIds ? dimmedIds.has(id) : false,
    readonly: false,
  }
}

function drawGrid(ctx, width, height, viewport, theme) {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)
  const size = theme.grid.size * viewport.scale
  if (size < 4) return
  const grid = { dot: true, dotRadius: 1.1, ...(theme.grid || {}) }
  if (grid.dot !== false) {
    ctx.fillStyle = grid.color
    const radius = Math.max(0.6, (grid.dotRadius ?? 1) * viewport.scale)
    for (let x = viewport.x % size; x <= width; x += size) {
      for (let y = viewport.y % size; y <= height; y += size) {
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    return
  }
  ctx.strokeStyle = grid.color
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = viewport.x % size; x <= width; x += size) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
  }
  for (let y = viewport.y % size; y <= height; y += size) {
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
  }
  ctx.stroke()
}

function drawArrow(ctx, start, end, theme) {
  const edgeTheme = { ...defaultTheme.edge, ...(theme.edge || {}) }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return

  const ux = dx / length
  const uy = dy / length
  const px = -uy
  const py = ux
  const size = edgeTheme.arrowSize
  const baseX = end.x - ux * size
  const baseY = end.y - uy * size
  const halfWidth = size / 2

  ctx.fillStyle = edgeTheme.color
  ctx.beginPath()
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(baseX + px * halfWidth, baseY + py * halfWidth)
  ctx.lineTo(baseX - px * halfWidth, baseY - py * halfWidth)
  ctx.closePath()
  ctx.fill()
}

function lastNonZeroSegment(points) {
  for (let index = points.length - 1; index > 0; index--) {
    const start = points[index - 1]
    const end = points[index]
    if (start.x !== end.x || start.y !== end.y) return { start, end }
  }
  return null
}

function drawEdge(ctx, points, theme) {
  const edgeTheme = { ...defaultTheme.edge, ...(theme.edge || {}) }
  ctx.strokeStyle = edgeTheme.color
  ctx.lineWidth = edgeTheme.width
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.stroke()
  const arrowSegment = lastNonZeroSegment(points)
  if (arrowSegment) drawArrow(ctx, arrowSegment.start, arrowSegment.end, theme)
}

function edgePayload(edge) {
  return {
    id: edge.id,
    kind: edge.kind,
    from: edge.from,
    to: edge.to,
  }
}

function withDimmedAlpha(ctx, state, draw) {
  const previousAlpha = ctx.globalAlpha ?? 1
  if (state.dimmed) ctx.globalAlpha = previousAlpha * 0.35
  draw()
  ctx.globalAlpha = previousAlpha
}

function edgeMainAxis(direction) {
  return direction === 'vertical' ? 'y' : 'x'
}

function inferDirectionFromLayout(graph, layout, edges) {
  const rootCenters = (graph.rootIds || [])
    .map((id) => layout.nodes.get(id))
    .filter(Boolean)
    .map(centerOfBox)
  if (rootCenters.length >= 2) {
    const xs = rootCenters.map((point) => point.x)
    const ys = rootCenters.map((point) => point.y)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)
    if (spanX !== spanY) return spanX > spanY ? 'vertical' : 'horizontal'
  }

  const byChildId = groupByChildId(layout)
  for (const node of graph.nodes.values()) {
    const parentBox = layout.nodes.get(node.id)
    if (!parentBox || !node.children || node.children.length === 0) continue

    const targets = []
    const consumedGroups = new Set()
    for (const childId of node.children) {
      const group = byChildId.get(childId)
      if (group) {
        if (consumedGroups.has(group.id)) continue
        consumedGroups.add(group.id)
        targets.push(group)
      } else {
        const childBox = layout.nodes.get(childId)
        if (childBox) targets.push(childBox)
      }
    }
    if (targets.length === 0) continue

    const parentCenter = centerOfBox(parentBox)
    const avgTarget = targets.reduce(
      (acc, box) => {
        const point = centerOfBox(box)
        return { x: acc.x + point.x, y: acc.y + point.y }
      },
      { x: 0, y: 0 },
    )
    avgTarget.x /= targets.length
    avgTarget.y /= targets.length

    const dx = Math.abs(avgTarget.x - parentCenter.x)
    const dy = Math.abs(avgTarget.y - parentCenter.y)
    if (dx !== dy) return dy > dx ? 'vertical' : 'horizontal'
  }

  const treeEdge = edges.find((edge) => edge.kind === 'tree') || edges[0]
  if (!treeEdge) return 'horizontal'
  const dx = Math.abs(treeEdge.to.x - treeEdge.from.x)
  const dy = Math.abs(treeEdge.to.y - treeEdge.from.y)
  return dy > dx ? 'vertical' : 'horizontal'
}

const SCROLLBAR_WIDTH = 8
const SCROLLBAR_RADIUS = SCROLLBAR_WIDTH / 2

function drawGroup(ctx, graph, group, rect, state, theme, scrollbarHovered = false) {
  withDimmedAlpha(ctx, state, () => {
    ctx.fillStyle = theme.group.fill
    ctx.beginPath()
    roundedRect(ctx, rect, theme.group.radius ?? 12)
    ctx.fill()
    ctx.strokeStyle = state.selected
      ? theme.node.selectedStroke
      : state.highlighted
        ? theme.group.header
        : theme.group.stroke
    ctx.lineWidth = 1
    ctx.stroke()

    const parentNode = graph.nodes.get(group.parentId)
    const title = parentNode?.label ?? group.parentId
    const headerTextY = rect.y + 18
    const chevronX = rect.x + 14
    const titleX = chevronX + 12
    const countX = rect.x + rect.width - 16

    ctx.fillStyle = theme.group.header
    ctx.font = theme.group.font
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(title, titleX, headerTextY)
    ctx.textAlign = 'right'
    ctx.fillText(String(group.children.length), countX, headerTextY)
    const chevron = group.expanded ? '▾' : '▸'
    ctx.fillStyle = theme.group.header
    ctx.textAlign = 'left'
    ctx.fillText(chevron, chevronX, headerTextY)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    if (group.overflowY) drawGroupScrollbar(ctx, group, rect, theme, scrollbarHovered)
  })
}

// 滚动条轨道 + 按比例定位/取尺寸的滑块；交互命中由 Minimap.vue 复用同一套几何规则。
function drawGroupScrollbar(ctx, group, rect, theme, hovered) {
  const scrollbar = { ...defaultTheme.group.scrollbar, ...(theme.group.scrollbar || {}) }
  const scale = rect.height / group.height
  const headerHeight = GROUP.header * scale
  const trackX = rect.x + rect.width - SCROLLBAR_WIDTH
  const trackY = rect.y + headerHeight
  const trackHeight = rect.height - headerHeight

  ctx.fillStyle = scrollbar.track
  ctx.fillRect(trackX, trackY, SCROLLBAR_WIDTH, trackHeight)

  const thumbHeight = (group.height / group.contentHeight) * trackHeight
  const maxScroll = group.contentHeight - group.height
  const thumbOffset = maxScroll > 0 ? (group.scrollTop / maxScroll) * (trackHeight - thumbHeight) : 0
  const thumbY = trackY + thumbOffset
  ctx.fillStyle = hovered ? scrollbar.thumbHover : scrollbar.thumb
  ctx.beginPath()
  ctx.roundRect(trackX, thumbY, SCROLLBAR_WIDTH, thumbHeight, SCROLLBAR_RADIUS)
  ctx.fill()
}

function drawNode(ctx, node, rect, state, theme) {
  withDimmedAlpha(ctx, state, () => {
    ctx.fillStyle = theme.node.fill
    ctx.beginPath()
    roundedRect(ctx, rect, theme.node.radius ?? 6)
    ctx.fill()
    ctx.strokeStyle = state.selected
      ? theme.node.selectedStroke
      : state.highlighted
        ? theme.group.header
        : theme.node.stroke
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = theme.node.text
    ctx.font = theme.node.font
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.save()
    ctx.beginPath()
    roundedRect(ctx, rect, theme.node.radius ?? 6)
    ctx.clip()
    ctx.fillText(node.label ?? node.id, rect.x + 10, rect.y + rect.height / 2)
    ctx.restore()
  })
}

function drawDropSlot(ctx, rect, theme, opacity = 1) {
  const dropSlot = { ...defaultTheme.group.dropSlot, ...(theme.group.dropSlot || {}) }
  const previousAlpha = ctx.globalAlpha ?? 1
  ctx.globalAlpha = previousAlpha * opacity
  ctx.fillStyle = dropSlot.fill
  ctx.beginPath()
  roundedRect(ctx, rect, theme.group.radius ?? 12)
  ctx.fill()
  ctx.strokeStyle = dropSlot.stroke
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = previousAlpha
}

function drawSelectionRect(ctx, rect, theme) {
  const selection = { ...defaultTheme.node, ...(theme.node || {}) }
  const previousAlpha = ctx.globalAlpha ?? 1
  ctx.globalAlpha = previousAlpha * 0.16
  ctx.fillStyle = selection.selectedStroke
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.globalAlpha = previousAlpha
  ctx.strokeStyle = selection.selectedStroke
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.setLineDash([])
}

// 裁剪到分组框 body 范围内，对当前可见的每个子节点调用 nodeRenderer ?? drawNode——
// 跟顶层节点完全同一套绘制路径，所以自定义节点视觉在分组框内外保持一致。
function drawGroupChildren(ctx, graph, group, rect, viewport, theme, renderers, selectedIds, highlightedIds, dimmedIds, dragContext) {
  const virtualGroup = dragContext ? { ...group, children: dragContext.order } : group
  const bodyY = rect.y + GROUP.header * viewport.scale
  const bodyHeight = rect.height - GROUP.header * viewport.scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, bodyY, rect.width, bodyHeight)
  ctx.clip()
  for (const child of visibleGroupChildren(virtualGroup)) {
    const node = graph.nodes.get(child.id)
    if (!node) continue
    const worldRect = dragContext?.childRectsById?.[child.id] ?? child.rect
    const childRect = worldRectToScreen(worldRect, viewport)
    if (child.id === dragContext?.draggingChildId) {
      drawDropSlot(ctx, childRect, theme, dragContext.dropSlotOpacity ?? 1)
      continue
    }
    const itemState = makeState(child.id, selectedIds, highlightedIds, dimmedIds)
    if (renderers.node) renderers.node(ctx, { node, rect: childRect, state: itemState, theme, viewport })
    else drawNode(ctx, node, childRect, itemState, theme)
  }
  if (dragContext) {
    const node = graph.nodes.get(dragContext.draggingChildId)
    if (node) {
      const itemState = { ...makeState(dragContext.draggingChildId, selectedIds, highlightedIds, dimmedIds), dragging: true }
      const previousAlpha = ctx.globalAlpha ?? 1
      ctx.globalAlpha = 0.85
      if (renderers.node) renderers.node(ctx, { node, rect: dragContext.ghostRect, state: itemState, theme, viewport })
      else drawNode(ctx, node, dragContext.ghostRect, itemState, theme)
      ctx.globalAlpha = previousAlpha
    }
  }
  ctx.restore()
}

// --- 入口 ---

// 绘制顺序：网格 → 连线 → 分组框 → 普通节点。返回渲染统计。
export function renderScene(ctx, scene) {
  const t0 = now()
  const {
    layout,
    graph,
    viewport,
    width,
    height,
    theme = defaultTheme,
    state = {},
    renderers = {},
    layoutDirection,
    direction,
  } = scene
  const selectedIds = state.selectedIds
  const highlightedIds = state.highlightedIds
  const dimmedIds = state.dimmedIds
  const highlightedEdgeIds = state.highlightedEdgeIds
  const dimmedEdgeIds = state.dimmedEdgeIds
  const edges = resolveEdges(graph, layout)
  const resolvedDirection = layoutDirection || direction || inferDirectionFromLayout(graph, layout, edges)
  const mainAxis = edgeMainAxis(resolvedDirection)

  ctx.clearRect(0, 0, width, height)
  drawGrid(ctx, width, height, viewport, theme)

  for (const edge of edges) {
    const from = worldToScreen(edge.from, viewport)
    const to = worldToScreen(edge.to, viewport)
    const edgeState = {
      selected: false,
      hovered: false,
      dragging: false,
      highlighted: highlightedEdgeIds ? highlightedEdgeIds.has(edge.id) : false,
      dimmed: dimmedEdgeIds ? dimmedEdgeIds.has(edge.id) : false,
      readonly: false,
    }
    if (renderers.edge) renderers.edge(ctx, { edge: edgePayload(edge), from, to, state: edgeState, theme, viewport })
    else {
      const path = orthogonalPath(edge.fromBox, edge.toBox, mainAxis).map((point) => worldToScreen(point, viewport))
      withDimmedAlpha(ctx, edgeState, () => {
        const edgeTheme = { ...defaultTheme.edge, ...(theme.edge || {}) }
        ctx.strokeStyle = edgeState.selected
          ? theme.node.selectedStroke
          : edgeState.highlighted
            ? theme.group.header
            : edgeTheme.color
        ctx.lineWidth = edgeTheme.width
        ctx.beginPath()
        ctx.moveTo(path[0].x, path[0].y)
        for (const point of path.slice(1)) ctx.lineTo(point.x, point.y)
        ctx.stroke()
        const arrowSegment = lastNonZeroSegment(path)
        if (arrowSegment) drawArrow(ctx, arrowSegment.start, arrowSegment.end, theme)
      })
    }
  }

  const { items, culled } = collectVisible(layout, viewport, width, height)
  let drawn = 0

  const groupById = new Map(layout.groups.map((group) => [group.id, group]))
  for (const { item, screen } of items) {
    if (item.type !== 'group') continue
    const group = groupById.get(item.id)
    const itemState = makeState(item.id, selectedIds, highlightedIds, dimmedIds)
    const dragContext = state.groupDrag && state.groupDrag.groupId === group.id ? state.groupDrag : undefined
    const scrollbarHovered = state.groupScrollbarHoverId === group.id
    if (renderers.group) renderers.group(ctx, { group, rect: screen, state: itemState, theme, viewport })
    else {
      drawGroup(ctx, graph, group, screen, itemState, theme, scrollbarHovered)
    }
    drawGroupChildren(ctx, graph, group, screen, viewport, theme, renderers, selectedIds, highlightedIds, dimmedIds, dragContext)
    drawn++
  }

  for (const { item, screen } of items) {
    if (item.type !== 'node') continue
    const node = graph.nodes.get(item.id)
    const itemState = makeState(item.id, selectedIds, highlightedIds, dimmedIds)
    if (renderers.node) renderers.node(ctx, { node, rect: screen, state: itemState, theme, viewport })
    else drawNode(ctx, node, screen, itemState, theme)
    drawn++
  }

  if (state.selectionRect) drawSelectionRect(ctx, state.selectionRect, theme)

  return { total: layout.visibleItems.length, drawn, culled, durationMs: now() - t0 }
}
