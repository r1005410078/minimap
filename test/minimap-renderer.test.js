import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph, createStressGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'
import { orthogonalPath } from '../src/minimap/orthogonal.js'
import { worldRectToScreen, collectVisible, resolveEdges, renderScene } from '../src/minimap/renderer.js'
import { defaultTheme } from '../src/minimap/theme.js'
import { createMockCtx } from './helpers/mock-ctx.js'

const VIEWPORT = { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 }

const centerOfBox = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

function demoScene(overrides = {}) {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  return {
    graph,
    layout,
    viewport: { x: 100, y: 100, scale: 1 },
    width: 2400,
    height: 1600,
    ...overrides,
  }
}

function demoGraphWithRelationEdges() {
  const graph = createDemoGraph()
  return {
    ...graph,
    edges: [
      { id: 'edge-1', source: 'cluster-8', target: 'cluster-25', kind: 'relation' },
      { id: 'edge-2', source: 'grid-tie', target: 'heap-1', kind: 'relation' },
    ],
  }
}

// root -> p -> [a0..a5, mid(带子节点,不参与合并), b0..b5]
// a0..a5、b0..b5 各自超过默认阈值(5)，各自独立折叠成一个分组；mid 是普通节点。
function multiGroupGraph(edges = []) {
  const nodes = new Map()
  nodes.set('root', { id: 'root', label: 'root', parentId: null, children: ['p'] })
  const childIds = []
  for (let i = 0; i < 6; i++) {
    const id = `a${i}`
    childIds.push(id)
    nodes.set(id, { id, label: id, parentId: 'p', children: [] })
  }
  childIds.push('mid')
  nodes.set('mid', { id: 'mid', label: 'mid', parentId: 'p', children: ['mid-child'] })
  nodes.set('mid-child', { id: 'mid-child', label: 'mid-child', parentId: 'mid', children: [] })
  for (let i = 0; i < 6; i++) {
    const id = `b${i}`
    childIds.push(id)
    nodes.set(id, { id, label: id, parentId: 'p', children: [] })
  }
  nodes.set('p', { id: 'p', label: 'p', parentId: 'root', children: childIds })
  return { version: 1, nodes, rootIds: ['root'], edges }
}

function edgeStrokeSegments(ctx, edgeIndex) {
  const strokes = ctx.methodsOf('stroke')
  const strokeIndex = ctx.calls.findIndex((call, index) => call === strokes[edgeIndex])
  const start = ctx.calls
    .slice(0, strokeIndex + 1)
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.method === 'beginPath')
    .at(-1)?.index
  return ctx.calls.slice(start, strokeIndex + 1)
}

function linePoints(segmentCalls) {
  return segmentCalls
    .filter((call) => call.method === 'moveTo' || call.method === 'lineTo')
    .map((call) => ({ x: call.args[0], y: call.args[1], method: call.method }))
}

function arrowFillSegment(ctx, arrowIndex) {
  const fills = ctx.methodsOf('fill')
  const fillIndex = ctx.calls.findIndex((call, index) => call === fills[arrowIndex])
  const start = ctx.calls
    .slice(0, fillIndex + 1)
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.method === 'beginPath')
    .at(-1)?.index
  return ctx.calls.slice(start, fillIndex + 1)
}

test('worldRectToScreen applies scale and viewport offset', () => {
  const screen = worldRectToScreen({ x: 10, y: 20, width: 30, height: 40 }, { x: 5, y: -5, scale: 2 })
  assert.deepEqual(screen, { x: 25, y: 35, width: 60, height: 80 })
})

test('collectVisible keeps on-screen items and culls off-screen ones', () => {
  const scene = demoScene()
  const all = collectVisible(scene.layout, scene.viewport, scene.width, scene.height)
  assert.equal(all.culled, 0)
  assert.equal(all.items.length, scene.layout.visibleItems.length)

  const tiny = collectVisible(scene.layout, { x: 0, y: 0, scale: 1 }, 80, 80)
  assert.ok(tiny.items.length < scene.layout.visibleItems.length)
  assert.equal(tiny.culled, scene.layout.visibleItems.length - tiny.items.length)
})

test('resolveEdges builds tree edges and routes folded endpoints to the group', () => {
  const graph = demoGraphWithRelationEdges()
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges(graph, layout)

  assert.ok(edges.some((edge) => edge.kind === 'tree'))

  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const groupCenter = centerOfBox(heapGroup)
  const heapNode = layout.nodes.get('heap-1')
  const cluster25 = layout.nodes.get('cluster-25')
  const groupedTree = edges.find((edge) => edge.id === `tree:group:${heapGroup.id}`)
  const business = edges.find((edge) => edge.id === 'edge-1') // cluster-8 -> cluster-25
  assert.deepEqual(groupedTree.fromBox, heapNode)
  assert.deepEqual(groupedTree.toBox, heapGroup)
  assert.deepEqual(groupedTree.from, centerOfBox(heapNode))
  assert.deepEqual(groupedTree.to, groupCenter)
  assert.deepEqual(business.from, groupCenter)
  assert.deepEqual(business.fromBox, heapGroup)
  assert.deepEqual(business.toBox, cluster25)
  assert.deepEqual(business.to, centerOfBox(cluster25))
})

test('resolveEdges keeps regular tree edge centers and boxes aligned', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges(graph, layout)

  const root = layout.nodes.get('energy-root')
  const gridTie = layout.nodes.get('grid-tie')
  const tree = edges.find((edge) => edge.id === 'tree:energy-root:grid-tie')
  assert.deepEqual(tree.fromBox, root)
  assert.deepEqual(tree.toBox, gridTie)
  assert.deepEqual(tree.from, centerOfBox(root))
  assert.deepEqual(tree.to, centerOfBox(gridTie))
})

test('resolveEdges skips edges whose endpoints cannot be resolved', () => {
  const graph = demoGraphWithRelationEdges()
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges({ ...graph, edges: [{ id: 'x', source: 'nope', target: 'energy-root' }] }, layout)
  assert.equal(edges.some((edge) => edge.id === 'x'), false)
})

test('renderScene draws in order grid -> edges -> groups -> nodes', () => {
  const ctx = createMockCtx()
  const order = []
  const tag = (name) => () => order.push(name)
  renderScene(ctx, demoScene({ renderers: { edge: tag('edge'), group: tag('group'), node: tag('node') } }))

  // 背景在任何自定义绘制之前
  assert.equal(ctx.calls[0].method, 'clearRect')
  const firstEdge = order.indexOf('edge')
  const firstGroup = order.indexOf('group')
  const firstNode = order.indexOf('node')
  assert.ok(firstEdge >= 0 && firstGroup >= 0 && firstNode >= 0)
  assert.ok(firstEdge < firstGroup)
  assert.ok(firstGroup < firstNode)
})

test('default edges draw as three-segment orthogonal polylines', () => {
  const ctx = createMockCtx()
  const scene = demoScene({
    theme: { ...defaultTheme, grid: { ...defaultTheme.grid, size: 1 } },
    renderers: { group: () => {}, node: () => {} },
  })
  const edges = resolveEdges(scene.graph, scene.layout)

  renderScene(ctx, scene)

  const firstEdgeCalls = edgeStrokeSegments(ctx, 0)
  const firstEdgePoints = linePoints(firstEdgeCalls)
  const expectedPath = orthogonalPath(edges[0].fromBox, edges[0].toBox, 'x').map((point) => ({
    x: point.x + scene.viewport.x,
    y: point.y + scene.viewport.y,
  }))

  assert.deepEqual(firstEdgePoints, [
    { ...expectedPath[0], method: 'moveTo' },
    { ...expectedPath[1], method: 'lineTo' },
    { ...expectedPath[2], method: 'lineTo' },
    { ...expectedPath[3], method: 'lineTo' },
  ])
})

test('tree edge to the middle child stays visually straight when parent and child spans overlap', () => {
  const ctx = createMockCtx()
  const scene = demoScene({
    theme: { ...defaultTheme, grid: { ...defaultTheme.grid, size: 1 } },
    renderers: { group: () => {}, node: () => {} },
  })
  const edges = resolveEdges(scene.graph, scene.layout)
  const targetIndex = edges.findIndex((edge) => edge.id === 'tree:energy-root:heap-1')

  renderScene(ctx, scene)

  const points = linePoints(edgeStrokeSegments(ctx, targetIndex))
  const expectedPath = orthogonalPath(edges[targetIndex].fromBox, edges[targetIndex].toBox, 'x').map((point) => ({
    x: point.x + scene.viewport.x,
    y: point.y + scene.viewport.y,
  }))
  assert.deepEqual(points, [
    { ...expectedPath[0], method: 'moveTo' },
    { ...expectedPath[1], method: 'lineTo' },
    { ...expectedPath[2], method: 'lineTo' },
    { ...expectedPath[3], method: 'lineTo' },
  ])
  assert.equal(points[0].y, points[1].y)
  assert.equal(points[1].y, points[2].y)
  assert.equal(points[2].y, points[3].y)
})

test('arrow triangles are drawn at edge endpoints', () => {
  const ctx = createMockCtx()
  const scene = demoScene({
    theme: { ...defaultTheme, grid: { ...defaultTheme.grid, size: 1 } },
    renderers: { group: () => {}, node: () => {} },
  })
  const edges = resolveEdges(scene.graph, scene.layout)

  renderScene(ctx, scene)

  const arrowCalls = arrowFillSegment(ctx, 0)
  const arrowPoints = linePoints(arrowCalls)
  const expectedPath = orthogonalPath(edges[0].fromBox, edges[0].toBox, 'x').map((point) => ({
    x: point.x + scene.viewport.x,
    y: point.y + scene.viewport.y,
  }))

  assert.equal(ctx.methodsOf('fill').length, edges.length)
  assert.equal(arrowPoints[0].method, 'moveTo')
  assert.deepEqual(arrowPoints[0], { ...expectedPath[3], method: 'moveTo' })
  assert.equal(arrowPoints.length, 3)
  assert.equal(arrowCalls.at(-2).method, 'closePath')
  assert.equal(arrowCalls.at(-1).method, 'fill')
})

test('vertical direction uses vertical orthogonal routing', () => {
  const ctx = createMockCtx()
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'vertical', viewportWidth: 1200, viewportHeight: 760 })
  const scene = {
    graph,
    layout,
    viewport: { x: 100, y: 100, scale: 1 },
    width: 2400,
    height: 1600,
    layoutDirection: 'vertical',
    theme: { ...defaultTheme, grid: { ...defaultTheme.grid, size: 1 } },
    renderers: { group: () => {}, node: () => {} },
  }
  const edges = resolveEdges(graph, layout)

  renderScene(ctx, scene)

  const firstEdgePoints = linePoints(edgeStrokeSegments(ctx, 0))
  const expectedPath = orthogonalPath(edges[0].fromBox, edges[0].toBox, 'y').map((point) => ({
    x: point.x + scene.viewport.x,
    y: point.y + scene.viewport.y,
  }))

  assert.deepEqual(firstEdgePoints, [
    { ...expectedPath[0], method: 'moveTo' },
    { ...expectedPath[1], method: 'lineTo' },
    { ...expectedPath[2], method: 'lineTo' },
    { ...expectedPath[3], method: 'lineTo' },
  ])
})

test('vertical layouts stay on vertical routing without scene direction fields', () => {
  const ctx = createMockCtx()
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'vertical', viewportWidth: 1200, viewportHeight: 760 })
  const scene = {
    graph,
    layout,
    viewport: { x: 100, y: 100, scale: 1 },
    width: 2400,
    height: 1600,
    theme: { ...defaultTheme, grid: { ...defaultTheme.grid, size: 1 } },
    renderers: { group: () => {}, node: () => {} },
  }
  const edges = resolveEdges(graph, layout)

  renderScene(ctx, scene)

  const firstEdgePoints = linePoints(edgeStrokeSegments(ctx, 0))
  const expectedPath = orthogonalPath(edges[0].fromBox, edges[0].toBox, 'y').map((point) => ({
    x: point.x + scene.viewport.x,
    y: point.y + scene.viewport.y,
  }))

  assert.deepEqual(firstEdgePoints, [
    { ...expectedPath[0], method: 'moveTo' },
    { ...expectedPath[1], method: 'lineTo' },
    { ...expectedPath[2], method: 'lineTo' },
    { ...expectedPath[3], method: 'lineTo' },
  ])
})

test('partial theme edge overrides still draw arrow triangles', () => {
  const ctx = createMockCtx()
  const scene = demoScene({
    theme: { ...defaultTheme, edge: { color: '#ff00aa', width: 2 }, grid: { ...defaultTheme.grid, size: 1 } },
    renderers: { group: () => {}, node: () => {} },
  })
  const edges = resolveEdges(scene.graph, scene.layout)

  renderScene(ctx, scene)

  const arrowCalls = arrowFillSegment(ctx, 0)
  const arrowPoints = linePoints(arrowCalls)
  const expectedPath = orthogonalPath(edges[0].fromBox, edges[0].toBox, 'x').map((point) => ({
    x: point.x + scene.viewport.x,
    y: point.y + scene.viewport.y,
  }))

  assert.deepEqual(arrowPoints[0], { ...expectedPath[3], method: 'moveTo' })
  assert.equal(Number.isFinite(arrowPoints[1].x), true)
  assert.equal(Number.isFinite(arrowPoints[1].y), true)
  assert.equal(Number.isFinite(arrowPoints[2].x), true)
  assert.equal(Number.isFinite(arrowPoints[2].y), true)
  assert.equal(ctx.methodsOf('fill').length, edges.length)
})

test('tied-overlap edges still draw an arrow when the terminal segment is zero-length', () => {
  const ctx = createMockCtx()
  const fromBox = { id: 'from', type: 'node', x: 0, y: 0, width: 100, height: 100 }
  const toBox = { id: 'to', type: 'node', x: 50, y: 0, width: 100, height: 100 }
  const scene = {
    graph: {
      rootIds: ['from'],
      nodes: new Map([
        ['from', { id: 'from', children: [] }],
        ['to', { id: 'to', children: [] }],
      ]),
      edges: [{ id: 'edge-tied-overlap', source: 'from', target: 'to' }],
    },
    layout: {
      nodes: new Map([
        ['from', fromBox],
        ['to', toBox],
      ]),
      groups: [],
      visibleItems: [fromBox, toBox],
    },
    viewport: { x: 100, y: 100, scale: 1 },
    width: 800,
    height: 600,
    layoutDirection: 'horizontal',
    theme: { ...defaultTheme, grid: { ...defaultTheme.grid, size: 1 } },
    renderers: { group: () => {}, node: () => {} },
  }
  const expectedPath = orthogonalPath(fromBox, toBox, 'x').map((point) => ({
    x: point.x + scene.viewport.x,
    y: point.y + scene.viewport.y,
  }))

  renderScene(ctx, scene)

  const arrowCalls = arrowFillSegment(ctx, 0)
  const arrowPoints = linePoints(arrowCalls)
  assert.equal(ctx.methodsOf('fill').length, 1)
  assert.deepEqual(arrowPoints[0], { ...expectedPath[3], method: 'moveTo' })
  assert.equal(Number.isFinite(arrowPoints[1].x), true)
  assert.equal(Number.isFinite(arrowPoints[1].y), true)
  assert.equal(Number.isFinite(arrowPoints[2].x), true)
  assert.equal(Number.isFinite(arrowPoints[2].y), true)
})

test('custom edgeRenderer still receives only center points and no endpoint boxes', () => {
  const ctx = createMockCtx()
  const scene = demoScene()
  const payloads = []
  const expectedEdges = resolveEdges(scene.graph, scene.layout).map(({ id, kind, from, to }) => ({ id, kind, from, to }))

  renderScene(ctx, {
    ...scene,
    renderers: {
      edge: (_ctx, payload) => payloads.push(payload),
      group: () => {},
      node: () => {},
    },
  })

  assert.ok(payloads.length > 0)
  assert.equal(payloads.length, expectedEdges.length)
  for (const [index, payload] of payloads.entries()) {
    assert.deepEqual(Object.keys(payload).sort(), ['edge', 'from', 'theme', 'to', 'viewport'])
    assert.deepEqual(payload.edge, expectedEdges[index])
    assert.equal('fromBox' in payload.edge, false)
    assert.equal('toBox' in payload.edge, false)
  }
})

test('custom nodeRenderer replaces default node drawing', () => {
  const ctx = createMockCtx()
  let calls = 0
  const scene = demoScene({ renderers: { node: () => { calls++ } } })
  const stats = renderScene(ctx, scene)
  const nodeCount = scene.layout.visibleItems.filter((item) => item.type === 'node').length
  assert.equal(calls, nodeCount)
  // 默认节点绘制不再发出（节点 label 不会被 fillText）
  assert.equal(ctx.methodsOf('fillText').some((c) => c.args[0] === 'Energy Root'), false)
  assert.equal(stats.drawn, stats.total - stats.culled)
})

test('renderScene culls off-screen items: drawn < total', () => {
  const ctx = createMockCtx()
  const stats = renderScene(ctx, demoScene({ viewport: { x: 0, y: 0, scale: 1 }, width: 80, height: 80 }))
  assert.ok(stats.drawn < stats.total)
  assert.equal(stats.drawn + stats.culled, stats.total)
})

test('stress graph: drawn count stays far below total node count', () => {
  const ctx = createMockCtx()
  const graph = createStressGraph(10000)
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 1440, viewportHeight: 900 })
  const stats = renderScene(ctx, { graph, layout, viewport: { x: 200, y: 200, scale: 1 }, width: 1440, height: 900 })
  assert.ok(stats.drawn < 100)
  assert.ok(stats.drawn < graph.nodes.size)
  assert.equal(stats.total, layout.visibleItems.length)
})

test('resolveEdges creates one tree edge per group when a parent has multiple groups', () => {
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges(graph, layout)

  const groupTreeEdges = edges.filter((edge) => edge.kind === 'tree' && edge.id.startsWith('tree:group:'))
  assert.equal(groupTreeEdges.length, 2)
  assert.equal(new Set(groupTreeEdges.map((edge) => edge.toBox)).size, 2)

  const midEdge = edges.find((edge) => edge.id === 'tree:p:mid')
  assert.ok(midEdge)
  assert.deepEqual(midEdge.toBox, layout.nodes.get('mid'))
})

test('resolveEdges routes a business edge to the specific group that owns the endpoint', () => {
  const graph = multiGroupGraph([{ id: 'rel-1', source: 'a0', target: 'b0', kind: 'relation' }])
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges(graph, layout)

  const groupA = layout.groups.find((group) => group.children.includes('a0'))
  const groupB = layout.groups.find((group) => group.children.includes('b0'))
  const rel = edges.find((edge) => edge.id === 'rel-1')

  assert.notEqual(groupA.id, groupB.id)
  assert.deepEqual(rel.fromBox, groupA)
  assert.deepEqual(rel.toBox, groupB)
})

test('renderScene draws each group exactly once with its own group object', () => {
  const ctx = createMockCtx()
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const seen = []
  renderScene(ctx, {
    graph,
    layout,
    viewport: { x: 0, y: 0, scale: 1 },
    width: 2400,
    height: 1600,
    layoutDirection: 'horizontal',
    renderers: { group: (_ctx, { group }) => seen.push(group.id), node: () => {} },
  })
  assert.deepEqual(seen.sort(), layout.groups.map((g) => g.id).sort())
})

test('inferDirectionFromLayout still infers correctly when a parent has multiple groups', () => {
  const ctx = createMockCtx()
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, { direction: 'vertical', viewportWidth: 1200, viewportHeight: 760 })
  const scene = {
    graph,
    layout,
    viewport: { x: 100, y: 100, scale: 1 },
    width: 2400,
    height: 1600,
    theme: { ...defaultTheme, grid: { ...defaultTheme.grid, size: 1 } },
    renderers: { group: () => {}, node: () => {} },
  }
  const edges = resolveEdges(graph, layout)

  renderScene(ctx, scene) // 不传 layoutDirection/direction，强制走 inferDirectionFromLayout

  const firstEdgePoints = linePoints(edgeStrokeSegments(ctx, 0))
  const expectedPath = orthogonalPath(edges[0].fromBox, edges[0].toBox, 'y').map((point) => ({
    x: point.x + scene.viewport.x,
    y: point.y + scene.viewport.y,
  }))
  assert.deepEqual(firstEdgePoints, [
    { ...expectedPath[0], method: 'moveTo' },
    { ...expectedPath[1], method: 'lineTo' },
    { ...expectedPath[2], method: 'lineTo' },
    { ...expectedPath[3], method: 'lineTo' },
  ])
})
