import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDemoGraph,
  createStressGraph,
  reorderGroupChild,
} from '../src/minimap/graph.js'
import {
  GROUP_THRESHOLD,
  computeLayout,
  keepAnchorStable,
} from '../src/minimap/layout.js'

test('groups adjacent siblings only when the run is larger than the threshold', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, {
    direction: 'horizontal',
    viewportWidth: 1200,
    viewportHeight: 760,
  })

  const mainGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const smallGroup = layout.groups.find((group) => group.parentId === 'cluster-25')

  assert.equal(GROUP_THRESHOLD, 5)
  assert.equal(mainGroup.children.length, 24)
  assert.equal(smallGroup.children.length, 10)
  assert.ok(mainGroup.width <= 1200 * 0.48)
  assert.ok(mainGroup.height <= 760 * 0.42)
  assert.equal(mainGroup.overflowY, true)
})

test('supports horizontal and vertical layout directions', () => {
  const graph = createDemoGraph()
  const horizontal = computeLayout(graph, {
    direction: 'horizontal',
    viewportWidth: 1200,
    viewportHeight: 760,
  })
  const vertical = computeLayout(graph, {
    direction: 'vertical',
    viewportWidth: 1200,
    viewportHeight: 760,
  })

  assert.ok(horizontal.nodes.get('heap-1').x > horizontal.nodes.get('energy-root').x)
  assert.ok(vertical.nodes.get('heap-1').y > vertical.nodes.get('energy-root').y)
})

test('reorders a child inside a group by changing graph child order', () => {
  const graph = createDemoGraph()

  reorderGroupChild(graph, 'heap-1', 'cluster-8', 1)

  const heap = graph.nodes.get('heap-1')
  assert.equal(heap.children[1], 'cluster-8')
  assert.equal(new Set(heap.children).size, heap.children.length)
})

test('keeps the selected anchor stable after relayout', () => {
  const before = { x: 100, y: 120 }
  const after = { x: 240, y: 300 }
  const viewport = { x: -40, y: -70, scale: 1 }

  const next = keepAnchorStable(viewport, before, after)

  assert.deepEqual(next, { x: -180, y: -250, scale: 1 })
})

test('creates a stress graph with 10000 child nodes', () => {
  const graph = createStressGraph(10000)
  const layout = computeLayout(graph, {
    direction: 'horizontal',
    viewportWidth: 1440,
    viewportHeight: 900,
  })

  assert.equal(graph.nodes.size, 10002)
  assert.equal(layout.groups[0].children.length, 10000)
  assert.ok(layout.visibleItems.length < graph.nodes.size)
})
