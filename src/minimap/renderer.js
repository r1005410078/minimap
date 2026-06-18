// Phase 1 Canvas 渲染器：默认绘制 + 自定义绘制钩子 + 视口裁剪 + 渲染统计。
// 只做渲染逻辑，ctx 由外部传入（真实或 mock），不碰 DOM。
// 见 docs/superpowers/specs/2026-06-18-phase-1-canvas-renderer.md

import { worldToScreen } from './coords.js'
import { defaultTheme } from './theme.js'

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

// 父子树默认连线 + graph.edges 业务线；端点为世界坐标中心，
// 端点落在被折叠子节点上时路由到其所在分组框。
export function resolveEdges(graph, layout) {
  const edges = []
  const groupByParent = new Map(layout.groups.map((group) => [group.parentId, group]))

  const resolveEndpoint = (id) => {
    const box = layout.nodes.get(id)
    if (box) return { box, point: centerOfBox(box) }
    const node = graph.nodes.get(id)
    const group = node && groupByParent.get(node.parentId)
    return group ? { box: group, point: centerOfBox(group) } : null
  }

  for (const item of layout.visibleItems) {
    if (item.type !== 'node') continue
    const node = graph.nodes.get(item.id)
    if (!node || !node.children || node.children.length === 0) continue
    const parentCenter = centerOfBox(item)
    const parentBox = layout.nodes.get(item.id)
    const group = groupByParent.get(item.id)
    if (group) {
      edges.push({
        id: `tree:${item.id}:group`,
        kind: 'tree',
        from: parentCenter,
        to: centerOfBox(group),
        fromBox: parentBox,
        toBox: group,
      })
    } else {
      for (const childId of node.children) {
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

function makeState(id, selectedIds) {
  return {
    selected: selectedIds ? selectedIds.has(id) : false,
    hovered: false,
    dragging: false,
    highlighted: false,
    readonly: false,
  }
}

function drawGrid(ctx, width, height, viewport, theme) {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)
  const size = theme.grid.size * viewport.scale
  if (size < 2) return
  ctx.strokeStyle = theme.grid.color
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

function drawEdge(ctx, from, to, theme) {
  ctx.strokeStyle = theme.edge.color
  ctx.lineWidth = theme.edge.width
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
}

function drawGroup(ctx, group, rect, theme) {
  ctx.fillStyle = theme.group.fill
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = theme.group.stroke
  ctx.lineWidth = 1
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.fillStyle = theme.group.header
  ctx.font = theme.group.font
  ctx.fillText(`${group.parentId} · ${group.children.length}`, rect.x + 8, rect.y + 16)
}

function drawNode(ctx, node, rect, state, theme) {
  ctx.fillStyle = theme.node.fill
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = state.selected ? theme.node.selectedStroke : theme.node.stroke
  ctx.lineWidth = 1
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.fillStyle = theme.node.text
  ctx.font = theme.node.font
  ctx.fillText(node.label ?? node.id, rect.x + 6, rect.y + rect.height / 2 + 4)
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
  } = scene
  const selectedIds = state.selectedIds

  ctx.clearRect(0, 0, width, height)
  drawGrid(ctx, width, height, viewport, theme)

  for (const edge of resolveEdges(graph, layout)) {
    const from = worldToScreen(edge.from, viewport)
    const to = worldToScreen(edge.to, viewport)
    if (renderers.edge) renderers.edge(ctx, { edge, from, to, theme, viewport })
    else drawEdge(ctx, from, to, theme)
  }

  const { items, culled } = collectVisible(layout, viewport, width, height)
  let drawn = 0

  for (const { item, screen } of items) {
    if (item.type !== 'group') continue
    const group = layout.groups.find((g) => g.parentId === item.parentId)
    const itemState = makeState(item.parentId, selectedIds)
    if (renderers.group) renderers.group(ctx, { group, rect: screen, state: itemState, theme, viewport })
    else drawGroup(ctx, group, screen, theme)
    drawn++
  }

  for (const { item, screen } of items) {
    if (item.type !== 'node') continue
    const node = graph.nodes.get(item.id)
    const itemState = makeState(item.id, selectedIds)
    if (renderers.node) renderers.node(ctx, { node, rect: screen, state: itemState, theme, viewport })
    else drawNode(ctx, node, screen, itemState, theme)
    drawn++
  }

  return { total: layout.visibleItems.length, drawn, culled, durationMs: now() - t0 }
}
