import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph, createStressGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'
import { worldRectToScreen, collectVisible, resolveEdges, renderScene } from '../src/minimap/renderer.js'
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
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges(graph, layout)

  assert.ok(edges.some((edge) => edge.kind === 'tree'))

  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const groupCenter = centerOfBox(heapGroup)
  const cluster25 = layout.nodes.get('cluster-25')
  const business = edges.find((edge) => edge.id === 'edge-1') // cluster-8 -> cluster-25
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
  const graph = createDemoGraph()
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
