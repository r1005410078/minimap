import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph, createStressGraph, reorderGroupChild } from '../src/minimap/graph/graph.js'
import { GROUP_THRESHOLD, computeLayout } from '../src/minimap/graph/layout.js'

const VIEWPORT = { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 }

function parentWithChildren(childCount) {
  const nodes = new Map()
  nodes.set('r', { id: 'r', label: 'r', parentId: null, children: ['p'] })
  const children = []
  for (let i = 0; i < childCount; i++) {
    const id = `c${i}`
    children.push(id)
    nodes.set(id, { id, label: id, parentId: 'p', children: [] })
  }
  nodes.set('p', { id: 'p', label: 'p', parentId: 'r', children })
  return { version: 1, nodes, rootIds: ['r'], edges: [] }
}

test('demo graph exposes the expected ids and edges', () => {
  const graph = createDemoGraph()
  assert.equal(graph.nodes.get('heap-1').children.length, 24)
  assert.ok(graph.nodes.get('heap-1').children.includes('cluster-8'))
  assert.equal(graph.nodes.get('cluster-25').children.length, 10)
  assert.deepEqual(graph.edges, [])
})

test('stress graph size is childCount + 2', () => {
  assert.equal(createStressGraph(10000).nodes.size, 10002)
  assert.equal(createStressGraph(7).nodes.size, 9)
})

test('reorderGroupChild keeps order unique and ignores unknown ids', () => {
  const graph = createDemoGraph()
  reorderGroupChild(graph, 'heap-1', 'cluster-8', 0)
  const heap = graph.nodes.get('heap-1')
  assert.equal(heap.children[0], 'cluster-8')
  assert.equal(new Set(heap.children).size, heap.children.length)

  const before = heap.children.slice()
  reorderGroupChild(graph, 'heap-1', 'not-a-child', 0)
  assert.deepEqual(graph.nodes.get('heap-1').children, before)
})

test('folds only when the run is larger than the threshold', () => {
  assert.equal(computeLayout(parentWithChildren(GROUP_THRESHOLD), VIEWPORT).groups.length, 0)
  const folded = computeLayout(parentWithChildren(GROUP_THRESHOLD + 1), VIEWPORT)
  assert.equal(folded.groups.length, 1)
  assert.equal(folded.groups[0].children.length, GROUP_THRESHOLD + 1)
})

test('edges do not change the main tree layout', () => {
  const graph = createDemoGraph()
  const withEdges = computeLayout(graph, VIEWPORT)
  const withoutEdges = computeLayout({ ...graph, edges: [] }, VIEWPORT)
  assert.deepEqual(withoutEdges.nodes.get('heap-1'), withEdges.nodes.get('heap-1'))
  assert.deepEqual(withoutEdges.nodes.get('cluster-25'), withEdges.nodes.get('cluster-25'))
})

test('parent aligns to the middle child center when it has an odd number of children', () => {
  const layout = computeLayout(createDemoGraph(), VIEWPORT)
  const center = (id) => {
    const box = layout.nodes.get(id)
    return box.y + box.height / 2
  }
  const expected = center('heap-1')
  assert.ok(Math.abs(center('energy-root') - expected) < 1e-6)
})
